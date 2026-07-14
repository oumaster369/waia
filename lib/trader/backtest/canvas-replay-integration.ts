import type { Bar } from "@/lib/trader/intelligence/types";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { Quote } from "@/lib/trader/intelligence/types";
import {
  advanceMarketCanvasClosedBar,
  createMarketCanvasState,
  selectMarketCanvasView,
} from "@/lib/trader/market-data/canvas/market-canvas";
import type { MarketCanvasState } from "@/lib/trader/market-data/canvas/market-canvas.types";
import { buildHistoricalIngressContext } from "@/lib/trader/market-data/replay/historical-ingress-gateway";
import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay-fused-context-builder";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import {
  DEFAULT_REPLAY_SUBSTRATE_MODE,
  type ReplaySubstrateMode,
  usesIncrementalCanvasSubstrate,
} from "@/lib/trader/backtest/replay-substrate-mode";

export type CanvasReplayAdvanceResult = {
  state: MarketCanvasState;
  appliedBars: number;
};

export function createInitialCanvasState(): MarketCanvasState {
  return createMarketCanvasState();
}

export function applyNewBarsToCanvas(
  state: MarketCanvasState,
  bars: readonly Bar[],
  appliedBarCount: number,
): CanvasReplayAdvanceResult {
  let nextState = state;
  let appliedBars = 0;
  for (let index = appliedBarCount; index < bars.length; index += 1) {
    const bar = bars[index]!;
    const result = advanceMarketCanvasClosedBar(nextState, bar);
    if (!result.ok) {
      throw new Error(`[backtest] canvas advance failed: ${result.error}`);
    }
    nextState = result.state;
    appliedBars += 1;
  }
  return { state: nextState, appliedBars };
}

export function reconstructionFromCanvasView(
  canvasView: ReturnType<typeof selectMarketCanvasView>,
): ReconstructionSnapshot | undefined {
  return canvasView.reconstruction ?? undefined;
}

export function buildSubstrateFusedContext(input: {
  substrateMode: ReplaySubstrateMode;
  bars: readonly Bar[];
  quote: Quote;
  evaluatedAt: string;
  instrumentId: string;
  providerSidecar?: ReplayProviderSidecar;
  canvasState: MarketCanvasState;
}): FusedMarketContext {
  const { context } = buildHistoricalIngressContext({
    substrateMode: input.substrateMode ?? DEFAULT_REPLAY_SUBSTRATE_MODE,
    bars: input.bars,
    quote: input.quote,
    evaluatedAt: input.evaluatedAt,
    instrumentId: input.instrumentId,
    providerSidecar: input.providerSidecar,
    canvasState: input.canvasState,
  });
  return context;
}

export function buildSubstrateReconstruction(input: {
  substrateMode: ReplaySubstrateMode;
  canvasState: MarketCanvasState;
}): ReconstructionSnapshot | undefined {
  const mode = input.substrateMode ?? DEFAULT_REPLAY_SUBSTRATE_MODE;
  if (!usesIncrementalCanvasSubstrate(mode)) {
    return undefined;
  }
  return reconstructionFromCanvasView(selectMarketCanvasView(input.canvasState));
}
