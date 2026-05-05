import { AvatarReadinessStatusBlock } from "@/components/dashboard/avatar-readiness-status";
import type { IndicatorPresentationRow, IndicatorThresholdBand } from "@/lib/dashboard/indicator-ui";
import { cn } from "@/lib/utils";

export type DashboardTopBlockProps = {
  avatarStatusText: string;
  indicatorPresentation: readonly IndicatorPresentationRow[];
  totalCompletionPercent: number;
};

function thresholdPanelClass(band: IndicatorThresholdBand): string {
  switch (band) {
    case "low":
      return "border-destructive/40 bg-destructive/5";
    case "medium":
      return "border-amber-500/35 bg-amber-500/5 dark:border-amber-400/35 dark:bg-amber-500/10";
    case "high":
      return "border-emerald-500/35 bg-emerald-500/5 dark:border-emerald-400/35 dark:bg-emerald-500/10";
    default: {
      const _b: never = band;
      return _b;
    }
  }
}

function thresholdPercentClass(band: IndicatorThresholdBand): string {
  switch (band) {
    case "low":
      return "text-destructive";
    case "medium":
      return "text-amber-600 dark:text-amber-400";
    case "high":
      return "text-emerald-600 dark:text-emerald-400";
    default: {
      const _b: never = band;
      return _b;
    }
  }
}

/** Unified panel when questionnaire formation is complete (100% aggregate). */
const formationCompletePanelClass =
  "border-emerald-500/45 bg-emerald-500/8 dark:border-emerald-400/40 dark:bg-emerald-500/12";

const formationCompletePercentClass = "text-emerald-600 dark:text-emerald-400";

export function DashboardTopBlock({
  avatarStatusText,
  indicatorPresentation,
  totalCompletionPercent,
}: DashboardTopBlockProps) {
  const isFormationComplete = totalCompletionPercent === 100;

  return (
    <header
      data-testid="dashboard-top-block"
      data-formation-complete={isFormationComplete ? "true" : undefined}
      className={cn(
        "border-border border-b bg-background px-6 py-4",
        isFormationComplete &&
          "bg-gradient-to-br from-emerald-500/[0.04] via-background to-background dark:from-emerald-500/[0.07]",
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <AvatarReadinessStatusBlock
          statusText={avatarStatusText}
          readinessPercent={totalCompletionPercent}
          isFormationComplete={isFormationComplete}
        />
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-6 md:justify-items-stretch">
          {indicatorPresentation.map((row) => {
            const labelId = `dashboard-indicator-${row.key}-label`;
            const hintId = `dashboard-indicator-${row.key}-hint`;
            return (
              <div
                key={row.key}
                data-testid={`dashboard-indicator-${row.key}`}
                {...(isFormationComplete
                  ? { "data-formation-complete": "true" }
                  : { "data-threshold": row.band })}
                className={cn(
                  "flex flex-col gap-1 rounded-md border px-2 py-2",
                  isFormationComplete
                    ? formationCompletePanelClass
                    : thresholdPanelClass(row.band),
                )}
                aria-describedby={hintId}
              >
                <p id={labelId} className="text-muted-foreground text-xs font-medium">
                  {row.label}
                </p>
                <p
                  className={cn(
                    "font-semibold tabular-nums",
                    isFormationComplete
                      ? formationCompletePercentClass
                      : thresholdPercentClass(row.band),
                  )}
                  aria-labelledby={labelId}
                >
                  {row.percent}%
                </p>
                <p id={hintId} className="text-muted-foreground text-xs leading-snug">
                  {row.hint}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </header>
  );
}
