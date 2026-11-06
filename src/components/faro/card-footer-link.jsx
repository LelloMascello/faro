import { useContext } from "react";
import { SettingsContext } from "utils/contexts/settings";

export default function CardFooterLink({ service, fallbackHref, label }) {
  const { settings } = useContext(SettingsContext);
  const href = service?.href && service.href !== "#" ? service.href : fallbackHref;

  if (!href || !label) {
    return null;
  }

  const target = service?.target ?? settings?.target ?? "_blank";

  return (
    <a
      href={href}
      target={target}
      rel="noopener noreferrer"
      className="flex items-center justify-center w-full py-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:bg-theme-200/30 dark:hover:bg-white/5 border-t border-theme-200/60 dark:border-white/10 transition-colors"
    >
      <span>{label} →</span>
    </a>
  );
}
