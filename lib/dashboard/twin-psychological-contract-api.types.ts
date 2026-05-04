/** Twin psychological contract v1 (DEE-23) — user-facing tone and safety envelope; no DB, no LLM. */

export const TWIN_PSYCHOLOGICAL_CONTRACT_SCHEMA_VERSION = "twin-psychological-contract-v1" as const;

export type TwinPsychologicalContractSchemaVersion = typeof TWIN_PSYCHOLOGICAL_CONTRACT_SCHEMA_VERSION;

/** Canonical modes (sorted for audit / binary search). */
export const TWIN_PSYCHOLOGICAL_CONTRACT_MODES = [
  "clarification",
  "contradiction_reflection",
  "gentle_challenge",
  "mirror",
  "prediction_reflection",
  "support",
] as const;

export type TwinPsychologicalContractMode = (typeof TWIN_PSYCHOLOGICAL_CONTRACT_MODES)[number];

export type TwinPsychologicalContractApiResponse = {
  schemaVersion: TwinPsychologicalContractSchemaVersion;
  /** Normalized canonical mode. */
  mode: string;
  message: string;
  grounding: string[];
  safetyNotes: string[];
};

export type BuildPsychologicalContractInput = {
  mode: string;
  message: string;
  /** Candidate grounding lines; only those substantiated by allowedMemorySnippets are kept. */
  grounding?: string[] | null;
  /** Optional candidate notes merged with filter/drop notes. */
  safetyNotes?: string[] | null;
  /** User-provided memory text; grounding must be supported by these snippets (substring rule). */
  allowedMemorySnippets: string[];
};

export type ValidatePsychologicalContractSuccess = { ok: true };

export type ValidatePsychologicalContractFailure = {
  ok: false;
  /** Sorted for deterministic output. */
  issues: string[];
};

export type ValidatePsychologicalContractResult =
  | ValidatePsychologicalContractSuccess
  | ValidatePsychologicalContractFailure;
