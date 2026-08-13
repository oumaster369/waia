import type { ModuleReadiness } from "@/lib/landing/module-readiness";
import { MATURITY_SCALE, maturityStageIndex } from "@/lib/landing/module-readiness";
import { cn } from "@/lib/utils";

type ModuleReadinessProps = {
  readiness: ModuleReadiness;
  testIdPrefix: string;
};

/**
 * Qualitative five-stage maturity scale — no fabricated percentages.
 */
export function ModuleReadinessBar({ readiness, testIdPrefix }: ModuleReadinessProps) {
  const primaryIndex = maturityStageIndex(readiness.primaryLabel);
  const facetSummary = readiness.facets.map((f) => `${f.name}: ${f.label}`).join("; ");

  return (
    <div
      data-testid={`${testIdPrefix}-readiness`}
      className="mt-6 flex flex-col gap-3 border-t border-[rgba(218,200,160,0.14)] pt-5 sm:mt-7 sm:pt-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          data-testid={`${testIdPrefix}-readiness-label`}
          className="text-xs font-semibold tracking-wide text-[#c9a96e] uppercase"
        >
          Maturity — {readiness.primaryLabel}
        </p>
        <p
          data-testid={`${testIdPrefix}-readiness-updated`}
          className="text-xs text-[rgba(180,175,168,0.8)]"
        >
          Canon labels as of {readiness.lastUpdatedAt}
        </p>
      </div>

      <ol
        data-testid={`${testIdPrefix}-readiness-scale`}
        aria-label={`${readiness.name} maturity scale. Primary stage ${readiness.primaryLabel}. Facets: ${facetSummary}.`}
        className="grid grid-cols-5 gap-1"
      >
        {MATURITY_SCALE.map((stage, index) => {
          const reached = index <= primaryIndex;
          const isPrimary = index === primaryIndex;
          return (
            <li
              key={stage}
              data-testid={`${testIdPrefix}-readiness-stage-${stage.toLowerCase()}`}
              data-reached={reached ? "true" : "false"}
              data-primary={isPrimary ? "true" : "false"}
              className={cn(
                "flex flex-col gap-1 rounded-md border px-1 py-2 text-center sm:px-2",
                reached
                  ? "border-[rgba(218,200,160,0.35)] bg-[rgba(201,169,110,0.14)]"
                  : "border-[rgba(218,200,160,0.1)] bg-[rgba(255,252,245,0.03)]",
                isPrimary && "ring-1 ring-[#c9a96e]/60",
              )}
            >
              <span
                className={cn(
                  "text-[0.65rem] leading-tight font-medium sm:text-xs",
                  reached ? "text-[#ebe4d4]" : "text-[rgba(160,156,148,0.75)]",
                )}
              >
                {stage}
              </span>
            </li>
          );
        })}
      </ol>

      <ul data-testid={`${testIdPrefix}-readiness-facets`} className="flex flex-col gap-1.5">
        {readiness.facets.map((facet) => (
          <li
            key={`${facet.name}-${facet.label}`}
            data-testid={`${testIdPrefix}-readiness-facet`}
            className="text-xs leading-relaxed text-[rgba(180,175,168,0.9)]"
          >
            <span className="font-medium text-[rgba(210,205,195,0.95)]">{facet.name}</span>
            {": "}
            <span className="text-[#c9a96e]">{facet.label}</span>
            {facet.note ? ` — ${facet.note}` : null}
          </li>
        ))}
      </ul>

      <p
        data-testid={`${testIdPrefix}-readiness-method`}
        className="text-xs leading-relaxed text-[rgba(160,156,148,0.85)]"
      >
        {readiness.evidenceNote}
      </p>
    </div>
  );
}
