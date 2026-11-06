import classNames from "classnames";
import { DateTime } from "luxon";
import { useTranslation } from "next-i18next/pages";
import { useContext, useState } from "react";
import CardBadge from "components/faro/card-badge";
import CardFooterLink from "components/faro/card-footer-link";
import Container from "components/services/widget/container";
import { SettingsContext } from "utils/contexts/settings";

import { getURLSearchParams } from "utils/proxy/api-helpers";
import useWidgetAPI from "utils/proxy/use-widget-api";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function formatBadgeDate(isoDate, locale) {
  if (!isoDate) {
    return null;
  }
  const dt = DateTime.fromISO(isoDate);
  if (!dt.isValid) {
    return null;
  }
  const formatted = dt.setLocale(locale || "en").toFormat("ccc d LLL");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function EventRow({ event, target, allDayLabel }) {
  const content = (
    <>
      <span
        className="w-1 min-h-6 rounded-full shrink-0 self-stretch"
        style={{ backgroundColor: event.color || "#3b82f6" }}
        aria-hidden="true"
      />
      <div className="w-24 shrink-0 flex items-center text-xs tabular-nums text-theme-600 dark:text-theme-300">
        {event.allDay ? allDayLabel : event.timeLabel}
      </div>
      <div className="min-w-0 flex-1 flex flex-col justify-center">
        <span className="truncate text-xs font-medium text-theme-800 dark:text-theme-100">{event.title}</span>
        {event.location && (
          <span className="truncate text-xs font-light text-theme-500 dark:text-theme-400 mt-0.5">
            {event.location}
          </span>
        )}
      </div>
    </>
  );

  const rowClasses = classNames(
    "flex items-center gap-2.5 px-2.5 py-2.5 text-left transition-colors",
    event.past && "opacity-55",
    event.link && "hover:bg-theme-200/40 dark:hover:bg-white/5",
  );

  if (!event.link) {
    return <div className={rowClasses}>{content}</div>;
  }

  return (
    <a href={event.link} target={target} rel="noopener noreferrer" className={rowClasses}>
      {content}
    </a>
  );
}

function TaskRow({ task, canComplete, isPending, onComplete, dueTodayLabel, overdueLabel, completeAriaLabel }) {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2.5 text-left">
      <span
        className={classNames(
          "w-1 min-h-6 rounded-full shrink-0 self-stretch",
          task.overdue ? "bg-rose-500" : "bg-amber-500",
        )}
        aria-hidden="true"
      />
      <div
        className={classNames(
          "w-24 shrink-0 text-xs font-medium",
          task.overdue ? "text-rose-500 dark:text-rose-400" : "text-amber-600 dark:text-amber-400",
        )}
      >
        {task.overdue ? overdueLabel : dueTodayLabel}
      </div>
      <div className="min-w-0 flex-1">
        <span
          className={classNames(
            "block truncate text-xs font-medium text-theme-800 dark:text-theme-100",
            isPending && "line-through opacity-50",
          )}
        >
          {task.title}
        </span>
      </div>
      {canComplete && (
        <input
          type="checkbox"
          checked={isPending}
          disabled={isPending}
          aria-label={completeAriaLabel}
          onChange={() => onComplete(task)}
          className="h-4 w-4 shrink-0 rounded border-theme-400/70 dark:border-white/25 bg-transparent text-blue-500 focus:ring-blue-500/40 cursor-pointer disabled:opacity-50"
        />
      )}
    </div>
  );
}

export default function Component({ service }) {
  const { t, i18n } = useTranslation();
  const { settings } = useContext(SettingsContext);
  const { widget } = service;
  const [pendingIds, setPendingIds] = useState({});

  const { data, error, mutate } = useWidgetAPI(widget, undefined, undefined, {
    refreshInterval: REFRESH_INTERVAL_MS,
  });

  if (error) {
    return <Container service={service} error={error} />;
  }

  const target = service.target ?? settings?.target ?? "_blank";

  async function handleCompleteTask(task) {
    if (!data || pendingIds[task.id]) {
      return;
    }

    const previousData = data;
    const optimisticData = {
      ...data,
      tasks: (data.tasks || []).filter((item) => item.id !== task.id),
    };

    setPendingIds((prev) => ({ ...prev, [task.id]: true }));
    await mutate(optimisticData, { revalidate: false });

    try {
      const params = getURLSearchParams(widget, "completeTask");
      params.append(
        "segments",
        JSON.stringify({
          tasklist: task.tasklist,
          task: task.id,
        }),
      );

      const response = await fetch(`/api/services/proxy?${params.toString()}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await mutate();
    } catch {
      await mutate(previousData, { revalidate: false });
    } finally {
      setPendingIds((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
    }
  }

  const badgeLabel = formatBadgeDate(data?.date, i18n?.language);
  const events = data?.events ?? [];
  const tasks = data?.tasks ?? [];
  const isEmpty = Boolean(data) && events.length === 0 && tasks.length === 0;

  return (
    <>
      {badgeLabel && <CardBadge variant="neutral">{badgeLabel}</CardBadge>}
      <Container service={service}>
        <div className="flex flex-col w-full">
          {!data ? (
            <div className="w-full border-t border-theme-200/60 dark:border-white/10 divide-y divide-theme-200/60 dark:divide-white/10">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="px-2.5 py-2.5 flex items-center gap-2.5 animate-pulse">
                  <span className="w-1 h-7 rounded-full bg-theme-300/60 dark:bg-white/15 shrink-0" />
                  <div className="w-20 h-3 rounded bg-theme-200/80 dark:bg-white/10 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 rounded bg-theme-300/60 dark:bg-white/15" />
                    <div className="h-2.5 w-1/2 rounded bg-theme-200/60 dark:bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <div className="w-full border-t border-theme-200/60 dark:border-white/10 px-3 py-4 text-center text-xs font-light text-theme-500 dark:text-theme-400">
              {t("googlecalendar.noEvents")}
            </div>
          ) : (
            <div className="w-full border-t border-theme-200/60 dark:border-white/10 divide-y divide-theme-200/60 dark:divide-white/10">
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  target={target}
                  allDayLabel={t("googlecalendar.allDay")}
                />
              ))}
              {tasks.map((task) => (
                <TaskRow
                  key={`task-${task.tasklist}-${task.id}`}
                  task={task}
                  canComplete={Boolean(data.canComplete)}
                  isPending={Boolean(pendingIds[task.id])}
                  onComplete={handleCompleteTask}
                  dueTodayLabel={t("googlecalendar.dueToday")}
                  overdueLabel={t("googlecalendar.overdue")}
                  completeAriaLabel={t("googlecalendar.completeTask", { title: task.title })}
                />
              ))}
            </div>
          )}
          <CardFooterLink
            service={service}
            fallbackHref="https://calendar.google.com"
            label={t("googlecalendar.openCalendar")}
          />
        </div>
      </Container>
    </>
  );
}
