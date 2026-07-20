import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fuseContextV1 } from "@/lib/trader/market-data/fusion/context-fusion-v1";
import { MarketDataGateway } from "@/lib/trader/market-data/market-data-gateway";
import {
  buildProvenanceRef,
  normalizeMacroSeriesObservation,
  normalizeOrderBookSnapshotObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import {
  FUSED_CONTEXT_SCHEMA_VERSION,
  MARKET_DATA_PROVIDER_IDS,
} from "@/lib/trader/market-data/observation-types";
import { listMarketDataProviders } from "@/lib/trader/market-data/provider-registry";
import { scoreObservationReliabilityWithPolicy } from "@/lib/trader/market-data/reliability/freshness-policy";
import { runMarketDataIntegrationAudit } from "@/scripts/trader/validate-market-data-integration";
import {
  createHtxGatewayMockFetch,
  htxPollSourceOptions,
  type HtxKlineFixture,
} from "@/tests/helpers/htx-gateway-mock-fetch";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";

function loadHtxFixture(): HtxKlineFixture {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as HtxKlineFixture;
}

describe("DEE-393 provider registry coverage", () => {
  it("registers all 20 canonical provider IDs", () => {
    expect(MARKET_DATA_PROVIDER_IDS).toHaveLength(20);
    expect(listMarketDataProviders()).toHaveLength(20);
  });
});

describe("DEE-393 fused context v2", () => {
  it("produces waia.trader.fused_context.v2 with evidence slots", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const macro = normalizeMacroSeriesObservation({
      seriesId: "DFF",
      value: 5.25,
      observationDate: "2026-01-01",
      provenance: buildProvenanceRef({
        providerId: "fred",
        venue: "fred",
        feedKind: "macro_series",
        symbol: "GLOBAL",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 10,
      evaluatedAt,
      eventTimeUtc: evaluatedAt,
    });

    const fused = fuseContextV1({
      instrumentId: "BTC/USDT",
      fusedAtUtc: evaluatedAt,
      mtfBars: {},
      macroEvidence: [macro],
      newsEvidence: [],
      blockchainEvidence: [],
      regulatoryEvidence: [],
      protocolEvidence: [],
    });

    expect(fused.schemaVersion).toBe(FUSED_CONTEXT_SCHEMA_VERSION);
    expect(fused.schemaVersion).toBe("waia.trader.fused_context.v2");
    expect(fused.macroEvidence).toHaveLength(1);
  });
});

describe("DEE-393 freshness policy", () => {
  it("marks fear_greed stale beyond daily cadence", () => {
    const result = scoreObservationReliabilityWithPolicy({
      kind: "fear_greed_index",
      freshnessMs: 49 * 60 * 60 * 1000,
    });
    expect(result.health).toBe("STALE");
  });
});

describe("DEE-393 order book snapshot", () => {
  it("normalizes HTX depth into order_book_snapshot", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const observation = normalizeOrderBookSnapshotObservation({
      symbol: "BTC/USDT",
      bidLevels: [[64000, 1.2]],
      askLevels: [[64001, 0.8]],
      eventTimeUtc: evaluatedAt,
      provenance: buildProvenanceRef({
        providerId: "htx_spot",
        venue: "htx",
        feedKind: "order_book_snapshot",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 5,
      evaluatedAt,
    });

    expect(observation.kind).toBe("order_book_snapshot");
    expect(observation.health).not.toBe("UNAVAILABLE");
  });
});

describe("DEE-393 gateway optional providers", () => {
  it("polls with disableOptionalProviders for deterministic tests", async () => {
    const fixture = loadHtxFixture();
    const fetchImpl = createHtxGatewayMockFetch(fixture);
    const gateway = new MarketDataGateway({
      fetchImpl,
      disableOptionalProviders: true,
    });

    const result = await gateway.pollEvaluationBundle({
      evaluatedAt: "2026-01-01T14:00:00.000Z",
    });

    expect(result.fusedContext.schemaVersion).toBe("waia.trader.fused_context.v2");
    expect(result.fusedContext.macroEvidence ?? []).toHaveLength(0);
  });
});

describe("DEE-393 TronGrid intelligence boundary", () => {
  it("never references payment watcher TRONGRID_API_KEY in MI client", () => {
    const clientPath = path.join(
      process.cwd(),
      "lib/trader/connectors/trongrid-intelligence/trongrid-intelligence-client.ts",
    );
    const content = readFileSync(clientPath, "utf8");
    expect(content).toContain("AI_TRADER_TRONGRID_API_KEY");
    expect(content.replaceAll("AI_TRADER_TRONGRID_API_KEY", "")).not.toContain("TRONGRID_API_KEY");
  });
});

describe("DEE-393 repository integration audit", () => {
  it("passes validate-market-data-integration audit", () => {
    const report = runMarketDataIntegrationAudit(process.cwd());
    for (const finding of report.findings) {
      if (!finding.pass) {
        throw new Error(`${finding.id}: ${finding.detail}`);
      }
    }
    expect(report.pass).toBe(true);
  });
});

describe("DEE-393 adapter modules exist", () => {
  it("has adapter files for optional providers", () => {
    const adapterDir = path.join(process.cwd(), "lib/trader/market-data/adapters");
    const files = readdirSync(adapterDir);
    const expected = [
      "fred-adapter.ts",
      "gdelt-adapter.ts",
      "infura-rpc-adapter.ts",
      "trongrid-intelligence-adapter.ts",
      "mempool-space-adapter.ts",
      "sec-edgar-adapter.ts",
      "htx-depth-adapter.ts",
    ];
    for (const file of expected) {
      expect(files).toContain(file);
    }
  });
});

describe("DEE-393 fail-soft optional providers", () => {
  it("returns UNAVAILABLE observations without throwing", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const observation = normalizeUnavailableObservation({
      kind: "macro_series",
      provenance: buildProvenanceRef({
        providerId: "fred",
        venue: "fred",
        feedKind: "macro_series",
        symbol: "GLOBAL",
        eventTimeUtc: evaluatedAt,
      }),
      evaluatedAt,
      reason: "missing_api_key",
    });
    expect(observation.health).toBe("UNAVAILABLE");
  });
});

describe("DEE-393 HtxBarPollSource integration", () => {
  it("still polls through gateway path", async () => {
    const fixture = loadHtxFixture();
    const source = new HtxBarPollSource(htxPollSourceOptions(fixture));
    const result = await source.fetchEvaluationBundle();
    expect(result.fusedContext.instrumentId).toBe("BTC/USDT");
  });
});
