import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";
import type { Bar, InstrumentId, Quote, StrategySignal } from "@/lib/trader/intelligence/types";
import type { FeatureSnapshot, MsvEnvelope } from "@/lib/trader/intelligence/types";
import type { HypothesisSet } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  DATA_QUALITY_HALT_REASON,
  evaluateDataQualityGate,
  evaluateIngestionFailureGate,
  INGESTION_HALT_REASON,
} from "@/lib/trader/market-data/data-quality-gate";

import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { CanonicalRuntimeIntelligenceStateV1 } from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import type { CanonicalRuntimeIntelligenceStateProviderV1 } from "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";

export type MarketBrainPipelineInput = {
  organizationId: string;
  instrumentId: InstrumentId;
  bars: readonly Bar[];
  quote?: Quote;
  evaluatedAt?: string;
  ingestionError?: string;
  fusedContext?: FusedMarketContext;
  newId?: () => string;
  telemetrySink?: WaiaTraderTelemetrySink;
  /** DEE-629 canonical PIT state. Missing state cannot authorize an opportunity. */
  canonicalRuntimeIntelligenceState?: CanonicalRuntimeIntelligenceStateV1;
};

export type MarketBrainPipelineResult = {
  instrumentId: InstrumentId;
  halted: boolean;
  haltReasonCode: typeof DATA_QUALITY_HALT_REASON | typeof INGESTION_HALT_REASON | null;
  ingestionError?: string;
  features: FeatureSnapshot | null;
  msv: MsvEnvelope | null;
  understanding?: MarketUnderstandingSnapshot;
  signals: StrategySignal[] | null;
  signal: StrategySignal | null;
  hypothesisSet?: HypothesisSet;
};

/**
 * Pipeline P3/P4 orchestrator: Feature Engine → data-quality fail-closed → evaluation cycle
 * (understanding bridge + CDE/MSV) → strategies.
 * Halts before strategy evaluation when ingestion fails or data quality is below threshold.
 */
export function runMarketBrainPipeline(input: MarketBrainPipelineInput): MarketBrainPipelineResult {
  const base = {
    instrumentId: input.instrumentId,
    halted: true,
    haltReasonCode: INGESTION_HALT_REASON as typeof INGESTION_HALT_REASON | null,
    ingestionError: input.ingestionError,
    features: null,
    msv: null,
    understanding: undefined,
    signals: null,
    signal: null,
  };

  if (input.ingestionError) {
    evaluateIngestionFailureGate();
    return {
      ...base,
      haltReasonCode: INGESTION_HALT_REASON,
    };
  }

  const features = computeFeatureSnapshot({
    bars: input.bars,
    quote: input.quote,
    evaluatedAt: input.evaluatedAt,
    newId: input.newId,
  });

  const gate = evaluateDataQualityGate(features);
  if (gate.halt) {
    return {
      instrumentId: input.instrumentId,
      halted: true,
      haltReasonCode: DATA_QUALITY_HALT_REASON,
      features,
      msv: null,
      understanding: undefined,
      signals: null,
      signal: null,
    };
  }

  const evaluation = runEvaluationCycle({
    organizationId: input.organizationId,
    bars: input.bars,
    quote: input.quote,
    evaluatedAt: input.evaluatedAt,
    fusedContext: input.fusedContext,
    newId: input.newId,
    telemetrySink: input.telemetrySink,
    canonicalRuntimeIntelligenceState: input.canonicalRuntimeIntelligenceState,
    informationSufficiencyAuthority: declareResearchNonCapitalInformationAuthorityV2({
      organizationId: input.organizationId,
      reason: "MARKET_BRAIN_NON_CAPITAL_EVALUATION",
    }),
  });

  return {
    instrumentId: input.instrumentId,
    halted: false,
    haltReasonCode: null,
    features: evaluation.features,
    msv: evaluation.msv,
    understanding: evaluation.understanding,
    signals: evaluation.signals,
    signal: evaluation.signal,
    hypothesisSet: evaluation.hypothesisSet,
  };
}

/** Async production entrypoint when canonical PIT repositories are configured. */
export async function runMarketBrainPipelineWithCanonicalRuntimeIntelligenceV1(
  input: MarketBrainPipelineInput,
  provider: CanonicalRuntimeIntelligenceStateProviderV1,
): Promise<MarketBrainPipelineResult> {
  const evaluatedAt = input.evaluatedAt ?? input.bars.at(-1)?.barCloseTime;
  if (!evaluatedAt) {
    throw new Error("[market-brain] canonical runtime intelligence requires evaluatedAt");
  }
  const state = input.canonicalRuntimeIntelligenceState ?? await provider({
    context: { organizationId: input.organizationId },
    symbol: input.instrumentId,
    asOf: new Date(evaluatedAt),
  });
  return runMarketBrainPipeline({ ...input, canonicalRuntimeIntelligenceState: state });
}
