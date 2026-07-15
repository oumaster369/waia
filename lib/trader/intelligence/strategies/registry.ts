import { evaluateLiquiditySweepReversalV0 } from "@/lib/trader/intelligence/strategies/liquidity-sweep-reversal-v0";
import { evaluateMeanReversionV0 } from "@/lib/trader/intelligence/strategies/mean-reversion-v0";
import { evaluateTrendMomentumV0 } from "@/lib/trader/intelligence/strategies/trend-momentum-v0";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  TREND_MOMENTUM_V0,
  TREND_MOMENTUM_V0_VERSION,
  type Bar,
  type FeatureSnapshot,
  type MsvEnvelope,
  type StrategySignal,
} from "@/lib/trader/intelligence/types";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import { isHistoricalProfileActive } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";

/** Master Spec §9 lifecycle states (MVP registry subset). */
export const strategyLifecycleStates = [
  "DRAFT",
  "RESEARCHING",
  "PAPER",
  "LIVE",
  "RETIRED",
] as const;

export type StrategyLifecycleState = (typeof strategyLifecycleStates)[number];

export type MvpStrategyId =
  | typeof LIQUIDITY_SWEEP_REVERSAL_V0
  | typeof MEAN_REVERSION_V0
  | typeof TREND_MOMENTUM_V0;

export type StrategyRegistryEntry = {
  strategyId: MvpStrategyId;
  version: string;
  lifecycleState: StrategyLifecycleState;
  displayName: string;
};

export type StrategyEvaluatorContext = {
  organizationId: string;
  bars: readonly Bar[];
  newId?: () => string;
  historicalProfile?: HistoricalIntelligenceProfile;
};

export function isResearchOnlyStrategyForProfile(
  strategyId: string,
  profile?: HistoricalIntelligenceProfile,
): boolean {
  if (!profile || !isHistoricalProfileActive(profile)) {
    return false;
  }
  return (profile.strategyConsumerPolicy.researchOnly as readonly string[]).includes(strategyId);
}

export function resolveHistoricalProfileStrategyIds(
  profile: HistoricalIntelligenceProfile,
): readonly MvpStrategyId[] {
  const enabled = profile.strategyConsumerPolicy
    .enabledHistoricalConsumers as readonly MvpStrategyId[];
  const researchOnly = profile.strategyConsumerPolicy.researchOnly as readonly MvpStrategyId[];
  return [...enabled, ...researchOnly];
}

export type StrategyEvaluator = (
  msv: MsvEnvelope,
  features: FeatureSnapshot,
  context: StrategyEvaluatorContext,
) => StrategySignal;

export const MVP_STRATEGY_REGISTRY: readonly StrategyRegistryEntry[] = [
  {
    strategyId: LIQUIDITY_SWEEP_REVERSAL_V0,
    version: LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
    lifecycleState: "PAPER",
    displayName: "Liquidity Sweep Reversal",
  },
  {
    strategyId: TREND_MOMENTUM_V0,
    version: TREND_MOMENTUM_V0_VERSION,
    lifecycleState: "RESEARCHING",
    displayName: "Trend Momentum",
  },
  {
    strategyId: MEAN_REVERSION_V0,
    version: MEAN_REVERSION_V0_VERSION,
    lifecycleState: "PAPER",
    displayName: "Mean Reversion",
  },
] as const;

const EVALUATORS: Record<MvpStrategyId, StrategyEvaluator> = {
  [LIQUIDITY_SWEEP_REVERSAL_V0]: evaluateLiquiditySweepReversalV0,
  [MEAN_REVERSION_V0]: evaluateMeanReversionV0,
  [TREND_MOMENTUM_V0]: evaluateTrendMomentumV0,
};

/** MVP assignment model: both strategies active for every org. */
export function resolveMvpStrategyAssignments(_organizationId: string): readonly MvpStrategyId[] {
  return MVP_STRATEGY_REGISTRY.map((entry) => entry.strategyId);
}

export function listMvpStrategyRegistry(): readonly StrategyRegistryEntry[] {
  return MVP_STRATEGY_REGISTRY;
}

export function getStrategyRegistryEntry(strategyId: string): StrategyRegistryEntry | null {
  return MVP_STRATEGY_REGISTRY.find((entry) => entry.strategyId === strategyId) ?? null;
}

export function isMvpStrategyId(strategyId: string): strategyId is MvpStrategyId {
  return strategyId in EVALUATORS;
}

export function evaluateRegisteredStrategies(
  msv: MsvEnvelope,
  features: FeatureSnapshot,
  context: StrategyEvaluatorContext,
  strategyIds: readonly MvpStrategyId[] = context.historicalProfile &&
  isHistoricalProfileActive(context.historicalProfile)
    ? resolveHistoricalProfileStrategyIds(context.historicalProfile)
    : resolveMvpStrategyAssignments(context.organizationId),
): StrategySignal[] {
  return strategyIds.map((strategyId) => {
    const evaluator = EVALUATORS[strategyId];
    const signal = evaluator(msv, features, context);
    if (isResearchOnlyStrategyForProfile(strategyId, context.historicalProfile)) {
      return {
        ...signal,
        researchEvaluationOutcome: signal.outcome,
        tradeEligible: false,
        outcome: "NO_SIGNAL",
      };
    }
    return {
      ...signal,
      tradeEligible: true,
    };
  });
}

/** Primary signal for backward-compatible paper loop wiring (first actionable signal). */
export function selectPrimaryStrategySignal(
  signals: readonly StrategySignal[],
  options?: { historicalProfile?: HistoricalIntelligenceProfile },
): StrategySignal {
  const tradeEligible = options?.historicalProfile
    ? signals.filter(
        (signal) => !isResearchOnlyStrategyForProfile(signal.strategyId, options.historicalProfile),
      )
    : signals;
  const actionable = tradeEligible.find((signal) => signal.outcome === "SIGNAL");
  return actionable ?? tradeEligible[0] ?? signals[0]!;
}
