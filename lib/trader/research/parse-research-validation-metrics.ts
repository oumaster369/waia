import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";

export function parseResearchValidationMetricsJson(json: string): ResearchValidationMetrics {
  const parsed = JSON.parse(json) as ResearchValidationMetrics;
  if (parsed.schemaVersion !== "1.0.0") {
    throw new Error("[research] unsupported ResearchValidationMetrics schemaVersion");
  }
  return parsed;
}
