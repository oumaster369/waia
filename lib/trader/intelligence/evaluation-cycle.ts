import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { assembleDecisionChain } from "@/lib/trader/intelligence/decision-chain";
import { emitMsvDecisionCounters } from "@/lib/trader/intelligence/decision-telemetry";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import { isMiCoreEnabled } from "@/lib/trader/intelligence/mi-core-flag";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import {
  finalizeMarketStateSnapshot,
  resolveTerminalReasonCode,
} from "@/lib/trader/intelligence/market-state-finalization";
import { buildMarketUnderstandingBridge } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import {
  evaluateRegisteredStrategies,
  selectPrimaryStrategySignal,
} from "@/lib/trader/intelligence/strategies/registry";
import { emitStrategySignalCounters } from "@/lib/trader/intelligence/strategy-telemetry";
import type { EvaluationCycleInput, EvaluationCycleResult } from "@/lib/trader/intelligence/types";

/**
 * Runs one intelligence evaluation: Feature Engine → Context Fusion hook → Understanding Bridge → CDE → strategies.
 * PR-2 MI Core (flag ON): Reconstruction → Understanding → Hypothesis → CDE conviction → Market State Finalization → Decision Chain.
 */
export function runEvaluationCycle(input: EvaluationCycleInput): EvaluationCycleResult {
  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const miCore = input.miCoreEnabled ?? isMiCoreEnabled();
  const evaluatedAt =
    input.evaluatedAt ?? input.bars.at(-1)?.barCloseTime ?? new Date().toISOString();

  const features = computeFeatureSnapshot({
    bars: input.bars,
    quote: input.quote,
    evaluatedAt,
    newId,
  });

  if (!miCore) {
    const understanding = input.fusedContext
      ? buildMarketUnderstandingBridge({
          fusedContext: input.fusedContext,
          features,
        })
      : undefined;

    const msv = buildMsvEnvelope({
      features,
      fusedContext: input.fusedContext,
      understanding,
      newId,
    });
    emitMsvDecisionCounters(msv, input.organizationId, input.telemetrySink);

    const signals = evaluateRegisteredStrategies(msv, features, {
      organizationId: input.organizationId,
      bars: input.bars,
      newId,
    });

    for (const signal of signals) {
      emitStrategySignalCounters(signal, input.telemetrySink);
    }

    const signal = selectPrimaryStrategySignal(signals);

    return { features, msv, signals, signal, fusedContext: input.fusedContext, understanding };
  }

  const reconstruction = buildReconstructionSnapshot({
    bars1m: input.bars,
    evaluatedAt,
    fusedContext: input.fusedContext,
  });

  const understanding = input.fusedContext
    ? buildMarketUnderstandingBridge({
        fusedContext: input.fusedContext,
        features,
        reconstruction,
      })
    : undefined;

  const sessionState = input.hypothesisSessionState ?? createEmptyHypothesisSessionState();
  const { hypothesisSet, sessionState: nextSessionState } = buildHypothesisSet({
    reconstruction,
    understanding,
    evaluatedAt,
    sessionState,
  });

  const msv = buildMsvEnvelope({
    features,
    fusedContext: input.fusedContext,
    understanding,
    opportunity: hypothesisSet.opportunity ?? undefined,
    miCoreEnabled: true,
    newId,
  });
  emitMsvDecisionCounters(msv, input.organizationId, input.telemetrySink);

  const terminalReasonCode = resolveTerminalReasonCode({
    opportunityAuthorized: hypothesisSet.opportunity?.authorized ?? false,
    tradingPermission: msv.derived.tradingPermission,
    conviction: hypothesisSet.opportunity?.conviction ?? 0,
  });

  const marketStateSnapshot = finalizeMarketStateSnapshot({
    reconstruction,
    understanding,
    hypothesisSet,
    tradingPermission: msv.derived.tradingPermission,
    terminalReasonCode,
  });

  const decisionChain = assembleDecisionChain({
    evaluatedAt,
    reconstruction,
    understanding,
    hypothesisSet,
    marketStateSnapshot,
    tradingPermission: msv.derived.tradingPermission,
    reasonCodes: msv.derived.reasonCodes,
  });

  const signals = evaluateRegisteredStrategies(msv, features, {
    organizationId: input.organizationId,
    bars: input.bars,
    newId,
  });

  for (const signal of signals) {
    emitStrategySignalCounters(signal, input.telemetrySink);
  }

  const signal = selectPrimaryStrategySignal(signals);

  return {
    features,
    msv,
    signals,
    signal,
    fusedContext: input.fusedContext,
    understanding,
    reconstruction,
    hypothesisSet,
    marketStateSnapshot,
    decisionChain,
    hypothesisSessionState: nextSessionState,
  };
}
