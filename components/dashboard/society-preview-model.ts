/**
 * Pure inputs for DEE-53 Society v1 contract: reuse dashboard readiness bundle + deterministic TwinProfile stub.
 */

import { INDICATOR_KEYS_ORDER, type IndicatorKey } from "@/lib/readiness/types";
import type { DashboardClientProps } from "@/lib/dashboard/types";
import { INDICATOR_DISPLAY_LABEL } from "@/lib/dashboard/indicator-ui";
import { TWIN_PROFILE_SCHEMA_VERSION } from "@/lib/dashboard/twin-profile-api.types";
import type { TwinProfile } from "@/lib/dashboard/twin-profile-api.types";
import type { TwinReadinessLevel } from "@/lib/dashboard/twin-readiness-api.types";
import type { TwinReadinessResult } from "@/lib/dashboard/twin-readiness-api.types";
import { resolveDashboardTwinGrowth } from "@/components/dashboard/twin-growth-placeholder";

const TRAIT_SCORE_THRESHOLD = 67;

function syntheticTwinProfile(model: DashboardClientProps, level: TwinReadinessLevel): TwinProfile {
  const labeled = INDICATOR_KEYS_ORDER.map((key: IndicatorKey, i: number) => ({
    key,
    pct: model.indicators[i] ?? 0,
  }))
    .filter((x) => x.pct >= TRAIT_SCORE_THRESHOLD)
    .sort((a, b) =>
      b.pct !== a.pct ? b.pct - a.pct : INDICATOR_KEYS_ORDER.indexOf(a.key) - INDICATOR_KEYS_ORDER.indexOf(b.key),
    )
    .slice(0, 4)
    .map((x) => INDICATOR_DISPLAY_LABEL[x.key].toLowerCase());

  const title = model.identityLabel.trim() || "AI Twin profile";

  return {
    schemaVersion: TWIN_PROFILE_SCHEMA_VERSION,
    identity: {
      title,
      shortDescription: `Private Society preview (${model.totalCompletionPercent}% dashboard maturity summary). Twin profile remains internal in v1.`,
      dominantTraits: labeled,
    },
    expression: {
      tone: "balanced",
      communicationStyle: [],
    },
    behavior: {
      decisionStyle: [],
      relationshipStyle: [],
    },
    emotionalProfile: {
      emotionalPatterns: [],
    },
    contradictions: {
      contradictions: [],
    },
    readiness: {
      level,
    },
    visibility: {
      isPublic: false,
    },
  };
}

/** Authoritative readiness for Society gating (SSR bundle or placeholder). */
export function resolveTwinReadinessForSociety(model: DashboardClientProps): TwinReadinessResult {
  return resolveDashboardTwinGrowth(model).readiness;
}

/** Synthetic profile from dashboard indicators, or SSR/test override via twinGrowth.twinProfile. */
export function resolveTwinProfileForSocietyPreview(model: DashboardClientProps): TwinProfile {
  const readiness = resolveTwinReadinessForSociety(model);
  const level = readiness.level;

  if (model.twinGrowth?.twinProfile) {
    return {
      ...model.twinGrowth.twinProfile,
      readiness: { level },
    };
  }

  return syntheticTwinProfile(model, level);
}
