import { DateTime } from "luxon";
import cache from "memory-cache";

import getServiceWidget from "utils/config/service-helpers";
import { parseMaxItems } from "utils/faro/mail-helpers";
import { googleFetch } from "utils/faro/oauth/google";
import { FaroOAuthError } from "utils/faro/oauth/token-store";
import createLogger from "utils/logger";

const logger = createLogger("googleCalendarProxyHandler");
const CACHE_TTL_MS = 5 * 60 * 1000;
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const TASKS_API_BASE = "https://tasks.googleapis.com/tasks/v1";
const COMPLETE_ENDPOINT_RE = /^tasks\/([^/]+)\/([^/]+)\/complete$/;

function isBoolFalse(value) {
  return value === false || value === "false";
}

function isBoolTrue(value) {
  return value === true || value === "true";
}

function invalidateAccountCalendarCache(accountKey) {
  const prefix = `faro:gcal:data:${accountKey}:`;
  for (const key of cache.keys()) {
    if (typeof key === "string" && key.startsWith(prefix)) {
      cache.del(key);
    }
  }
}

function buildDemoPayload(canComplete, showTasks, maxItems) {
  const today = DateTime.local();
  const events = [
    {
      id: "demo-ev-1",
      title: "Lezione di informatica",
      start: today.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toISO(),
      end: today.set({ hour: 10, minute: 30, second: 0, millisecond: 0 }).toISO(),
      timeLabel: "09:00–10:30",
      allDay: false,
      location: "Aula 3",
      color: "#3b82f6",
      link: "https://calendar.google.com",
      past: false,
    },
    {
      id: "demo-ev-2",
      title: "Riunione progetto",
      start: today.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toISO(),
      end: today.set({ hour: 12, minute: 30, second: 0, millisecond: 0 }).toISO(),
      timeLabel: "12:00–12:30",
      allDay: false,
      location: "Google Meet",
      color: "#22c55e",
      link: "https://calendar.google.com",
      past: false,
    },
    {
      id: "demo-ev-3",
      title: "Studio in biblioteca",
      start: today.set({ hour: 15, minute: 0, second: 0, millisecond: 0 }).toISO(),
      end: today.set({ hour: 16, minute: 0, second: 0, millisecond: 0 }).toISO(),
      timeLabel: "15:00–16:00",
      allDay: false,
      location: "",
      color: "#a855f7",
      link: "https://calendar.google.com",
      past: false,
    },
  ];

  const tasks = showTasks
    ? [
        {
          id: "demo-task-1",
          tasklist: "default",
          title: "Consegnare la relazione",
          due: today.toISODate(),
          overdue: false,
        },
      ]
    : [];

  return {
    date: today.toISODate(),
    events: events.slice(0, maxItems),
    tasks,
    canComplete,
  };
}

function isDeclinedBySelf(event) {
  if (!Array.isArray(event?.attendees)) {
    return false;
  }
  return event.attendees.some((att) => att?.self && att?.responseStatus === "declined");
}

function extractLocation(event) {
  if (event?.location && typeof event.location === "string") {
    return event.location.trim();
  }
  if (event?.hangoutLink || event?.conferenceData?.entryPoints?.length) {
    return "Google Meet";
  }
  return "";
}

function resolveZone(configuredZone, primaryZone) {
  if (configuredZone && DateTime.now().setZone(configuredZone).isValid) {
    return configuredZone;
  }
  if (primaryZone && DateTime.now().setZone(primaryZone).isValid) {
    return primaryZone;
  }
  return DateTime.local().zoneName || "UTC";
}

async function handleCompleteTask(req, res, widget) {
  const canComplete = !isBoolFalse(widget.completeTasks);
  if (!canComplete) {
    return res.status(403).json({ error: { message: "Task completion is disabled in widget configuration" } });
  }

  const match = String(req.query.endpoint || "").match(COMPLETE_ENDPOINT_RE);
  if (!match) {
    return res.status(400).json({ error: { message: "Invalid task completion endpoint" } });
  }

  if (isBoolTrue(widget.demo)) {
    return res.status(200).json({ ok: true });
  }

  const tasklistId = decodeURIComponent(match[1]);
  const taskId = decodeURIComponent(match[2]);
  const accountKey = widget.account;

  try {
    await googleFetch(
      accountKey,
      `${TASKS_API_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      },
    );

    invalidateAccountCalendarCache(accountKey);
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof FaroOAuthError) {
      logger.debug("Google Tasks completion error for '%s': %s", accountKey, err.message);
      return res.status(err.status || 500).json({ error: { message: err.message } });
    }
    logger.error("Unexpected error completing Google Task: %s", err.message);
    return res.status(500).json({ error: { message: "Unexpected error completing task" } });
  }
}

async function fetchDueTasks(accountKey, todayIso) {
  const listsData = await googleFetch(accountKey, `${TASKS_API_BASE}/users/@me/lists?maxResults=20`);
  const taskLists = Array.isArray(listsData?.items) ? listsData.items : [];
  if (!taskLists.length) {
    return [];
  }

  // Google Tasks stores due dates as YYYY-MM-DDT00:00:00.000Z regardless of local timezone.
  const dueMaxDt = DateTime.fromISO(todayIso, { zone: "UTC" }).plus({ days: 1 }).endOf("day");
  const params = new URLSearchParams({
    showCompleted: "false",
    showHidden: "false",
    dueMax: dueMaxDt.toISO(),
    maxResults: "50",
  });

  const perList = await Promise.all(
    taskLists.map(async (list) => {
      const data = await googleFetch(
        accountKey,
        `${TASKS_API_BASE}/lists/${encodeURIComponent(list.id)}/tasks?${params.toString()}`,
      );
      const items = Array.isArray(data?.items) ? data.items : [];
      return items
        .filter((t) => t?.title && t?.due && t.status !== "completed" && !t.deleted)
        .map((t) => {
          const dueIsoDate = String(t.due).slice(0, 10);
          return {
            id: t.id,
            tasklist: list.id,
            title: t.title.trim(),
            due: dueIsoDate,
            overdue: dueIsoDate < todayIso,
          };
        })
        .filter((t) => t.due <= todayIso);
    }),
  );

  return perList.flat().sort((a, b) => {
    if (a.overdue !== b.overdue) {
      return a.overdue ? -1 : 1;
    }
    return a.due.localeCompare(b.due);
  });
}

export default async function googleCalendarProxyHandler(req, res) {
  const { group, service, index } = req.query;
  const widget = await getServiceWidget(group, service, index);

  if (!widget) {
    return res.status(400).json({ error: { message: "Invalid widget configuration" } });
  }

  if (req.method === "POST" || req.query.endpoint) {
    return handleCompleteTask(req, res, widget);
  }

  const showTasks = !isBoolFalse(widget.showTasks);
  const canComplete = showTasks && !isBoolFalse(widget.completeTasks);
  const hidePastEvents = isBoolTrue(widget.hidePastEvents);
  const maxItems = parseMaxItems(widget.maxItems, 8, 25);

  if (isBoolTrue(widget.demo)) {
    return res.status(200).json(buildDemoPayload(canComplete, showTasks, maxItems));
  }

  const accountKey = widget.account;
  const configuredCalendars = Array.isArray(widget.calendars)
    ? widget.calendars.filter((c) => typeof c === "string" && c.trim())
    : [];
  const cacheKey = `faro:gcal:data:${accountKey}:${configuredCalendars.join(",")}:${showTasks}:${canComplete}:${hidePastEvents}:${widget.timezone || ""}:${maxItems}`;

  const cachedPayload = cache.get(cacheKey);
  if (cachedPayload) {
    return res.status(200).json(cachedPayload);
  }

  try {
    const calListData = await googleFetch(accountKey, `${CALENDAR_API_BASE}/users/me/calendarList`);
    const allCalendars = Array.isArray(calListData?.items) ? calListData.items : [];
    const primaryCal = allCalendars.find((c) => c?.primary) || allCalendars[0];
    const zone = resolveZone(widget.timezone, primaryCal?.timeZone);

    let targetCalendars;
    if (configuredCalendars.length > 0) {
      const wanted = new Set(configuredCalendars);
      targetCalendars = allCalendars.filter((c) => wanted.has(c.id) || (wanted.has("primary") && c.primary));
      for (const id of configuredCalendars) {
        if (!targetCalendars.some((c) => c.id === id || (id === "primary" && c.primary))) {
          targetCalendars.push({ id, backgroundColor: "#3b82f6" });
        }
      }
    } else {
      targetCalendars = allCalendars.filter((c) => c?.selected !== false && !c?.deleted && !c?.hidden);
      if (targetCalendars.length === 0) {
        targetCalendars = [{ id: "primary", backgroundColor: "#3b82f6" }];
      }
    }

    const nowInZone = DateTime.now().setZone(zone);
    const dayStart = nowInZone.startOf("day");
    const dayEnd = nowInZone.endOf("day");
    const todayIso = dayStart.toISODate();

    const eventParams = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: dayStart.toISO(),
      timeMax: dayEnd.toISO(),
      timeZone: zone,
      maxResults: "50",
    });

    const [perCalendarEvents, tasks] = await Promise.all([
      Promise.all(
        targetCalendars.map(async (cal) => {
          const evData = await googleFetch(
            accountKey,
            `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(cal.id)}/events?${eventParams.toString()}`,
          );
          const items = Array.isArray(evData?.items) ? evData.items : [];
          return items
            .filter((ev) => ev?.status !== "cancelled" && !isDeclinedBySelf(ev))
            .map((ev) => {
              const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
              const startDt = allDay
                ? DateTime.fromISO(ev.start.date, { zone })
                : DateTime.fromISO(ev.start.dateTime, { zone });
              const endDt = allDay
                ? DateTime.fromISO(ev.end?.date || ev.start.date, { zone })
                : DateTime.fromISO(ev.end?.dateTime || ev.start.dateTime, { zone });

              const past = allDay ? false : endDt <= nowInZone;
              const timeLabel = allDay ? null : `${startDt.toFormat("HH:mm")}–${endDt.toFormat("HH:mm")}`;

              return {
                id: `${cal.id}:${ev.id}`,
                title: (ev.summary || "").trim() || "(Senza titolo)",
                start: startDt.toISO(),
                end: endDt.toISO(),
                sortTs: allDay ? dayStart.toMillis() - 1 : startDt.toMillis(),
                timeLabel,
                allDay,
                location: extractLocation(ev),
                color: cal.backgroundColor || "#3b82f6",
                link: ev.htmlLink || "https://calendar.google.com",
                past,
              };
            });
        }),
      ),
      showTasks ? fetchDueTasks(accountKey, todayIso) : Promise.resolve([]),
    ]);

    const mergedEvents = perCalendarEvents
      .flat()
      .filter((ev) => !hidePastEvents || !ev.past)
      .sort((a, b) => a.sortTs - b.sortTs)
      .slice(0, maxItems)
      .map(({ sortTs, ...rest }) => rest);

    const payload = {
      date: todayIso,
      events: mergedEvents,
      tasks: tasks.slice(0, maxItems),
      canComplete,
    };

    cache.put(cacheKey, payload, CACHE_TTL_MS);
    return res.status(200).json(payload);
  } catch (err) {
    if (err instanceof FaroOAuthError) {
      logger.debug("Google Calendar/Tasks error for '%s': %s", accountKey, err.message);
      return res.status(err.status || 500).json({ error: { message: err.message } });
    }
    logger.error("Unexpected error in googleCalendarProxyHandler: %s", err.message);
    return res.status(500).json({ error: { message: "Unexpected error loading Google Calendar data" } });
  }
}
