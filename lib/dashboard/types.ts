import type { IndicatorPresentationRow } from "@/lib/dashboard/indicator-ui";
import type { TwinReadinessEventDescriptor } from "@/lib/dashboard/twin-readiness-event-api.types";
import type { TwinReadinessResult } from "@/lib/dashboard/twin-readiness-api.types";
import type { TwinUnlockState } from "@/lib/dashboard/twin-unlock-api.types";

/**
 * Serializable view model passed from the dashboard page (SSR) into client shell.
 * Mirrors ReadinessResult-derived fields plus Twin dialogue signals and storage flags.
 */

/** Optional SSR bundle wiring real readiness + unlock into tab UX (DEE-48); when omitted, placeholder applies. */
export type DashboardTwinGrowthBundle = {
  readiness: TwinReadinessResult;
  unlockState: TwinUnlockState;
  events?: TwinReadinessEventDescriptor[];
};

/** Serialized Twin messages for hydrating TwinDialogueWorkspace from RSC (DEE-26). */
export type DashboardTwinDialogueInitialTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type DashboardClientProps = {
  identityLabel: string;
  hasMeaningfulExchange: boolean;
  indicators: readonly [number, number, number, number, number, number];
  /** Derived in buildDashboardViewModel for threshold UI + hints (DEE-17). */
  indicatorPresentation: readonly IndicatorPresentationRow[];
  totalCompletionPercent: number;
  diaryTabUnlocked: boolean;
  societyTabUnlocked: boolean;
  readyForSocialization: boolean;
  showFinalTwinCompletionState: boolean;
  socializationCompleted: boolean;
  finalStateMessageShown: boolean;
  /** Twin dialogue turns from persistence (user + assistant); empty for new Twin. */
  initialTwinDialogueTurns: DashboardTwinDialogueInitialTurn[];
  twinGrowth?: DashboardTwinGrowthBundle;
};
