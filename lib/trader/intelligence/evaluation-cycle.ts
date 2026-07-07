import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { emitMsvDecisionCounters } from "@/lib/trader/intelligence/decision-telemetry";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  evaluateRegisteredStrategies,
  selectPrimaryStrategySignal,
} from "@/lib/trader/intelligence/strategies/registry";
import { emitStrategySignalCounters } from "@/lib/trader/intelligence/strategy-telemetry";
import type { EvaluationCycleInput, EvaluationCycleResult } from "@/lib/trader/intelligence/types";

/**
 * Runs one intelligence evaluation: Feature Engine → Context Fusion hook → CDE → strategies.
 */
export function runEvaluationCycle(input: EvaluationCycleInput): EvaluationCycleResult {
  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const features = computeFeatureSnapshot({
    bars: input.bars,
    quote: input.quote,
    evaluatedAt: input.evaluatedAt,
    newId,
  });
  const msv = buildMsvEnvelope({
    features,
    fusedContext: input.fusedContext,
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

  return { features, msv, signals, signal, fusedContext: input.fusedContext };
}
