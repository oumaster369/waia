import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { evaluateMeanReversionV0 } from "@/lib/trader/intelligence/strategies/mean-reversion-v0";
import { emitStrategySignalCounters } from "@/lib/trader/intelligence/strategy-telemetry";
import type { EvaluationCycleInput, EvaluationCycleResult } from "@/lib/trader/intelligence/types";

/**
 * Runs one intelligence evaluation: Feature Engine → CDE → Mean Reversion v0.
 */
export function runEvaluationCycle(input: EvaluationCycleInput): EvaluationCycleResult {
  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const features = computeFeatureSnapshot({
    bars: input.bars,
    quote: input.quote,
    evaluatedAt: input.evaluatedAt,
    newId,
  });
  const msv = buildMsvEnvelope({ features, newId });
  const signal = evaluateMeanReversionV0(msv, features, {
    organizationId: input.organizationId,
    newId,
  });
  emitStrategySignalCounters(signal, input.telemetrySink);

  return { features, msv, signal };
}
