import type {
  MarketUnderstandingSnapshot,
  ResearchSignals,
} from "@/lib/trader/intelligence/market-understanding.types";
import { buildResearchSignals } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import type { StreamingEvidenceReader } from "@/lib/trader/backtest/streaming-evidence";
import {
  assertM9ProjectionSource,
  iterateM9Cycles,
} from "@/lib/trader/research/m9-projection-source";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

export const M9_MARKET_UNDERSTANDING_SAMPLE_SCHEMA_VERSION =
  "m9_market_understanding_sample_v1" as const;

export type M9MarketUnderstandingSampleExport = {
  schemaVersion: typeof M9_MARKET_UNDERSTANDING_SAMPLE_SCHEMA_VERSION;
  generatedAt: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  sampleCount: number;
  maxSamples: number;
  understandingSnapshots: readonly MarketUnderstandingSnapshot[];
  researchSignals: readonly ResearchSignals[];
  cyclesWithUnderstanding: number;
};

const DEFAULT_MAX_SAMPLES = 25;

export function buildM9MarketUnderstandingSampleExport(input: {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  cycleResults?: readonly PaperCycleResult[];
  projectionReader?: StreamingEvidenceReader;
  maxSamples?: number;
  generatedAt?: string;
}): M9MarketUnderstandingSampleExport {
  assertM9ProjectionSource(input);
  const maxSamples = input.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const understandingSnapshots: MarketUnderstandingSnapshot[] = [];
  const researchSignals: ResearchSignals[] = [];
  let cyclesWithUnderstanding = 0;

  for (const cycle of iterateM9Cycles(input)) {
    const understanding = cycle.evaluation.understanding;
    if (!understanding) {
      continue;
    }
    cyclesWithUnderstanding += 1;
    if (understandingSnapshots.length >= maxSamples) {
      continue;
    }
    understandingSnapshots.push(understanding);
    researchSignals.push(buildResearchSignals(understanding));
  }

  return {
    schemaVersion: M9_MARKET_UNDERSTANDING_SAMPLE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    sampleCount: understandingSnapshots.length,
    maxSamples,
    understandingSnapshots,
    researchSignals,
    cyclesWithUnderstanding,
  };
}
