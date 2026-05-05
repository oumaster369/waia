import type { ModeId } from "@/components/dashboard/types";
import { TAB_ORDER } from "@/components/dashboard/types";
import { resolveDashboardTwinGrowth } from "@/components/dashboard/twin-growth-placeholder";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import type { ReadinessInput } from "@/lib/readiness/types";
import {
  buildDashboardTabPresentations,
  tabUiForbiddenPhraseRegex,
  type TwinTabPresentation,
} from "@/lib/dashboard/twin-unlock-tab-ui";

export type TwinDialogueSignalsInput = { hasMeaningfulExchange: boolean };

/**
 * Same tab presentation map the dashboard client computes for a readiness snapshot + twin signals.
 */
export function expectedTabPresentationsForReadiness(
  readinessInput: ReadinessInput,
  twinSignals: TwinDialogueSignalsInput,
): Record<ModeId, TwinTabPresentation> {
  const model = buildDashboardViewModel(readinessInput, twinSignals, "__e2e__");
  return buildDashboardTabPresentations(resolveDashboardTwinGrowth(model));
}

export const dashboardE2EForbiddenPhraseRegex = tabUiForbiddenPhraseRegex;

export const DASHBOARD_TAB_ORDER: readonly ModeId[] = TAB_ORDER;
