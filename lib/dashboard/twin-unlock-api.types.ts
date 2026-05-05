/** Twin feature unlock contract (DEE-44) — deterministic gating from readiness + event context; no persistence. */

import type { TwinReadinessEventDescriptor } from "@/lib/dashboard/twin-readiness-event-api.types";
import type { TwinReadinessResult } from "@/lib/dashboard/twin-readiness-api.types";

export const TWIN_UNLOCK_SCHEMA_VERSION = "twin-unlock-v1" as const;

export type TwinUnlockSchemaVersion = typeof TWIN_UNLOCK_SCHEMA_VERSION;

/** Unlock targets (lexicographic order for stable `TwinUnlockState` key order). */
export const TWIN_UNLOCK_FEATURES = [
  "diary",
  "personality_insights",
  "predictions",
  "society",
  "twin_chat",
] as const;

export type TwinUnlockFeature = (typeof TWIN_UNLOCK_FEATURES)[number];

export type TwinUnlockInput = {
  readiness: TwinReadinessResult;
  events: TwinReadinessEventDescriptor[];
};

export type TwinUnlockEntry = {
  unlocked: boolean;
  reason: string;
};

export type TwinUnlockState = Record<TwinUnlockFeature, TwinUnlockEntry>;
