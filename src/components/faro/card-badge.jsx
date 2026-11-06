import classNames from "classnames";

export default function CardBadge({ children, variant = "neutral" }) {
  if (children === null || children === undefined || children === "") {
    return null;
  }

  return (
    <div
      className={classNames(
        "absolute top-3 right-3 z-10 select-none rounded-full px-2.5 py-0.5 text-xs font-medium",
        variant === "accent"
          ? "bg-blue-500/15 text-blue-600 border border-blue-500/25 dark:bg-blue-400/15 dark:text-blue-300 dark:border-blue-400/20"
          : "bg-theme-200/60 text-theme-700 dark:bg-white/10 dark:text-theme-300",
      )}
    >
      {children}
    </div>
  );
}
