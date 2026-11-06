// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "test-utils/render-with-providers";

const { useWidgetAPI } = vi.hoisted(() => ({ useWidgetAPI: vi.fn() }));
vi.mock("utils/proxy/use-widget-api", () => ({ default: useWidgetAPI }));

import Component from "./component";

const baseWidget = {
  type: "googlecalendar",
  service_group: "La tua giornata",
  service_name: "Google Calendar",
  index: 0,
};

describe("widgets/googlecalendar/component", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders events and tasks, and optimistically completes a task on checkbox click", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    const initialData = {
      date: "2026-11-05",
      canComplete: true,
      events: [
        {
          id: "ev-1",
          title: "Lezione di informatica",
          timeLabel: "09:00–10:30",
          allDay: false,
          location: "Aula 3",
          color: "#3b82f6",
          link: "https://calendar.google.com/ev1",
          past: false,
        },
      ],
      tasks: [
        {
          id: "task-1",
          tasklist: "list-1",
          title: "Consegnare la relazione",
          due: "2026-11-05",
          overdue: false,
        },
      ],
    };

    useWidgetAPI.mockReturnValue({ data: initialData, error: undefined, mutate });
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    renderWithProviders(<Component service={{ widget: baseWidget }} />);

    expect(screen.getByText("Lezione di informatica")).toBeInTheDocument();
    expect(screen.getByText("Aula 3")).toBeInTheDocument();
    expect(screen.getByText("Consegnare la relazione")).toBeInTheDocument();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ tasks: [] }),
        { revalidate: false },
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain("endpoint=completeTask");
    expect(calledUrl).toContain("segments=");
  });

  it("rolls back optimistic update when POST completeTask fails", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    const initialData = {
      date: "2026-11-05",
      canComplete: true,
      events: [],
      tasks: [
        {
          id: "task-1",
          tasklist: "list-1",
          title: "Consegnare la relazione",
          due: "2026-11-05",
          overdue: true,
        },
      ],
    };

    useWidgetAPI.mockReturnValue({ data: initialData, error: undefined, mutate });
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));

    renderWithProviders(<Component service={{ widget: baseWidget }} />);

    expect(screen.getByText("googlecalendar.overdue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      expect(mutate).toHaveBeenLastCalledWith(initialData, { revalidate: false });
    });
  });
});
