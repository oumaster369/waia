import type { ResearchPortfolioConfig } from "@/lib/trader/research/research-portfolio-config";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { isResearchValidationMetricsV2 } from "@/lib/trader/research/research-validation-metrics-taxonomy";

export const M9_V2_METRICS_EXPORT_SCHEMA_VERSION = "m9_v2_metrics_export_v1";

export type M9V2MetricsExport = {
  schemaVersion: typeof M9_V2_METRICS_EXPORT_SCHEMA_VERSION;
  generatedAt: string;
  metricsSchemaVersion: string;
  portfolioConfig: ResearchPortfolioConfig;
  validationMetrics: ResearchValidationMetrics;
  blindMetrics: ResearchValidationMetrics;
  aggregateCoherent: boolean;
};

export function buildM9V2MetricsExport(input: {
  portfolioConfig: ResearchPortfolioConfig;
  validationMetrics: ResearchValidationMetrics;
  blindMetrics: ResearchValidationMetrics;
  generatedAt?: string;
}): M9V2MetricsExport {
  const metricsSchemaVersion = isResearchValidationMetricsV2(input.validationMetrics)
    ? input.validationMetrics.schemaVersion
    : input.validationMetrics.schemaVersion;

  return {
    schemaVersion: M9_V2_METRICS_EXPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    metricsSchemaVersion,
    portfolioConfig: input.portfolioConfig,
    validationMetrics: input.validationMetrics,
    blindMetrics: input.blindMetrics,
    aggregateCoherent: isResearchValidationMetricsV2(input.validationMetrics),
  };
}
