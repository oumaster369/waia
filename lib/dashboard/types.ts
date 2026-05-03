import type { IndicatorPresentationRow } from "@/lib/dashboard/indicator-ui";

/**
 * Serializable view model passed from the dashboard page (SSR) into client shell.
 * Mirrors ReadinessResult-derived fields plus Twin dialogue signals and storage flags.
 */
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
};
