import type { DashboardShellDemoSnapshot } from "@/components/dashboard/types";
import { INDICATOR_KEYS } from "@/components/dashboard/types";

export type DashboardTopBlockProps = {
  snapshot: Pick<DashboardShellDemoSnapshot, "indicatorPercents" | "totalCompletionPercent">;
};

export function DashboardTopBlock({ snapshot }: DashboardTopBlockProps) {
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
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 md:grid-cols-6">
          {INDICATOR_KEYS.map((key, idx) => (
            <div key={key} data-testid={`dashboard-indicator-${key.toLowerCase()}`}>
              <p className="text-muted-foreground text-xs">{key}</p>
              <p className="font-medium tabular-nums">{snapshot.indicatorPercents[idx]}%</p>
            </div>
          ))}
          <div
            data-testid="dashboard-total-readiness"
            className="col-span-full mt-3 border-border border-t pt-3 md:col-span-1 md:mt-0 md:border-t-0 md:border-none md:pt-0"
          >
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Total readiness
            </p>
            <p className="font-semibold text-lg tabular-nums">
              {snapshot.totalCompletionPercent}%
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
