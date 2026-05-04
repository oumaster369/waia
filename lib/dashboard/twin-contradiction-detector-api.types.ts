/** POST /api/dashboard/twin/contradictions — deterministic contradiction detector (DEE-30). */

export const TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION = "twin-contradiction-detector-v1" as const;

export type TwinContradictionDetectorSchemaVersion =
  typeof TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION;

/** Same cap as Twin prediction / verification scenario fields. */
export const MAX_SCENARIO_CHARS = 16_384;

/** Request JSON contract (validated in route handler). */
export type TwinContradictionDetectorSubmitBody = {
  scenario?: string | null;
};

export type TwinContradictionDetectorFindingDto = {
  type: string;
  description: string;
  evidence: string[];
  severity: "low" | "medium" | "high";
};

export type TwinContradictionDetectorApiResponse = {
  schemaVersion: TwinContradictionDetectorSchemaVersion;
  contradictions: TwinContradictionDetectorFindingDto[];
  memoryItemsConsidered: number;
  verificationItemsConsidered: number;
  seedQueryCount: number;
  scenarioUsed: boolean;
};
