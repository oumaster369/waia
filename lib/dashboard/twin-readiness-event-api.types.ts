/** Twin readiness event catalog (DEE-43) — stable vocabulary for future unlock/progress; no DB, no LLM. */

import type { TwinReadinessScores } from "@/lib/dashboard/twin-readiness-api.types";

export const TWIN_READINESS_EVENTS_SCHEMA_VERSION = "twin-readiness-events-v1" as const;

export type TwinReadinessEventsSchemaVersion = typeof TWIN_READINESS_EVENTS_SCHEMA_VERSION;

/** Canonical event identifiers (fixed set of eight). */
export const TWIN_READINESS_EVENT_TYPES = [
  "base_model_answered",
  "contradiction_detected",
  "dialogue_turn_created",
  "diary_entry_created",
  "prediction_generated",
  "prediction_verified",
  "repeatability_recorded",
  "scenario_answer_created",
] as const;

export type TwinReadinessEventType = (typeof TWIN_READINESS_EVENT_TYPES)[number];

/** Aligns with `TwinReadinessScores` keys from DEE-22. */
export type TwinReadinessDimension = keyof TwinReadinessScores;

export type TwinReadinessEventDescriptor = {
  type: TwinReadinessEventType;
  /** Stable subsystem tag (no user ids). */
  source: string;
  /** Relative importance within event vocabulary; deterministic, in [0, 1]. */
  weight: number;
  readinessDimension: TwinReadinessDimension;
};

export type TwinReadinessEventCatalogSummary = {
  schemaVersion: "twin-readiness-events-v1";
  eventCount: number;
  /** Lexicographically sorted event types. */
  types: TwinReadinessEventType[];
  /** Count of catalog entries per maturity dimension. */
  byDimension: Record<TwinReadinessDimension, number>;
};
