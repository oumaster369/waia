import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyNewBarsToCanvas,
  createInitialCanvasState,
} from "@/lib/trader/backtest/canvas-replay-integration";
import { defineInformationAcquisitionSelectionV1 } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  buildHistoricalIngressContext,
  HTR_WP11_LIVE_PROVIDER_CALL_FORBIDDEN,
} from "@/lib/trader/market-data/replay/historical-ingress-gateway";
import { selectInformationNeedReplayEvidenceV1 } from "@/lib/trader/market-data/replay/information-need-replay-selection-v1";
import type { ReplayProviderSidecarV2 } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import {
  loadMeanReversionFixture,
  loadSidecarV2Fixture,
} from "@/tests/unit/helpers/wp11-wp12-fixture";

const PIT = "2026-01-01T00:25:00.000Z";

function selection(input: { providerId: string; mode?: "LIVE" | "HISTORICAL" }) {
  return defineInformationAcquisitionSelectionV1({
    planId: "plan-historical-1",
    planContentDigest: "a".repeat(64),
    organizationId: "org-a",
    accountId: null,
    symbol: "BTC/USDT",
    pitAnchor: PIT,
    purpose: "RESEARCH",
    mode: input.mode ?? "HISTORICAL",
    requestedSources: [
      {
        needId: "need-news",
        requirementId: "req-news",
        providerId: input.providerId,
        allowedObservationKinds: ["news_headline"],
        costUnits: 1,
        reasonCodes: ["ACTIVE_QUESTION"],
      },
    ],
  });
}

function ingress(sidecar = loadSidecarV2Fixture() as ReplayProviderSidecarV2) {
  const fixture = loadMeanReversionFixture();
  let canvasState = createInitialCanvasState();
  canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;
  return buildHistoricalIngressContext({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt: PIT,
    instrumentId: "BTC/USDT",
    providerSidecar: sidecar,
    canvasState,
  });
}

describe("DEE-698 deterministic historical information selection", () => {
  it("selects only already-supplied as-of evidence and returns AVAILABLE", () => {
    const base = ingress();
    const receipt = selectInformationNeedReplayEvidenceV1({
      selection: selection({ providerId: "coindesk_rss" }),
      context: base.context,
      pitAnchor: PIT,
    });

    expect(receipt.mode).toBe("HISTORICAL");
    expect(receipt.outcomes).toMatchObject([{ status: "AVAILABLE", reasonCode: null }]);
    expect(receipt.outcomes[0]?.canonicalPitAttempts[0]?.kind).toBe("news_headline");
    expect(receipt.outcomes[0]?.canonicalPitAttempts[0]?.providerId).toBe("coindesk_rss");
  });

  it("keeps unrequested sidecar lanes out of the causal digest", () => {
    const original = loadSidecarV2Fixture() as ReplayProviderSidecarV2;
    const changed = structuredClone(original);
    changed.lanes.global_market_stats = {
      ...changed.lanes.global_market_stats!,
      btcDominance: 1,
      marketCapUsd: 1,
    };
    const first = ingress(original);
    const second = ingress(changed);
    const selected = selection({ providerId: "coindesk_rss" });

    const firstReceipt = selectInformationNeedReplayEvidenceV1({
      selection: selected,
      context: first.context,
      pitAnchor: PIT,
    });
    const secondReceipt = selectInformationNeedReplayEvidenceV1({
      selection: selected,
      context: second.context,
      pitAnchor: PIT,
    });

    expect(second.context.globalMarket?.payload).not.toEqual(first.context.globalMarket?.payload);
    expect(secondReceipt.contentDigest).toBe(firstReceipt.contentDigest);
    expect(secondReceipt.causalObservationContentDigests).toEqual(
      firstReceipt.causalObservationContentDigests,
    );
  });

  it("rejects future evidence rather than substituting stale or current-latest data", () => {
    const base = ingress();
    const current = base.context.newsEvidence?.find(
      (observation) => observation.provenance.providerId === "coindesk_rss",
    );
    expect(current).toBeDefined();
    if (!current) throw new Error("expected coindesk replay observation");
    const future = {
      ...current,
      provenance: {
        ...current.provenance,
        eventTimeUtc: "2026-01-01T00:26:00.000Z",
        ingestTimeUtc: "2026-01-01T00:26:00.000Z",
      },
    };
    const receipt = selectInformationNeedReplayEvidenceV1({
      selection: selection({ providerId: "coindesk_rss" }),
      context: { ...base.context, newsEvidence: [future] },
      pitAnchor: PIT,
    });

    expect(receipt.outcomes[0]).toMatchObject({
      status: "REJECTED",
      reasonCode: "INVALID_CHRONOLOGY",
      observationContentDigests: [],
    });
  });

  it("returns typed rejections for mode, unknown-provider, and registry-kind mismatches", () => {
    const base = ingress();
    const reason = (providerId: string, mode?: "LIVE" | "HISTORICAL") =>
      selectInformationNeedReplayEvidenceV1({
        selection: selection({ providerId, mode }),
        context: base.context,
        pitAnchor: PIT,
      }).outcomes[0]?.reasonCode;

    expect(reason("coindesk_rss", "LIVE")).toBe("SELECTION_MODE_MISMATCH");
    expect(reason("unknown-provider")).toBe("SOURCE_UNKNOWN");
    expect(reason("coingecko_global")).toBe("PROVIDER_KIND_MISMATCH");
  });

  it("wires the selector through ingress without importing a live acquisition surface", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "lib/trader/market-data/replay/information-need-replay-selection-v1.ts",
      ),
      "utf8",
    );
    for (const forbidden of [
      "market-data-gateway",
      "htx-bar-poll-source",
      "capture-provider-snapshot",
      "globalThis.fetch",
    ]) {
      expect(source, `${HTR_WP11_LIVE_PROVIDER_CALL_FORBIDDEN}:${forbidden}`).not.toContain(
        forbidden,
      );
    }

    const base = ingress();
    const fixture = loadMeanReversionFixture();
    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;
    const wired = buildHistoricalIngressContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: PIT,
      instrumentId: "BTC/USDT",
      providerSidecar: loadSidecarV2Fixture(),
      canvasState,
      informationSelection: selection({ providerId: "coindesk_rss" }),
    });

    expect(base.informationAcquisition).toBeNull();
    expect(wired.informationAcquisition?.outcomes[0]?.status).toBe("AVAILABLE");
  });
});
