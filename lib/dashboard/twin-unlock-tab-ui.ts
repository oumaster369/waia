/**
 * Client-safe Twin unlock tab presentation (DEE-48).
 * Phase heuristics are display-only — never override `TwinUnlockEntry.unlocked`.
 */

import type { DashboardTwinGrowthBundle } from "@/lib/dashboard/types";
import type { TwinReadinessScores } from "@/lib/dashboard/twin-readiness-api.types";
import type { TwinUnlockEntry, TwinUnlockFeature } from "@/lib/dashboard/twin-unlock-api.types";
import { TWIN_UNLOCK_RULES } from "@/lib/dashboard/twin-unlock-thresholds";
import type { WorkspaceModeId } from "@/lib/dashboard/workspace-mode";
import { WORKSPACE_TAB_ORDER } from "@/lib/dashboard/workspace-mode";

export const TAB_LABELS = {
  twin: "Twin",
  diary: "Diary",
  predictions: "Predictions",
  personality_insights: "Personality Insights",
  society: "Society",
} as const satisfies Record<WorkspaceModeId, string>;

export const MODE_TO_UNLOCK_FEATURE = {
  twin: "twin_chat",
  diary: "diary",
  predictions: "predictions",
  personality_insights: "personality_insights",
  society: "society",
} as const satisfies Record<WorkspaceModeId, TwinUnlockFeature>;

/** Display-only phase for analytics and soft UI cues; clickability stays on `unlocked`. */
export type TwinTabUiPhase = "unlocked" | "locked" | "almost_unlocked" | "growing";

/** §6-aligned journey anchors + growth hints (Twin product shell). Exported for deterministic copy tests. */
export const FEATURE_GROWTH_CATALOG = {
  twin_chat: {
    journeyLine: "Twin is the dialogue home where your AI-Twin gathers values, cadence, and voice—stay here until the next surface opens naturally.",
    nextStepHint:
      "Answer reflections honestly; steady dialogue raises memory and readiness without rushing the roadmap.",
    reasonGrowthWhenLocked:
      "Twin chat deepens once memory coverage reaches the onboarding bar—keep teaching your Twin through conversation.",
  },
  diary: {
    journeyLine:
      "Diary becomes a behavioural memory lane—capturing tone, moods, and micro-stories once your base model crosses its first maturity band.",
    nextStepHint:
      "Raise the questionnaire-driven indicators enough that your Twin trusts new inputs—Diary arrives right after that threshold.",
    reasonGrowthWhenLocked:
      "Diary unfolds when baseline questionnaire depth crosses the Diary threshold—celebrate incremental indicator gains.",
  },
  predictions: {
    journeyLine:
      "Predictions stay humble until feedback loops prove the Twin can self-correct—then scenario tests become companions, not guesses.",
    nextStepHint:
      "Blend overall readiness with repeatable feedback exercises so predictions cite evidence instead of aspiration.",
    reasonGrowthWhenLocked:
      "Predictions remain folded until holistic readiness plus feedback cues say the Twin can verify itself.",
  },
  personality_insights: {
    journeyLine:
      "Personality Insights distill contradictions and patterns only after detectors see enough repeatable signal—privacy-safe, narration-rich.",
    nextStepHint:
      "Invite richer pattern excerpts and contradiction reviews so insights mirror lived nuance.",
    reasonGrowthWhenLocked:
      "Personality Insights need stronger patterns and calibrated contradiction-awareness before opening.",
  },
  society: {
    journeyLine:
      "Society is the federation layer—only after coherence, consistency, and feedback maturity keep the Twin auditable among peers.",
    nextStepHint:
      "Finish the Twin loop, complete socialization readiness, then step into communal surfaces with clarity.",
    reasonGrowthWhenLocked:
      "Society stays curated until readiness, behavioural consistency, and feedback depth align with the federation bar.",
  },
} as const satisfies Record<
  TwinUnlockFeature,
  { journeyLine: string; nextStepHint: string; reasonGrowthWhenLocked: string }
>;

export const DEFAULT_ALMOST_UNLOCK_EPSILON = 0.05;

export type TwinTabPresentation = {
  phase: TwinTabUiPhase;
  unlocked: boolean;
  label: string;
  journeyLine: string;
  hint?: string;
  detail?: string;
};

export type ResolveTwinUnlockPresentationArgs = {
  feature: TwinUnlockFeature;
  unlockEntry: TwinUnlockEntry;
  readinessScores: TwinReadinessScores;
  overall: number;
  almostEpsilon?: number;
};

function memorySpikeBlocksAdvanced(s: TwinReadinessScores): boolean {
  return (
    s.memory >= TWIN_UNLOCK_RULES.memorySpikeThreshold &&
    s.baseModel < TWIN_UNLOCK_RULES.baseCeilingWhenMemorySpike
  );
}

function collectUnlockGaps(
  feature: TwinUnlockFeature,
  s: TwinReadinessScores,
  overall: number,
): number[] {
  if (s.baseModel < TWIN_UNLOCK_RULES.globalMinBaseModel) {
    return [TWIN_UNLOCK_RULES.globalMinBaseModel - s.baseModel];
  }

  const spike = memorySpikeBlocksAdvanced(s);
  const spikeLockedAdvanced =
    spike && (feature === "predictions" || feature === "personality_insights" || feature === "society");
  if (spikeLockedAdvanced) {
    return [TWIN_UNLOCK_RULES.baseCeilingWhenMemorySpike - s.baseModel].filter((g) => g > 0);
  }

  switch (feature) {
    case "diary":
      return [TWIN_UNLOCK_RULES.diaryMinBaseModel - s.baseModel].filter((g) => g > 0);
    case "twin_chat":
      return [TWIN_UNLOCK_RULES.twinChatMinMemory - s.memory].filter((g) => g > 0);
    case "predictions": {
      const g = [
        TWIN_UNLOCK_RULES.predictionsMinOverall - overall,
        TWIN_UNLOCK_RULES.predictionsMinFeedback - s.feedback,
      ];
      return g.filter((x) => x > 0);
    }
    case "personality_insights": {
      const g = [
        TWIN_UNLOCK_RULES.personalityMinPatterns - s.patterns,
        TWIN_UNLOCK_RULES.personalityMinContradictions - s.contradictions,
      ];
      return g.filter((x) => x > 0);
    }
    case "society": {
      const g = [
        TWIN_UNLOCK_RULES.societyMinOverall - overall,
        TWIN_UNLOCK_RULES.societyMinConsistency - s.consistency,
        TWIN_UNLOCK_RULES.societyMinFeedback - s.feedback,
      ];
      return g.filter((x) => x > 0);
    }
    default: {
      const _e: never = feature;
      return _e;
    }
  }
}

function minPositiveGap(gaps: number[]): number | null {
  if (gaps.length === 0) {
    return null;
  }
  return Math.min(...gaps);
}

function hasAnyFormationSignal(s: TwinReadinessScores, overall: number): boolean {
  return (
    overall >= 0.1 ||
    s.baseModel >= 0.1 ||
    s.memory >= 0.1 ||
    s.patterns >= 0.1 ||
    s.contradictions >= 0.1 ||
    s.consistency >= 0.1 ||
    s.feedback >= 0.1
  );
}

const MODE_ID_FOR_FEATURE: Record<TwinUnlockFeature, WorkspaceModeId> = {
  twin_chat: "twin",
  diary: "diary",
  predictions: "predictions",
  personality_insights: "personality_insights",
  society: "society",
};

/**
 * Derives display phase from numeric proximity to failing gates.
 * `unlocked` mirrors `unlockEntry.unlocked` only — never flipped here.
 */
export function resolveTwinUnlockPresentation({
  feature,
  unlockEntry,
  readinessScores,
  overall,
  almostEpsilon = DEFAULT_ALMOST_UNLOCK_EPSILON,
}: ResolveTwinUnlockPresentationArgs): TwinTabPresentation {
  const meta = FEATURE_GROWTH_CATALOG[feature];
  const base: Omit<TwinTabPresentation, "phase"> = {
    unlocked: unlockEntry.unlocked,
    label: TAB_LABELS[MODE_ID_FOR_FEATURE[feature]],
    journeyLine: meta.journeyLine,
    hint: unlockEntry.unlocked ? undefined : meta.nextStepHint,
    detail: softenDetail(unlockEntry.reason, meta.reasonGrowthWhenLocked, unlockEntry.unlocked),
  };

  if (unlockEntry.unlocked) {
    return { ...base, phase: "unlocked" };
  }

  const minGap = minPositiveGap(collectUnlockGaps(feature, readinessScores, overall));
  if (minGap !== null && minGap <= almostEpsilon) {
    return { ...base, phase: "almost_unlocked" };
  }
  if (hasAnyFormationSignal(readinessScores, overall)) {
    return { ...base, phase: "growing" };
  }
  return { ...base, phase: "locked" };
}

function softenDetail(
  serverReason: string,
  growthFallbackWhenEmpty: string,
  unlocked: boolean,
): string | undefined {
  if (unlocked) {
    void growthFallbackWhenEmpty;
    const t = serverReason.trim();
    return t.length > 0 ? t : undefined;
  }
  const t = serverReason.trim();
  if (t.length === 0) {
    return growthFallbackWhenEmpty;
  }
  return t;
}

export function buildDashboardTabPresentations(
  bundle: Pick<DashboardTwinGrowthBundle, "readiness" | "unlockState">,
): Record<WorkspaceModeId, TwinTabPresentation> {
  const { readiness, unlockState } = bundle;
  const out = {} as Record<WorkspaceModeId, TwinTabPresentation>;
  for (const mode of WORKSPACE_TAB_ORDER) {
    const feature = MODE_TO_UNLOCK_FEATURE[mode];
    const resolved = resolveTwinUnlockPresentation({
      feature,
      unlockEntry: unlockState[feature],
      readinessScores: readiness.scores,
      overall: readiness.overall,
    });
    out[mode] = { ...resolved, label: TAB_LABELS[mode] };
  }
  return out;
}

export function tabUiForbiddenPhraseRegex(): RegExp {
  return /(access\s*denied|forbidden|you\s+cannot)/i;
}
