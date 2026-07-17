import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  buildResearchRegimeCoverage,
  hasSufficientCanonicalRegimeCoverage,
} from "@/lib/trader/research/regime-taxonomy";
import type { ResearchRegimeCoverage } from "@/lib/trader/research/research-evidence-export.types";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { collectRegimeLabelsFromMetrics } from "@/lib/trader/research/regime-coverage";

export const HTR_WP22_MULTI_REGIME_POSTGRES_EVIDENCE_SCHEMA =
  "htr-wp22-multi-regime-postgres-evidence/v1" as const;

export type HtrWp22MultiRegimePostgresEvidenceResult = {
  schemaVersion: typeof HTR_WP22_MULTI_REGIME_POSTGRES_EVIDENCE_SCHEMA;
  terminalState: "HTR_WP22_MULTI_REGIME_POSTGRES_PASS" | "HTR_WP22_MULTI_REGIME_POSTGRES_FAIL";
  gapId: "HTR-GAP-044";
  regimeCoverage: ResearchRegimeCoverage;
  observedRegimeLabels: string[];
  metricsSources: {
    validation: boolean;
    walkForward: boolean;
    blind: boolean;
  };
  payloadSha256?: string;
};

export function buildHtrWp22MultiRegimePostgresEvidence(input: {
  validationMetrics: ResearchValidationMetrics;
  walkForwardMetrics: readonly ResearchValidationMetrics[];
  blindMetrics: ResearchValidationMetrics;
}): HtrWp22MultiRegimePostgresEvidenceResult {
  const observedRegimeLabels = collectRegimeLabelsFromMetrics([
    input.validationMetrics,
    ...input.walkForwardMetrics,
    input.blindMetrics,
  ]);
  const regimeCoverage = buildResearchRegimeCoverage(observedRegimeLabels);
  const passed = hasSufficientCanonicalRegimeCoverage(regimeCoverage);

  const semanticBody = {
    schemaVersion: HTR_WP22_MULTI_REGIME_POSTGRES_EVIDENCE_SCHEMA,
    terminalState: passed
      ? ("HTR_WP22_MULTI_REGIME_POSTGRES_PASS" as const)
      : ("HTR_WP22_MULTI_REGIME_POSTGRES_FAIL" as const),
    gapId: "HTR-GAP-044" as const,
    regimeCoverage,
    observedRegimeLabels,
    metricsSources: {
      validation: input.validationMetrics.byRegime.length >= 0,
      walkForward: input.walkForwardMetrics.length >= 0,
      blind: input.blindMetrics.byRegime.length >= 0,
    },
  };

  return {
    ...semanticBody,
    payloadSha256: computeSemanticSha256Hex(semanticBody),
  };
}

export function evaluateHtrWp22MultiRegimePostgresEvidence(
  result: HtrWp22MultiRegimePostgresEvidenceResult,
): boolean {
  return (
    result.terminalState === "HTR_WP22_MULTI_REGIME_POSTGRES_PASS" &&
    hasSufficientCanonicalRegimeCoverage(result.regimeCoverage)
  );
}
