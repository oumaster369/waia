import type { ModuleReadiness } from "@/lib/landing/module-readiness";

type ModuleReadinessProps = {
  readiness: ModuleReadiness;
  testIdPrefix: string;
};

export function ModuleReadinessBar({ readiness, testIdPrefix }: ModuleReadinessProps) {
  return (
    <div
      data-testid={`${testIdPrefix}-readiness`}
      className="mt-4 flex flex-col gap-2 border-t border-[rgba(218,200,160,0.14)] pt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          data-testid={`${testIdPrefix}-readiness-label`}
          className="text-xs font-semibold tracking-wide text-[#c9a96e] uppercase"
        >
          {readiness.maturity}
        </p>
        <p
          data-testid={`${testIdPrefix}-readiness-percent`}
          className="font-mono text-sm tabular-nums text-[#ebe4d4]"
        >
          {readiness.percent}%
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={readiness.percent}
        aria-label={`${readiness.name} readiness ${readiness.percent} percent, maturity ${readiness.maturity}`}
        className="h-2 w-full overflow-hidden rounded-full bg-[rgba(255,252,245,0.08)]"
      >
        <div
          data-testid={`${testIdPrefix}-readiness-bar`}
          className="h-full rounded-full bg-[linear-gradient(90deg,#c9a96e,#e8dcc4)]"
          style={{ width: `${readiness.percent}%` }}
        />
      </div>
      <p
        data-testid={`${testIdPrefix}-readiness-updated`}
        className="text-xs text-[rgba(180,175,168,0.8)]"
      >
        Readiness methodology updated {readiness.lastUpdatedAt}
      </p>
      <p
        data-testid={`${testIdPrefix}-readiness-method`}
        className="text-xs leading-relaxed text-[rgba(160,156,148,0.85)]"
      >
        {readiness.methodology}
      </p>
    </div>
  );
}
