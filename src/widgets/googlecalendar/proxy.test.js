import { DateTime } from "luxon";
import cache from "memory-cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { getServiceWidget, googleFetch, FaroOAuthErrorMock, logger } = vi.hoisted(() => {
  class HoistedFaroOAuthError extends Error {
    constructor(message, { status = 500, code = "oauth_error" } = {}) {
      super(message);
      this.name = "FaroOAuthError";
      this.status = status;
      this.code = code;
    }
  }
  return {
    getServiceWidget: vi.fn(),
    googleFetch: vi.fn(),
    FaroOAuthErrorMock: HoistedFaroOAuthError,
    logger: { debug: vi.fn(), error: vi.fn() },
  };
});

vi.mock("utils/logger", () => ({ default: () => logger }));
vi.mock("utils/config/service-helpers", () => ({ default: getServiceWidget }));
vi.mock("utils/faro/oauth/google", () => ({ googleFetch }));
vi.mock("utils/faro/oauth/token-store", () => ({
  FaroOAuthError: FaroOAuthErrorMock,
}));

import googleCalendarProxyHandler from "./proxy";

const baseQuery = { group: "La tua giornata", service: "Google Calendar", index: "0" };

describe("widgets/googlecalendar/proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it("returns sample events and task in demo mode", async () => {
    getServiceWidget.mockResolvedValueOnce({ type: "googlecalendar", demo: true });
    const res = createMockRes();

    await googleCalendarProxyHandler({ method: "GET", query: baseQuery }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.events).toHaveLength(3);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.canComplete).toBe(true);
    expect(googleFetch).not.toHaveBeenCalled();
  });

  it("merges multiple calendars with colors, detects Google Meet, and filters tasks due today or overdue", async () => {
    const zone = "Europe/Rome";
    const now = DateTime.now().setZone(zone);
    const todayIso = now.toISODate();
    const yesterdayIso = now.minus({ days: 1 }).toISODate();
    const tomorrowIso = now.plus({ days: 1 }).toISODate();

    getServiceWidget.mockResolvedValue({
      type: "googlecalendar",
      account: "personale",
      timezone: zone,
    });

    googleFetch
      // calendarList
      .mockResolvedValueOnce({
        items: [
          {
            id: "uni@group.calendar.google.com",
            selected: true,
            backgroundColor: "#3b82f6",
            primary: true,
            timeZone: zone,
          },
          { id: "team@group.calendar.google.com", selected: true, backgroundColor: "#22c55e" },
          { id: "hidden@group.calendar.google.com", selected: false, backgroundColor: "#ef4444" },
        ],
      })
      // events for uni calendar
      .mockResolvedValueOnce({
        items: [
          {
            id: "ev-allday",
            summary: "Scadenza bando",
            start: { date: todayIso },
            end: { date: tomorrowIso },
            htmlLink: "https://calendar.google.com/event?eid=allday",
          },
          {
            id: "ev-late",
            summary: "Lezione",
            location: "Aula 3",
            start: { dateTime: now.set({ hour: 14, minute: 0 }).toISO() },
            end: { dateTime: now.set({ hour: 15, minute: 30 }).toISO() },
            htmlLink: "https://calendar.google.com/event?eid=late",
          },
        ],
      })
      // events for team calendar
      .mockResolvedValueOnce({
        items: [
          {
            id: "ev-meet",
            summary: "Riunione progetto",
            hangoutLink: "https://meet.google.com/abc-defg-hij",
            start: { dateTime: now.set({ hour: 12, minute: 0 }).toISO() },
            end: { dateTime: now.set({ hour: 12, minute: 30 }).toISO() },
            htmlLink: "https://calendar.google.com/event?eid=meet",
          },
        ],
      })
      // task lists
      .mockResolvedValueOnce({
        items: [{ id: "list-1", title: "Università" }],
      })
      // tasks in list-1
      .mockResolvedValueOnce({
        items: [
          { id: "t-today", title: "Consegnare la relazione", due: `${todayIso}T00:00:00.000Z`, status: "needsAction" },
          { id: "t-overdue", title: "Iscrizione appello", due: `${yesterdayIso}T00:00:00.000Z`, status: "needsAction" },
          { id: "t-future", title: "Prossima settimana", due: `${tomorrowIso}T00:00:00.000Z`, status: "needsAction" },
        ],
      });

    const res = createMockRes();
    await googleCalendarProxyHandler({ method: "GET", query: baseQuery }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.events.map((e) => e.title)).toEqual(["Scadenza bando", "Riunione progetto", "Lezione"]);
    expect(res.body.events[1]).toMatchObject({
      location: "Google Meet",
      color: "#22c55e",
      timeLabel: "12:00–12:30",
    });
    expect(res.body.tasks).toEqual([
      { id: "t-overdue", tasklist: "list-1", title: "Iscrizione appello", due: yesterdayIso, overdue: true },
      { id: "t-today", tasklist: "list-1", title: "Consegnare la relazione", due: todayIso, overdue: false },
    ]);
  });

  it("handles POST task completion and rejects when completeTasks is false", async () => {
    getServiceWidget.mockResolvedValueOnce({
      type: "googlecalendar",
      account: "personale",
      completeTasks: false,
    });

    const forbiddenRes = createMockRes();
    await googleCalendarProxyHandler(
      {
        method: "POST",
        query: { ...baseQuery, endpoint: "tasks/list-1/task-99/complete" },
      },
      forbiddenRes,
    );
    expect(forbiddenRes.statusCode).toBe(403);
    expect(googleFetch).not.toHaveBeenCalled();

    getServiceWidget.mockResolvedValueOnce({
      type: "googlecalendar",
      account: "personale",
      completeTasks: true,
    });
    cache.put("faro:gcal:data:personale::true:true:false::8", { cached: true }, 60000);
    googleFetch.mockResolvedValueOnce({ id: "task-99", status: "completed" });

    const okRes = createMockRes();
    await googleCalendarProxyHandler(
      {
        method: "POST",
        query: { ...baseQuery, endpoint: "tasks/list-1/task-99/complete" },
      },
      okRes,
    );

    expect(okRes.statusCode).toBe(200);
    expect(okRes.body).toEqual({ ok: true });
    expect(googleFetch).toHaveBeenCalledWith(
      "personale",
      "https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/task-99",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      },
    );
    expect(cache.get("faro:gcal:data:personale::true:true:false::8")).toBeNull();
  });
});
