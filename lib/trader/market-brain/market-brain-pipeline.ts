import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { emitMsvDecisionCounters } from "@/lib/trader/intelligence/decision-telemetry";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  evaluateRegisteredStrategies,
  selectPrimaryStrategySignal,
} from "@/lib/trader/intelligence/strategies/registry";
import { emitStrategySignalCounters } from "@/lib/trader/intelligence/strategy-telemetry";
import type { Bar, InstrumentId, Quote, StrategySignal } from "@/lib/trader/intelligence/types";
import {
  DATA_QUALITY_HALT_REASON,
  evaluateDataQualityGate,
  evaluateIngestionFailureGate,
  INGESTION_HALT_REASON,
} from "@/lib/trader/market-data/data-quality-gate";

import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";

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
};

export type MarketBrainPipelineResult = {
  instrumentId: InstrumentId;
  halted: boolean;
  haltReasonCode: typeof DATA_QUALITY_HALT_REASON | typeof INGESTION_HALT_REASON | null;
  ingestionError?: string;
  features: ReturnType<typeof computeFeatureSnapshot> | null;
  msv: ReturnType<typeof buildMsvEnvelope> | null;
  signals: StrategySignal[] | null;
  signal: StrategySignal | null;
};

/**
 * Pipeline P3/P4 orchestrator: Feature Engine → data-quality fail-closed → CDE/MSV → strategies.
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
      signals: null,
      signal: null,
    };
  }

  const msv = buildMsvEnvelope({
    features,
    fusedContext: input.fusedContext,
    newId: input.newId,
  });
  emitMsvDecisionCounters(msv, input.organizationId, input.telemetrySink);

  const signals = evaluateRegisteredStrategies(msv, features, {
    organizationId: input.organizationId,
    bars: input.bars,
    newId: input.newId,
  });

  for (const strategySignal of signals) {
    emitStrategySignalCounters(strategySignal, input.telemetrySink);
  }

  const signal = selectPrimaryStrategySignal(signals);

  return {
    instrumentId: input.instrumentId,
    halted: false,
    haltReasonCode: null,
    features,
    msv,
    signals,
    signal,
  };
}
