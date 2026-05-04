import type {
  DashboardClientProps,
  DashboardTwinGrowthBundle,
} from "@/lib/dashboard/types";
import type {
  TwinReadinessLevel,
  TwinReadinessResult,
  TwinReadinessScores,
} from "@/lib/dashboard/twin-readiness-api.types";
import type { TwinUnlockState } from "@/lib/dashboard/twin-unlock-api.types";

function placeholderScoresAndOverall(
  pct: number,
  diaryUnlocked: boolean,
): { scores: TwinReadinessScores; overall: number; level: TwinReadinessLevel } {
  let overall = 0;
  let level: TwinReadinessLevel = "low";
  if (pct >= 70) {
    overall = 0.12;
    level = "high";
  } else if (pct >= 40) {
    overall = 0.09;
    level = "medium";
  }

  const baseModel = diaryUnlocked ? 0.32 : pct >= 55 ? 0.14 : 0.04;
  const memory = diaryUnlocked ? 0.24 : 0.05;
  const patterns = pct >= 60 ? 0.11 : 0.04;
  const contradictions = pct >= 50 ? 0.08 : 0.04;
  const consistency = pct >= 80 ? 0.14 : 0.05;
  const feedback = pct >= 90 ? 0.11 : 0.05;

  return {
    overall,
    level,
    scores: { baseModel, memory, patterns, contradictions, consistency, feedback },
  };
}

function placeholderReadiness(model: DashboardClientProps): TwinReadinessResult {
  const { scores, overall, level } = placeholderScoresAndOverall(
    model.totalCompletionPercent,
    model.diaryTabUnlocked,
  );
  return {
    schemaVersion: "twin-readiness-v1",
    scores,
    overall,
    level,
  };
}

function placeholderUnlockState(model: DashboardClientProps): TwinUnlockState {
  return {
    diary: {
      unlocked: model.diaryTabUnlocked,
      reason: model.diaryTabUnlocked
        ? "Diary is open—journal-style notes add texture your Twin can learn from later."
        : "This layer is still forming. As your indicators grow, Diary will open—keep shaping your Twin in dialogue.",
    },
    personality_insights: {
      unlocked: false,
      reason:
        "Personality Insights needs steadier pattern and contradiction signals—your Twin is still gathering structure.",
    },
    predictions: {
      unlocked: false,
      reason:
        "Predictions stay folded until overall readiness and feedback loops are strong enough to stay grounded.",
    },
    society: {
      unlocked: model.societyTabUnlocked,
      reason: model.societyTabUnlocked
        ? "Society is open—your AI-Twin can step into the social layer from here."
        : "Society arrives after your Twin is complete and socialization succeeds—focus on formation for now.",
    },
    twin_chat: {
      unlocked: true,
      reason: "Twin is your home workspace—dialogue is where your AI-Twin takes shape first.",
    },
  };
}

/**
 * When `model.twinGrowth` is absent, synthesize a typed bundle for growth-framed tab UX only.
 * Does not alter server readiness or unlock outputs on the wire.
 */
export function buildTwinGrowthPlaceholder(model: DashboardClientProps): DashboardTwinGrowthBundle {
  return {
    readiness: placeholderReadiness(model),
    unlockState: placeholderUnlockState(model),
  };
}

export function resolveDashboardTwinGrowth(model: DashboardClientProps): DashboardTwinGrowthBundle {
  return model.twinGrowth ?? buildTwinGrowthPlaceholder(model);
}
