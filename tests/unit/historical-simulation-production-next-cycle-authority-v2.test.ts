import { describe, expect, it, vi } from "vitest";

import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_DATASET_MEMBERSHIP_V2 } from
  "@/lib/trader/historical-simulation-v2/dataset-membership-v2";

vi.mock("@/lib/trader/market-data/bar-content-digest", () => ({
  computeBarContentDigest: () => "5".repeat(64),
}));
vi.mock("@/lib/trader/research/digest", () => ({
  computeStableJsonDigest: () => "9".repeat(64),
}));
vi.mock("@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2", () => ({
  assertHistoricalMarketCycleV2: vi.fn(),
}));

import { prepareHistoricalProductionNextCycleAuthorityV2 } from
  "@/lib/trader/historical-simulation-v2/production-next-cycle-authority-v2";

const digest = "a".repeat(64);

function row(recordIndex: number) {
  const cycleId = `run:WALK_FORWARD:BTCUSDT:${recordIndex}`;
  const sealedCycle = {
    cycleId,
    barIndex: recordIndex,
    closedBar: {
      symbol: "BTC/USDT",
      barCloseTime: new Date(recordIndex * 60_000).toISOString(),
    },
    contentDigestHex: "6".repeat(64),
  };
  const body = {
    schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2,
    organizationId: "org",
    cycleId,
    datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1" as const,
    datasetAuthorityDigestHex: digest,
    qualificationReceiptDigestHex: digest,
    partitionDigestHex: "3".repeat(64),
    partitionRawSha256Hex: "4".repeat(64),
    partition: "WALK_FORWARD" as const,
    symbol: "BTCUSDT" as const,
    recordIndex,
    barContentDigestHex: "5".repeat(64),
    sealedCycleContentDigestHex: "6".repeat(64),
  };
  return {
    id: `dataset-${recordIndex}`,
    cycle_id: cycleId,
    dataset_authority_digest_hex: digest,
    membership_content_digest_hex: computeSemanticSha256Hex(body),
    sealed_cycle_content_digest_hex: "6".repeat(64),
    authority_content_digest_hex: "9".repeat(64),
    membership_json: { ...body, contentDigestHex: computeSemanticSha256Hex(body) },
    sealed_cycle_json: sealedCycle,
  };
}

const request = {
  organizationId: "org",
  accountId: "account",
  runId: "run",
  partition: "WALK_FORWARD" as const,
  symbol: "BTCUSDT" as const,
  expectedRecordIndex: 1000,
};

describe("Historical Simulation V2 next-cycle source authority", () => {
  it("derives a contiguous 240-bar source and exact previous PIT in one transaction", async () => {
    let call = 0;
    const rows = Array.from({ length: 240 }, (_, offset) => row(761 + offset));
    const tx = (async () => {
      call += 1;
      if (call === 1) return [{ dataset_authority_digest_hex: digest }];
      if (call === 2) return rows;
      return [{ cycle_id: "run:WALK_FORWARD:BTCUSDT:999", record_index: 999 }];
    }) as never;
    const result = await prepareHistoricalProductionNextCycleAuthorityV2({ tx, ...request });
    expect(result.currentCycleId).toBe("run:WALK_FORWARD:BTCUSDT:1000");
    expect(result.currentDatasetAuthorityId).toBe("dataset-1000");
    expect(result.warmupCycles).toHaveLength(240);
    expect(call).toBe(3);
  });

  it("refuses a precomputed future Forecast even when the previous PIT exists", async () => {
    let call = 0;
    const rows = Array.from({ length: 240 }, (_, offset) => row(761 + offset));
    const tx = (async () => {
      call += 1;
      if (call === 1) return [{ dataset_authority_digest_hex: digest }];
      if (call === 2) return rows;
      return [
        { cycle_id: "run:WALK_FORWARD:BTCUSDT:1000", record_index: 1000 },
        { cycle_id: "run:WALK_FORWARD:BTCUSDT:999", record_index: 999 },
      ];
    }) as never;
    await expect(prepareHistoricalProductionNextCycleAuthorityV2({ tx, ...request }))
      .rejects.toThrow("FUTURE_FORECAST_PRECOMPUTED");
  });

  it("continues from the latest authorized PIT across a no-Forecast cycle", async () => {
    let call = 0;
    const rows = Array.from({ length: 240 }, (_, offset) => row(761 + offset));
    const tx = (async () => {
      call += 1;
      if (call === 1) return [{ dataset_authority_digest_hex: digest }];
      if (call === 2) return rows;
      return [{ cycle_id: "run:WALK_FORWARD:BTCUSDT:998", record_index: 998 }];
    }) as never;
    const result = await prepareHistoricalProductionNextCycleAuthorityV2({ tx, ...request });
    expect(result.previousCycleId).toBe("run:WALK_FORWARD:BTCUSDT:998");
    expect(result.currentCycleId).toBe("run:WALK_FORWARD:BTCUSDT:1000");
  });

  it("refuses a membership splice within the analytical window", async () => {
    let call = 0;
    const rows = Array.from({ length: 240 }, (_, offset) => row(761 + offset));
    rows[27] = { ...rows[27]!, membership_json: {
      ...rows[27]!.membership_json,
      symbol: "ETHUSDT",
    } as never };
    const tx = (async () => {
      call += 1;
      if (call === 1) return [{ dataset_authority_digest_hex: digest }];
      if (call === 2) return rows;
      return [{ cycle_id: "run:WALK_FORWARD:BTCUSDT:999", record_index: 999 }];
    }) as never;
    await expect(prepareHistoricalProductionNextCycleAuthorityV2({ tx, ...request }))
      .rejects.toThrow("DATASET_AUTHORITY");
  });

  it("refuses a partition substitution within the analytical window", async () => {
    let call = 0;
    const rows = Array.from({ length: 240 }, (_, offset) => row(761 + offset));
    rows[31] = { ...rows[31]!, membership_json: {
      ...rows[31]!.membership_json,
      partition: "DEVELOPMENT",
    } as never };
    const tx = (async () => {
      call += 1;
      if (call === 1) return [{ dataset_authority_digest_hex: digest }];
      if (call === 2) return rows;
      return [{ cycle_id: "run:WALK_FORWARD:BTCUSDT:999", record_index: 999 }];
    }) as never;
    await expect(prepareHistoricalProductionNextCycleAuthorityV2({ tx, ...request }))
      .rejects.toThrow("DATASET_AUTHORITY");
  });

  it("refuses a cycle/record substitution within the analytical window", async () => {
    let call = 0;
    const rows = Array.from({ length: 240 }, (_, offset) => row(761 + offset));
    rows[43] = { ...rows[43]!, cycle_id: "run:WALK_FORWARD:BTCUSDT:9999" };
    const tx = (async () => {
      call += 1;
      if (call === 1) return [{ dataset_authority_digest_hex: digest }];
      if (call === 2) return rows;
      return [{ cycle_id: "run:WALK_FORWARD:BTCUSDT:999", record_index: 999 }];
    }) as never;
    await expect(prepareHistoricalProductionNextCycleAuthorityV2({ tx, ...request }))
      .rejects.toThrow("DATASET_AUTHORITY");
  });
});
