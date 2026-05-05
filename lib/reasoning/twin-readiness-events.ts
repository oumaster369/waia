import "server-only";

/**
 * DEE-43 Frozen readiness event catalog — deterministic weights and dimension tags only.
 * No user state, no timestamps, no persistence.
 */

import type {
  TwinReadinessDimension,
  TwinReadinessEventCatalogSummary,
  TwinReadinessEventDescriptor,
  TwinReadinessEventType,
} from "@/lib/dashboard/twin-readiness-event-api.types";
import {
  TWIN_READINESS_EVENTS_SCHEMA_VERSION,
  TWIN_READINESS_EVENT_TYPES,
} from "@/lib/dashboard/twin-readiness-event-api.types";

export { TWIN_READINESS_EVENTS_SCHEMA_VERSION, TWIN_READINESS_EVENT_TYPES };

const DIMENSION_ORDER: readonly TwinReadinessDimension[] = [
  "baseModel",
  "memory",
  "patterns",
  "contradictions",
  "consistency",
  "feedback",
];

/**
 * Eight events, lexicographically sorted by `type`. Weights are fixed priorities in [0, 1].
 * Dimensions: every `TwinReadinessDimension` appears at least once (memory has three sources).
 */
export const TWIN_READINESS_EVENT_CATALOG: readonly TwinReadinessEventDescriptor[] = [
  {
    type: "base_model_answered",
    source: "twin_base_model",
    weight: 0.22,
    readinessDimension: "baseModel",
  },
  {
    type: "contradiction_detected",
    source: "twin_contradictions",
    weight: 0.18,
    readinessDimension: "contradictions",
  },
  {
    type: "dialogue_turn_created",
    source: "twin_dialogue",
    weight: 0.1,
    readinessDimension: "memory",
  },
  {
    type: "diary_entry_created",
    source: "diary",
    weight: 0.11,
    readinessDimension: "memory",
  },
  {
    type: "prediction_generated",
    source: "twin_prediction",
    weight: 0.16,
    readinessDimension: "patterns",
  },
  {
    type: "prediction_verified",
    source: "twin_verification",
    weight: 0.2,
    readinessDimension: "feedback",
  },
  {
    type: "repeatability_recorded",
    source: "twin_repeatability",
    weight: 0.14,
    readinessDimension: "consistency",
  },
  {
    type: "scenario_answer_created",
    source: "diary_scenario",
    weight: 0.09,
    readinessDimension: "memory",
  },
];

const BY_TYPE = new Map<TwinReadinessEventType, TwinReadinessEventDescriptor>(
  TWIN_READINESS_EVENT_CATALOG.map((e) => [e.type, e]),
);

export function getTwinReadinessEventByType(type: string): TwinReadinessEventDescriptor | undefined {
  return BY_TYPE.get(type as TwinReadinessEventType);
}

export function listTwinReadinessEventsForDimension(
  dimension: TwinReadinessDimension,
): readonly TwinReadinessEventDescriptor[] {
  const out = TWIN_READINESS_EVENT_CATALOG.filter((e) => e.readinessDimension === dimension);
  return [...out].sort((a, b) => a.type.localeCompare(b.type));
}

export function summarizeTwinReadinessEventCatalog(): TwinReadinessEventCatalogSummary {
  const byDimension = {} as Record<TwinReadinessDimension, number>;
  for (const d of DIMENSION_ORDER) {
    byDimension[d] = 0;
  }
  for (const e of TWIN_READINESS_EVENT_CATALOG) {
    byDimension[e.readinessDimension] += 1;
  }

  return {
    schemaVersion: TWIN_READINESS_EVENTS_SCHEMA_VERSION,
    eventCount: TWIN_READINESS_EVENT_CATALOG.length,
    types: [...TWIN_READINESS_EVENT_TYPES],
    byDimension,
  };
}
