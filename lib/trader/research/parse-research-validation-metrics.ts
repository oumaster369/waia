import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";

export function parseResearchValidationMetricsJson(json: string): ResearchValidationMetrics {
  const parsed = JSON.parse(json) as ResearchValidationMetrics;
  if (
    parsed.schemaVersion !== RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1 &&
    parsed.schemaVersion !== RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
  ) {
    throw new Error("[research] unsupported ResearchValidationMetrics schemaVersion");
  }
  return parsed;
}
