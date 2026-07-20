import { EXIT_PLAN_SCHEMA_VERSION, type TrailingState } from "@/lib/trader/exits/exit-types";
import { compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export type TrailingReducerInput = {
  prior: TrailingState;
  barHigh: string;
  barLow: string;
  markPrice: string;
  stopLossFloorPrice: string;
  evaluatedAt: string;
};

export type TrailingReducerResult = {
  state: TrailingState;
  triggered: boolean;
};

function maxPrice(a: string, b: string): string {
  return compareDecimal(a, b) >= 0 ? a : b;
}

export function createInitialTrailingState(input: {
  entryPrice: string;
  activationPrice: string;
  trailingDistanceUsdt: string;
  evaluatedAt: string;
}): TrailingState {
  return {
    schemaVersion: EXIT_PLAN_SCHEMA_VERSION,
    phase: "INACTIVE",
    entryPrice: input.entryPrice,
    activationPrice: input.activationPrice,
    trailingDistanceUsdt: input.trailingDistanceUsdt,
    maxFavorableExcursionUsdt: "0",
    peakPrice: input.entryPrice,
    stopPrice: null,
    lastUpdatedAt: input.evaluatedAt,
  };
}

export function reduceTrailingState(input: TrailingReducerInput): TrailingReducerResult {
  const { prior, barHigh, stopLossFloorPrice, evaluatedAt } = input;
  let phase = prior.phase;
  let peakPrice = prior.peakPrice;
  let stopPrice = prior.stopPrice;

  if (phase === "INACTIVE" && compareDecimal(barHigh, prior.activationPrice) >= 0) {
    phase = "ARMED";
    peakPrice = barHigh;
  }

  if (phase === "ARMED") {
    peakPrice = maxPrice(peakPrice, barHigh);
    const candidateStop = subtractDecimal(peakPrice, prior.trailingDistanceUsdt);
    stopPrice =
      compareDecimal(candidateStop, stopLossFloorPrice) < 0 ? stopLossFloorPrice : candidateStop;
  }

  const mfe = subtractDecimal(peakPrice, prior.entryPrice);
  const mfeValue = compareDecimal(mfe, "0") < 0 ? "0" : mfe;

  const state: TrailingState = {
    ...prior,
    phase,
    peakPrice,
    stopPrice,
    maxFavorableExcursionUsdt: mfeValue,
    lastUpdatedAt: evaluatedAt,
  };

  const triggered =
    phase === "ARMED" && stopPrice !== null && compareDecimal(input.markPrice, stopPrice) <= 0;

  return { state, triggered };
}
