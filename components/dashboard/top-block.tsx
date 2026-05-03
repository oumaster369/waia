import type { IndicatorPresentationRow, IndicatorThresholdBand } from "@/lib/dashboard/indicator-ui";
import { cn } from "@/lib/utils";

export type DashboardTopBlockProps = {
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

export function DashboardTopBlock({
  indicatorPresentation,
  totalCompletionPercent,
}: DashboardTopBlockProps) {
  return (
    <header
      data-testid="dashboard-top-block"
      className="border-border border-b bg-background px-6 py-4"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div
          data-testid="dashboard-avatar-placeholder"
          aria-hidden="true"
          className="flex h-32 w-full max-w-[12rem] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 text-muted-foreground text-sm lg:shrink-0"
        >
          Avatar placeholder
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-6">
          {indicatorPresentation.map((row) => {
            const labelId = `dashboard-indicator-${row.key}-label`;
            const hintId = `dashboard-indicator-${row.key}-hint`;
            return (
              <div
                key={row.key}
                data-testid={`dashboard-indicator-${row.key}`}
                data-threshold={row.band}
                className={cn(
                  "flex flex-col gap-1 rounded-md border px-2 py-2",
                  thresholdPanelClass(row.band),
                )}
                aria-describedby={hintId}
              >
                <p id={labelId} className="text-muted-foreground text-xs font-medium">
                  {row.label}
                </p>
                <p
                  className={cn("font-semibold tabular-nums", thresholdPercentClass(row.band))}
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
          <div
            data-testid="dashboard-total-readiness"
            className="col-span-full mt-1 border-border border-t pt-3 md:col-span-1 md:mt-0 md:border-t-0 md:border-none md:pt-0"
          >
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Total readiness
            </p>
            <p className="font-semibold text-lg tabular-nums">{totalCompletionPercent}%</p>
          </div>
        </div>
      </div>
    </header>
  );
}
