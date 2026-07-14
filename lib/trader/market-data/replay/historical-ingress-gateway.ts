import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { selectMarketCanvasView } from "@/lib/trader/market-data/canvas/market-canvas";
import type { MarketCanvasState } from "@/lib/trader/market-data/canvas/market-canvas.types";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import {
  buildReplayFusedContextClosedOnlyLegacy,
  buildReplayFusedContextFromCanvasView,
} from "@/lib/trader/market-data/replay-fused-context-builder";
import {
  DEFAULT_REPLAY_SUBSTRATE_MODE,
  type ReplaySubstrateMode,
  usesIncrementalCanvasSubstrate,
  usesLegacyOracleSubstrate,
} from "@/lib/trader/backtest/replay-substrate-mode";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  FUTURE_EVIDENCE_EXCLUDED,
  SIDECAR_LANE_ABSENT,
} from "@/lib/trader/market-data/replay/replay-lane-normalizer";

export const HTR_WP11_LIVE_PROVIDER_CALL_FORBIDDEN =
  "HTR_WP11_LIVE_PROVIDER_CALL_FORBIDDEN" as const;
export const HTR_WP11_FUTURE_EVIDENCE_REACHABLE = "HTR_WP11_FUTURE_EVIDENCE_REACHABLE" as const;
export const HTR_WP11_FABRICATED_AVAILABILITY = "HTR_WP11_FABRICATED_AVAILABILITY" as const;
export const HTR_WP11_STRATEGY_DIRECT_PROVIDER_IMPORT =
  "HTR_WP11_STRATEGY_DIRECT_PROVIDER_IMPORT" as const;
export const HTR_WP11_INGRESS_BYPASS = "HTR_WP11_INGRESS_BYPASS" as const;

const FORBIDDEN_INGRESS_IMPORTS = [
  "htx-bar-poll-source",
  "capture-provider-snapshot",
  "market-data-gateway",
  "node:fetch",
] as const;

export type HistoricalIngressInput = {
  substrateMode?: ReplaySubstrateMode;
  bars: readonly Bar[];
  quote: Quote;
  evaluatedAt: string;
  instrumentId: string;
  providerSidecar?: ReplayProviderSidecar;
  canvasState: MarketCanvasState;
};

export type HistoricalIngressResult = {
  context: FusedMarketContext;
  degradationReasons: readonly string[];
};

export function assertNoNetworkImport(): void {
  const modulePath = fileURLToPath(import.meta.url);
  const source = readFileSync(modulePath, "utf8");
  const importLines = source.split("\n").filter((line) => /^\s*import\s/.test(line));

  for (const line of importLines) {
    for (const forbidden of FORBIDDEN_INGRESS_IMPORTS) {
      if (line.includes(forbidden)) {
        throw new Error(`${HTR_WP11_LIVE_PROVIDER_CALL_FORBIDDEN}: ${forbidden}`);
      }
    }
  }
}

function assertNoFutureEvidence(context: FusedMarketContext, evaluatedAt: string): void {
  const evaluatedMs = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) {
    return;
  }

  const checkObservation = (observation: FusedMarketContext["primaryQuote"] | undefined): void => {
    if (!observation) {
      return;
    }
    const payload = observation.payload as { reason?: string; unavailable?: boolean };
    if (
      observation.health === "UNAVAILABLE" ||
      payload.reason === FUTURE_EVIDENCE_EXCLUDED ||
      payload.reason === SIDECAR_LANE_ABSENT
    ) {
      return;
    }
    const eventMs = Date.parse(observation.provenance.eventTimeUtc);
    if (Number.isFinite(eventMs) && eventMs > evaluatedMs) {
      throw new Error(HTR_WP11_FUTURE_EVIDENCE_REACHABLE);
    }
  };

  checkObservation(context.primaryQuote);
  checkObservation(context.orderBookSnapshot);
  checkObservation(context.marketTradesSnapshot);
  checkObservation(context.crossExchangeConfirmation);
  checkObservation(context.fearGreed);
  checkObservation(context.globalMarket);

  for (const lane of [
    ...(context.macroEvidence ?? []),
    ...(context.newsEvidence ?? []),
    ...(context.blockchainEvidence ?? []),
    ...(context.regulatoryEvidence ?? []),
    ...(context.protocolEvidence ?? []),
  ]) {
    checkObservation(lane);
  }
}

export function buildHistoricalIngressContext(
  input: HistoricalIngressInput,
): HistoricalIngressResult {
  assertNoNetworkImport();

  const mode = input.substrateMode ?? DEFAULT_REPLAY_SUBSTRATE_MODE;
  const canvasView = selectMarketCanvasView(input.canvasState);

  const incremental = usesIncrementalCanvasSubstrate(mode)
    ? buildReplayFusedContextFromCanvasView({
        canvasView,
        quote: input.quote,
        evaluatedAt: input.evaluatedAt,
        instrumentId: input.instrumentId,
        providerSidecar: input.providerSidecar,
        bars1mPrefix: input.bars,
      })
    : null;

  const legacy = usesLegacyOracleSubstrate(mode)
    ? buildReplayFusedContextClosedOnlyLegacy({
        bars: input.bars,
        quote: input.quote,
        evaluatedAt: input.evaluatedAt,
        instrumentId: input.instrumentId,
        providerSidecar: input.providerSidecar,
      })
    : null;

  if (mode === "parity-both") {
    if (canonicalJsonString(incremental!) !== canonicalJsonString(legacy!)) {
      throw new Error(`${HTR_WP11_INGRESS_BYPASS}: CANVAS_PARITY_DIVERGENCE`);
    }
    assertNoFutureEvidence(incremental!, input.evaluatedAt);
    return {
      context: incremental!,
      degradationReasons: incremental!.degradationReasons,
    };
  }

  const context = (incremental ?? legacy)!;
  assertNoFutureEvidence(context, input.evaluatedAt);

  return {
    context,
    degradationReasons: context.degradationReasons,
  };
}
