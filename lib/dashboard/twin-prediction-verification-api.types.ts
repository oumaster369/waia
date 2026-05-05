/** POST /api/dashboard/twin/prediction/verification — Twin prediction verification (DEE-34). */

export const TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION = "twin-prediction-verification-v1" as const;

export type TwinPredictionVerificationSchemaVersion =
  typeof TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION;

/** Max characters for scenario and optional correction (aligned with twin dialogue / prediction). */
export const MAX_VERIFICATION_SCENARIO_CHARS = 16_384;
export const MAX_VERIFICATION_CORRECTION_CHARS = 16_384;

export const TWIN_PREDICTION_VERIFICATION_KINDS = [
  "accurate",
  "partially_accurate",
  "inaccurate",
] as const;

export type TwinPredictionVerificationKind = (typeof TWIN_PREDICTION_VERIFICATION_KINDS)[number];

export type TwinPredictionVerificationSubmitBody = {
  predictionId?: string | null;
  scenario: string;
  verification: TwinPredictionVerificationKind;
  correction?: string | null;
};

export type TwinPredictionVerificationItemDto = {
  id: string;
  predictionId: string | null;
  scenario: string;
  verification: TwinPredictionVerificationKind;
  correction: string | null;
  /** ISO 8601 */
  createdAt: string;
};

export type TwinPredictionVerificationAppendApiResponse = {
  schemaVersion: TwinPredictionVerificationSchemaVersion;
  verification: TwinPredictionVerificationItemDto;
};

export type TwinPredictionVerificationListApiResponse = {
  schemaVersion: TwinPredictionVerificationSchemaVersion;
  verifications: TwinPredictionVerificationItemDto[];
};
