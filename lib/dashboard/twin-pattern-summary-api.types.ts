/** GET /api/dashboard/twin/pattern-summary — deterministic reasoning over Twin memory (DEE-31). */

export const TWIN_PATTERN_SUMMARY_SCHEMA_VERSION = "twin-pattern-summary-v1" as const;

export type TwinPatternSummarySchemaVersion = typeof TWIN_PATTERN_SUMMARY_SCHEMA_VERSION;

/** Response body; all list fields are always present (possibly empty). */
export type TwinPatternSummaryApiResponse = {
  schemaVersion: TwinPatternSummarySchemaVersion;
  repeatedBehaviors: string[];
  emotionalPatterns: string[];
  decisionTendencies: string[];
  contradictions: string[];
  dominantThemes: string[];
  /** Hits passed into the summarizer after retrieval fusion (deduped, capped). */
  memoryItemsConsidered: number;
  /** Number of fixed embedding seed queries executed for fusion. */
  seedQueryCount: number;
};
