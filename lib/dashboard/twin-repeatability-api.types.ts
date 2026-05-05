/** GET /api/dashboard/twin/repeatability — aggregated repeatability (DEE-28). */

export const TWIN_REPEATABILITY_SCHEMA_VERSION = "twin-repeatability-v1" as const;

export type TwinRepeatabilitySchemaVersion = typeof TWIN_REPEATABILITY_SCHEMA_VERSION;

export type TwinRepeatabilityPatternAggregate = {
  patternType: string;
  occurrences: number;
  /** ISO 8601 */
  lastSeenAt: string;
};

export type TwinRepeatabilityApiResponse = {
  schemaVersion: TwinRepeatabilitySchemaVersion;
  repeatedPatterns: TwinRepeatabilityPatternAggregate[];
};
