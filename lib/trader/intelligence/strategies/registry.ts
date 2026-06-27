import { evaluateLiquiditySweepReversalV0 } from "@/lib/trader/intelligence/strategies/liquidity-sweep-reversal-v0";
import { evaluateMeanReversionV0 } from "@/lib/trader/intelligence/strategies/mean-reversion-v0";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  type Bar,
  type FeatureSnapshot,
  type MsvEnvelope,
  type StrategySignal,
} from "@/lib/trader/intelligence/types";

/** Master Spec §9 lifecycle states (MVP registry subset). */
export const strategyLifecycleStates = [
  "DRAFT",
  "RESEARCHING",
  "PAPER",
  "LIVE",
  "RETIRED",
] as const;

export type StrategyLifecycleState = (typeof strategyLifecycleStates)[number];

export type MvpStrategyId = typeof LIQUIDITY_SWEEP_REVERSAL_V0 | typeof MEAN_REVERSION_V0;

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
};

export type StrategyEvaluator = (
  msv: MsvEnvelope,
  features: FeatureSnapshot,
  context: StrategyEvaluatorContext,
) => StrategySignal;

const MVP_STRATEGY_REGISTRY: readonly StrategyRegistryEntry[] = [
  {
    strategyId: LIQUIDITY_SWEEP_REVERSAL_V0,
    version: LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
    lifecycleState: "PAPER",
    displayName: "Liquidity Sweep Reversal",
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
  strategyIds: readonly MvpStrategyId[] = resolveMvpStrategyAssignments(context.organizationId),
): StrategySignal[] {
  return strategyIds.map((strategyId) => {
    const evaluator = EVALUATORS[strategyId];
    return evaluator(msv, features, context);
  });
}

/** Primary signal for backward-compatible paper loop wiring (first actionable signal). */
export function selectPrimaryStrategySignal(signals: readonly StrategySignal[]): StrategySignal {
  const actionable = signals.find((signal) => signal.outcome === "SIGNAL");
  return actionable ?? signals[0]!;
}
