import { computeReadinessResult } from "@/lib/readiness/readiness";
import type { ReadinessInput } from "@/lib/readiness/types";

import { buildIndicatorPresentation } from "@/lib/dashboard/indicator-ui";
import type {
  DashboardClientProps,
  DashboardTwinDialogueInitialTurn,
} from "@/lib/dashboard/types";
import type { TwinDialogueSignals } from "@/lib/dashboard/readiness-snapshot-default";

export function buildDashboardViewModel(
  readinessInput: ReadinessInput,
  twinSignals: TwinDialogueSignals,
  identityLabel: string,
  initialTwinDialogueTurns: DashboardTwinDialogueInitialTurn[] = [],
): DashboardClientProps {
  const r = computeReadinessResult(readinessInput);
  return {
    identityLabel,
    avatarStatusText: `AI-Twin workspace · ${identityLabel}`,
    hasMeaningfulExchange: twinSignals.hasMeaningfulExchange,
    indicators: r.indicators,
    indicatorPresentation: buildIndicatorPresentation(r.indicators),
    totalCompletionPercent: r.totalCompletionPercent,
    diaryTabUnlocked: r.diaryTabUnlocked,
    societyTabUnlocked: r.societyTabUnlocked,
    readyForSocialization: r.readyForSocialization,
    showFinalTwinCompletionState: r.showFinalTwinCompletionState,
    socializationCompleted: readinessInput.socializationCompleted,
    finalStateMessageShown: readinessInput.finalStateMessageShown,
    initialTwinDialogueTurns,
  };
}
