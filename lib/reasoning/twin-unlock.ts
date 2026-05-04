import "server-only";

/**
 * DEE-44 Deterministic feature unlock from Twin readiness scores.
 * `input.events` is reserved for future rules; v1 uses scores only (see module contract).
 */

import type {
  TwinUnlockEntry,
  TwinUnlockFeature,
  TwinUnlockInput,
  TwinUnlockState,
} from "@/lib/dashboard/twin-unlock-api.types";
import { TWIN_UNLOCK_FEATURES, TWIN_UNLOCK_SCHEMA_VERSION } from "@/lib/dashboard/twin-unlock-api.types";
import type { TwinReadinessScores } from "@/lib/dashboard/twin-readiness-api.types";
import { TWIN_UNLOCK_RULES } from "@/lib/dashboard/twin-unlock-thresholds";

export { TWIN_UNLOCK_SCHEMA_VERSION, TWIN_UNLOCK_FEATURES };
export { TWIN_UNLOCK_RULES };

const ADVANCED_FEATURES = new Set<TwinUnlockFeature>([
  "predictions",
  "personality_insights",
  "society",
]);

const REASON_GLOBAL_BASE = "Base model maturity is below the minimum required before any feature unlocks.";
const REASON_MEMORY_SPIKE =
  "Memory signal is high relative to base model progress; advanced features stay locked until the base model catches up.";

function allLocked(reason: string): TwinUnlockState {
  const o = {} as TwinUnlockState;
  for (const f of TWIN_UNLOCK_FEATURES) {
    o[f] = { unlocked: false, reason };
  }
  return o;
}

function memorySpikeBlocksAdvanced(s: TwinReadinessScores): boolean {
  return (
    s.memory >= TWIN_UNLOCK_RULES.memorySpikeThreshold &&
    s.baseModel < TWIN_UNLOCK_RULES.baseCeilingWhenMemorySpike
  );
}

function evaluateFeature(
  feature: TwinUnlockFeature,
  s: TwinReadinessScores,
  overall: number,
  spikeBlocks: boolean,
): TwinUnlockEntry {
  if (spikeBlocks && ADVANCED_FEATURES.has(feature)) {
    return { unlocked: false, reason: REASON_MEMORY_SPIKE };
  }

  switch (feature) {
    case "diary": {
      if (s.baseModel < TWIN_UNLOCK_RULES.diaryMinBaseModel) {
        return {
          unlocked: false,
          reason: "Diary unlocks after enough base model questionnaire progress.",
        };
      }
      return { unlocked: true, reason: "Base model threshold met for diary." };
    }
    case "twin_chat": {
      if (s.memory < TWIN_UNLOCK_RULES.twinChatMinMemory) {
        return {
          unlocked: false,
          reason: "Twin chat unlocks after memory coverage reaches the minimum.",
        };
      }
      return { unlocked: true, reason: "Memory coverage threshold met for twin chat." };
    }
    case "predictions": {
      if (overall < TWIN_UNLOCK_RULES.predictionsMinOverall) {
        return {
          unlocked: false,
          reason: "Overall readiness is below the predictions threshold.",
        };
      }
      if (s.feedback < TWIN_UNLOCK_RULES.predictionsMinFeedback) {
        return {
          unlocked: false,
          reason: "Predictions need more feedback maturity.",
        };
      }
      return { unlocked: true, reason: "Overall and feedback thresholds met for predictions." };
    }
    case "personality_insights": {
      if (s.patterns < TWIN_UNLOCK_RULES.personalityMinPatterns) {
        return {
          unlocked: false,
          reason: "Personality insights need stronger pattern maturity.",
        };
      }
      if (s.contradictions < TWIN_UNLOCK_RULES.personalityMinContradictions) {
        return {
          unlocked: false,
          reason: "Personality insights need more contradiction-awareness signal.",
        };
      }
      return {
        unlocked: true,
        reason: "Pattern and contradiction thresholds met for personality insights.",
      };
    }
    case "society": {
      if (overall < TWIN_UNLOCK_RULES.societyMinOverall) {
        return {
          unlocked: false,
          reason: "Society unlocks only at higher overall readiness.",
        };
      }
      if (s.consistency < TWIN_UNLOCK_RULES.societyMinConsistency) {
        return {
          unlocked: false,
          reason: "Society needs stronger behavioral consistency maturity.",
        };
      }
      if (s.feedback < TWIN_UNLOCK_RULES.societyMinFeedback) {
        return {
          unlocked: false,
          reason: "Society needs more mature feedback-loop signal.",
        };
      }
      return {
        unlocked: true,
        reason: "Overall, consistency, and feedback thresholds met for society.",
      };
    }
    default: {
      const _exhaustive: never = feature;
      return _exhaustive;
    }
  }
}

/**
 * Computes unlock flags from readiness scores.
 * Ignores `input.events` in v1 — callers supply observed catalog descriptors for future rules.
 */
export function computeTwinUnlockState(input: TwinUnlockInput): TwinUnlockState {
  void input.events;
  const s = input.readiness.scores;
  const overall = input.readiness.overall;

  if (s.baseModel < TWIN_UNLOCK_RULES.globalMinBaseModel) {
    return allLocked(REASON_GLOBAL_BASE);
  }

  const spike = memorySpikeBlocksAdvanced(s);
  const out = {} as TwinUnlockState;
  for (const f of TWIN_UNLOCK_FEATURES) {
    out[f] = evaluateFeature(f, s, overall, spike);
  }
  return out;
}

const FEATURE_SET = new Set<string>(TWIN_UNLOCK_FEATURES);

export function isFeatureUnlocked(feature: string, state: TwinUnlockState): boolean {
  if (!FEATURE_SET.has(feature)) {
    return false;
  }
  return state[feature as TwinUnlockFeature].unlocked;
}
