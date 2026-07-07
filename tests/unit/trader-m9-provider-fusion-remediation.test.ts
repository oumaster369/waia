import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildCrowdPsychologyLayer } from "@/lib/trader/intelligence/analytical-layers-v0";
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { cdeReasonCodes } from "@/lib/trader/intelligence/types";
import { buildMarketUnderstandingBridge } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import {
  buildReplayFusedContext,
  type ReplayProviderSidecar,
} from "@/lib/trader/market-data/replay-fused-context-builder";
import {
  isReplayProviderSidecarV1,
  type ReplayProviderSidecarV1,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { guardNoLookahead } from "@/lib/trader/market-data/replay/replay-lane-normalizer";
import { computeSidecarContentDigest } from "@/lib/trader/market-data/replay/sidecar-content-digest";
import {
  normalizeFearGreedObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { buildProvenanceRef } from "@/lib/trader/market-data/normalization/normalize-observation";
import {
  assertM9BlindAuthorization,
  computeM9BlindAuthorizationDigest,
  type M9BlindAuthorizationScope,
} from "@/lib/trader/research/m9-operator-authorization";
import {
  buildM9ProviderFusionExport,
  buildM9ProviderCoverageMatrixMarkdown,
} from "@/lib/trader/research/m9-provider-fusion-export";
import {
  computeFusedContextReproDigest,
  computeMsvReproDigest,
  computeUnderstandingReproDigest,
} from "@/lib/trader/research/replay-repro-digest";
import { assertResearchRuntime } from "@/lib/trader/research/assert-research-runtime";

function loadFixtureBars() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    bars: import("@/lib/trader/intelligence/types").Bar[];
    latestQuote: import("@/lib/trader/intelligence/types").Quote;
  };
}

function loadSidecarV1(): ReplayProviderSidecar {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/m9-provider-sidecar.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as ReplayProviderSidecar;
}

function loadSidecarV2(): ReplayProviderSidecar {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/m9-provider-sidecar-v2.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as ReplayProviderSidecar;
}

describe("M9 provider fusion remediation", () => {
  it("preserves v1 sidecar back-compat", () => {
    const fixture = loadFixtureBars();
    const sidecar = loadSidecarV1();
    if (!isReplayProviderSidecarV1(sidecar)) {
      throw new Error("expected v1 sidecar fixture");
    }
    const evaluatedAt = sidecar.entries[0]!.evaluatedAt;

    const fused = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecar,
    });

    expect(fused.fearGreed).toBeDefined();
    expect(fused.globalMarket).toBeDefined();
    expect(fused.macroEvidence).toEqual([]);
  });

  it("fuses all v2 sidecar lanes with honest unavailable for missing depth lanes", () => {
    const fixture = loadFixtureBars();
    const sidecar = loadSidecarV2();
    const evaluatedAt = "2026-01-01T00:25:00.000Z";

    const fused = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecar,
    });

    expect(fused.orderBookSnapshot?.health).not.toBe("UNAVAILABLE");
    expect(fused.marketTradesSnapshot?.health).not.toBe("UNAVAILABLE");
    expect((fused.macroEvidence ?? []).length).toBeGreaterThan(0);
    expect((fused.newsEvidence ?? []).length).toBeGreaterThan(0);
    expect((fused.blockchainEvidence ?? []).length).toBeGreaterThan(0);
    expect((fused.regulatoryEvidence ?? []).length).toBeGreaterThan(0);
    expect((fused.protocolEvidence ?? []).length).toBeGreaterThan(0);
  });

  it("excludes future evidence via no-lookahead guard", () => {
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    const futureObs = normalizeFearGreedObservation({
      value: 80,
      classification: "Greed",
      provenance: buildProvenanceRef({
        providerId: "alternative_me",
        venue: "alternative_me",
        feedKind: "fear_greed_index",
        symbol: "GLOBAL",
        eventTimeUtc: "2026-01-01T01:00:00.000Z",
      }),
      latencyMs: 0,
      evaluatedAt,
      eventTimeUtc: "2026-01-01T01:00:00.000Z",
    });

    const degradationReasons: string[] = [];
    const guarded = guardNoLookahead({
      observation: futureObs,
      evaluatedAt,
      degradationReasons,
    });

    expect(guarded.health).toBe("UNAVAILABLE");
    expect(guarded.payload.reason).toBe("FUTURE_EVIDENCE_EXCLUDED");
    expect(degradationReasons.length).toBeGreaterThan(0);
  });

  it("emits fail-soft UNAVAILABLE for missing v2 depth lanes", () => {
    const fixture = loadFixtureBars();
    const sidecar = loadSidecarV2();
    delete sidecar.lanes.order_book_snapshot;
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    const fused = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecar,
    });

    expect(fused.orderBookSnapshot?.health).toBe("UNAVAILABLE");
    expect(fused.degradationReasons.some((reason) => reason.includes("order_book_snapshot"))).toBe(
      true,
    );
  });

  it("uses null newsSentiment and adds deferred reason code", () => {
    const fixture = loadFixtureBars();
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
    });
    const crowd = buildCrowdPsychologyLayer();
    expect(crowd.newsSentiment).toBeNull();

    const msv = buildMsvEnvelope({ features, newId: () => "fixed-id" });
    expect(msv.crowd.newsSentiment).toBeNull();
    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.newsSentimentDeferredPr3);
  });

  it("pins sidecar digest in blind authorization scope", () => {
    const sidecar = loadSidecarV2();
    const digest = computeSidecarContentDigest(sidecar);
    const scope: M9BlindAuthorizationScope = {
      organizationId: "org-1",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      symbol: "BTC/USDT",
      interval: "1m",
      vaultDir: "replay-runs/test",
      metricsSchemaVersion: "2.0.0",
      datasetName: "dataset",
      sidecarContentDigest: digest,
    };
    const expected = computeM9BlindAuthorizationDigest(scope);
    assertM9BlindAuthorization(expected, scope);
  });

  it("builds provider fusion export with 20-row coverage matrix", () => {
    const fixture = loadFixtureBars();
    const sidecar = loadSidecarV2();
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    const fused = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecar,
    });

    const exportDoc = buildM9ProviderFusionExport({
      organizationId: "org-1",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      instrumentId: "BTC/USDT",
      fusedSamples: [fused],
      providerSidecar: sidecar,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(exportDoc.coverageMatrix).toHaveLength(20);
    expect(exportDoc.contentDigest).toHaveLength(64);
    expect(buildM9ProviderCoverageMatrixMarkdown(exportDoc)).toContain("htx_spot");
  });

  it("produces identical reproducibility digests across two replay runs", () => {
    const fixture = loadFixtureBars();
    const sidecar = loadSidecarV2();
    const evaluatedAt = "2026-01-01T00:25:00.000Z";

    const run = () => {
      const fused = buildReplayFusedContext({
        bars: fixture.bars,
        quote: fixture.latestQuote,
        evaluatedAt,
        instrumentId: "BTC/USDT",
        providerSidecar: sidecar,
      });
      const features = computeFeatureSnapshot({
        bars: fixture.bars,
        quote: fixture.latestQuote,
        evaluatedAt,
      });
      const understanding = buildMarketUnderstandingBridge({
        features,
        fusedContext: fused,
      });
      const msv = buildMsvEnvelope({
        features,
        fusedContext: fused,
        understanding,
        newId: () => "fixed-msv-id",
      });
      return {
        fusedDigest: computeFusedContextReproDigest(fused),
        understandingDigest: computeUnderstandingReproDigest(understanding),
        msvDigest: computeMsvReproDigest(msv),
      };
    };

    expect(run()).toEqual(run());
  });

  it("throws assertResearchRuntime outside CLI/test", () => {
    const priorCli = process.env.WAIA_TRADER_CLI;
    const priorVitest = process.env.VITEST;
    delete process.env.WAIA_TRADER_CLI;
    delete process.env.VITEST;
    expect(() => assertResearchRuntime("test")).toThrow(/research-only/);
    process.env.WAIA_TRADER_CLI = priorCli;
    process.env.VITEST = priorVitest;
  });

  it("keeps deferred context lanes out of MSV reason codes beyond deferred marker", () => {
    const fixture = loadFixtureBars();
    const sidecar = loadSidecarV2();
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    const fused = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecar,
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({
      features,
      fusedContext: fused,
    });
    const msv = buildMsvEnvelope({ features, fusedContext: fused, understanding });

    const deferredMarkers = ["macro", "news", "blockchain", "regulatory", "protocol", "gdelt"];
    for (const code of msv.derived.reasonCodes) {
      if (code === cdeReasonCodes.newsSentimentDeferredPr3) {
        continue;
      }
      expect(deferredMarkers.some((marker) => code.toLowerCase().includes(marker))).toBe(false);
    }
    expect(understanding.postureRationale.join(" ").toLowerCase()).not.toContain("macro_series");
  });
});
