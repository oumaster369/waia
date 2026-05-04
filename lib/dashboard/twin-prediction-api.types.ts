/** POST /api/dashboard/twin/prediction — Twin forward-model (DEE-33). Body field: `scenario`. */

export type TwinPredictionApiResponse = {
  outcome: string;
  reasoning: string[];
  /** Deterministic composite in [0, 1]; rounded for stable JSON. */
  confidence: number;
};

/** Accepted JSON payload for Twin prediction POST. */
export type TwinPredictionSubmitBody = {
  scenario: string;
};
