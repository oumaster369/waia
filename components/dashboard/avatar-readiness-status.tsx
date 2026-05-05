import { cn } from "@/lib/utils";

export type AvatarReadinessStatusBlockProps = {
  /** One-line status next to the avatar (e.g. identity / workspace context); no fetching here. */
  statusText: string;
  readinessPercent: number;
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
  placeholderLabel = "Avatar",
  className,
}: AvatarReadinessStatusBlockProps) {
  const pct = clampPercent(readinessPercent);

  return (
    <div
      data-testid="dashboard-avatar-status-block"
      className={cn("flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:shrink-0", className)}
    >
      <div
        data-testid="dashboard-avatar-placeholder"
        aria-label={placeholderLabel}
        className={cn(
          "flex aspect-square bg-muted/30 shrink-0 items-center justify-center rounded-full",
          "h-28 w-28 border-2 border-dashed border-border",
          "text-muted-foreground text-xs font-medium",
        )}
      >
        {/* Inner slot preserves space for future <img /> */}
        <span className="px-3 text-center leading-snug" aria-hidden>
          {placeholderLabel}
        </span>
      </div>
      <div className="min-w-0 flex flex-col gap-1">
        <p
          data-testid="dashboard-avatar-status-text"
          className="text-muted-foreground text-sm leading-snug wrap-break-word"
        >
          {statusText}
        </p>
        <div data-testid="dashboard-avatar-readiness">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Total readiness</p>
          <p
            data-testid="dashboard-avatar-readiness-percent"
            className="font-semibold text-lg tabular-nums tracking-tight"
          >
            {pct}%
          </p>
        </div>
      </div>
    </div>
  );
}
