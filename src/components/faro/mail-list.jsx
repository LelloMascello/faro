import classNames from "classnames";
import { DateTime } from "luxon";
import { useTranslation } from "next-i18next/pages";
import { useContext } from "react";
import { SettingsContext } from "utils/contexts/settings";

export function formatMailTimestamp(isoDate, t, i18nLanguage) {
  if (!isoDate) {
    return "";
  }
  const dt = DateTime.fromISO(isoDate).toLocal();
  if (!dt.isValid) {
    return "";
  }

  const now = DateTime.local();
  if (dt.hasSame(now, "day")) {
    return dt.toFormat("HH:mm");
  }
  if (dt.hasSame(now.minus({ days: 1 }), "day")) {
    return t("faromail.yesterday");
  }
  return dt.setLocale(i18nLanguage || "en").toFormat("d LLL");
}

function MailRowWrapper({ href, target, className, children }) {
  if (!href) {
    return <div className={className}>{children}</div>;
  }
  return (
    <a
      href={href}
      target={target}
      rel="noopener noreferrer"
      className={classNames(className, "hover:bg-theme-200/40 dark:hover:bg-white/5 transition-colors")}
    >
      {children}
    </a>
  );
}

export default function MailList({ messages, loading = false, target: targetProp, skeletonCount = 3 }) {
  const { t, i18n } = useTranslation();
  const { settings } = useContext(SettingsContext);
  const target = targetProp ?? settings?.target ?? "_blank";

  if (loading) {
    return (
      <div className="w-full border-t border-theme-200/60 dark:border-white/10 divide-y divide-theme-200/60 dark:divide-white/10">
        {Array.from({ length: skeletonCount }, (_, idx) => (
          <div key={idx} className="px-2.5 py-2.5 flex items-start gap-2.5 animate-pulse">
            <span className="w-2 h-2 mt-1.5 rounded-full bg-theme-300/60 dark:bg-white/15 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-1/3 rounded bg-theme-300/60 dark:bg-white/15" />
              <div className="h-3 w-2/3 rounded bg-theme-200/80 dark:bg-white/10" />
              <div className="h-2.5 w-5/6 rounded bg-theme-200/60 dark:bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!messages?.length) {
    return (
      <div className="w-full border-t border-theme-200/60 dark:border-white/10 px-3 py-4 text-center text-xs font-light text-theme-500 dark:text-theme-400">
        {t("faromail.noMail")}
      </div>
    );
  }

  return (
    <div className="w-full border-t border-theme-200/60 dark:border-white/10 divide-y divide-theme-200/60 dark:divide-white/10">
      {messages.map((item) => {
        const timeLabel = formatMailTimestamp(item.date, t, i18n?.language);
        return (
          <MailRowWrapper
            key={item.id}
            href={item.link}
            target={target}
            className="flex items-start gap-2.5 px-2.5 py-2 text-left"
          >
            <div className="w-2.5 pt-1.5 shrink-0 flex justify-center">
              {item.unread ? (
                <span
                  data-testid="unread-dot"
                  className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400"
                  aria-hidden="true"
                />
              ) : (
                <span className="w-2 h-2" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={classNames(
                    "truncate text-xs",
                    item.unread
                      ? "font-semibold text-theme-800 dark:text-theme-100"
                      : "font-medium text-theme-700 dark:text-theme-200",
                  )}
                >
                  {item.from}
                </span>
                {timeLabel && (
                  <span className="shrink-0 text-[11px] font-normal tabular-nums text-theme-500 dark:text-theme-400">
                    {timeLabel}
                  </span>
                )}
              </div>
              <div
                className={classNames(
                  "truncate text-xs mt-0.5",
                  item.unread ? "text-theme-800 dark:text-theme-100" : "text-theme-700 dark:text-theme-200",
                )}
              >
                {item.subject}
              </div>
              {item.snippet && (
                <div className="truncate text-xs font-light text-theme-500 dark:text-theme-400 mt-0.5">
                  {item.snippet}
                </div>
              )}
            </div>
          </MailRowWrapper>
        );
      })}
    </div>
  );
}
