import { CircleCheck } from "lucide-react";

import { cn } from "@/lib/utils";

export type AvatarReadinessStatusBlockProps = {
  /** One-line status next to the avatar (e.g. identity / workspace context); no fetching here. */
  statusText: string;
  readinessPercent: number;
  /** Questionnaire formation hit 100%; enables completion chrome (distinct from readiness math). */
  isFormationComplete?: boolean;
  /** Shown inside the circular placeholder until a real avatar exists. */
  placeholderLabel?: string;
  className?: string;
};

function clampPercent(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function AvatarReadinessStatusBlock({
  statusText,
  readinessPercent,
  isFormationComplete = false,
  placeholderLabel = "Avatar",
  className,
}: AvatarReadinessStatusBlockProps) {
  const pct = clampPercent(readinessPercent);

  return (
    <div
      data-testid="dashboard-avatar-status-block"
      data-formation-complete={isFormationComplete ? "true" : undefined}
      className={cn("flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:shrink-0", className)}
    >
      <div className="relative shrink-0">
        <div
          data-testid="dashboard-avatar-placeholder"
          aria-label={placeholderLabel}
          className={cn(
            "flex aspect-square shrink-0 items-center justify-center rounded-full",
            "h-28 w-28 border-2 border-dashed",
            "text-muted-foreground text-xs font-medium",
            isFormationComplete
              ? "border-solid border-emerald-500/60 bg-emerald-500/10 ring-2 ring-emerald-500/40 ring-offset-2 ring-offset-background dark:border-emerald-400/50 dark:bg-emerald-500/15 dark:ring-emerald-400/35"
              : "border-border bg-muted/30",
          )}
        >
          {/* Inner slot preserves space for future <img /> */}
          <span className="px-3 text-center leading-snug" aria-hidden>
            {placeholderLabel}
          </span>
        </div>
        {isFormationComplete ? (
          <span
            className="pointer-events-none absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-background shadow-sm dark:bg-emerald-500"
            aria-hidden
          >
            <CircleCheck className="h-4 w-4" aria-hidden strokeWidth={2.5} />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex flex-col gap-1" aria-live="polite">
        <p
          data-testid="dashboard-avatar-status-text"
          className={cn(
            "text-sm leading-snug wrap-break-word",
            isFormationComplete ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {statusText}
        </p>
        <div data-testid="dashboard-avatar-readiness">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Total readiness</p>
          <p
            data-testid="dashboard-avatar-readiness-percent"
            className={cn(
              "font-semibold text-lg tabular-nums tracking-tight",
              isFormationComplete && "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {pct}%
          </p>
        </div>
      </div>
    </div>
  );
}
