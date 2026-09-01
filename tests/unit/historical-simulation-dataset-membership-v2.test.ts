import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { StreamingBarSetDigestHasher } from "@/lib/trader/market-data/fhv-streaming-bar-set-digest";
import {
  bindHistoricalCyclesToPreHoldoutDatasetV2,
  bindHistoricalCyclesToSealedDatasetV2,
} from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import type { HistoricalSealedMarketCycleV2 } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";

const digest = (c: string) => c.repeat(64);
const bars = [
  { symbol: "BTC/USDT", interval: "1m", open: "1", high: "2", low: "0.5", close: "1.5", volume: "10", barOpenTime: "2026-01-01T00:00:00.000Z", barCloseTime: "2026-01-01T00:01:00.000Z" },
  { symbol: "BTC/USDT", interval: "1m", open: "1.5", high: "2.5", low: "1", close: "2", volume: "11", barOpenTime: "2026-01-01T00:01:00.000Z", barCloseTime: "2026-01-01T00:02:00.000Z" },
] as const;
const raw = bars.map((value) => serializeFhvBarsV2Record(barToFhvBarsV2Record(value))).join("");
const semantic = new StreamingBarSetDigestHasher();
for (const value of bars) semantic.appendBarDigest(computeBarContentDigest(value));
const semanticDigest = semantic.finalize();
const rawHash = digest("a");

type MockedSealedDataset = {
  manifest: {
    organizationId: string;
    manifestSemanticDigest: string;
    partitions: Array<{ partition: string; symbol: string; filePath: string; rawSha256: string;
      semanticDigest: string; actualBarCount: number; partitionDigest: string }>;
  };
  sealReceipt: { sealReceiptDigest: string };
};
type MockedPreHoldoutReceipt = {
  classification: string;
  organizationId: string;
  releaseSha: string;
  qualificationReceiptDigest: string;
  holdout: { status: string };
  partitions: Array<{ partition: string; symbol: string; rawSha256: string;
    semanticContentDigest: string; barCount: number }>;
};
const mocked = vi.hoisted(() => ({ computeRaw: vi.fn(),
  sealed: {} as MockedSealedDataset,
  preHoldout: {} as MockedPreHoldoutReceipt }));
vi.mock("@/lib/trader/market-data/fhv-dataset-seal", () => ({
  computeFhvFileRawSha256: mocked.computeRaw,
  assertFhvDatasetSealed: () => mocked.sealed as never,
}));
vi.mock("@/lib/trader/market-data/fhv-pre-holdout-qualification", () => ({
  readFhvPreHoldoutQualificationReceipt: () => mocked.preHoldout as never,
  assertFhvPreHoldoutQualificationPass: (receipt: { classification: string }) => {
    if (receipt.classification !== "PRE_HOLDOUT_QUALIFICATION=PASS") throw new Error("QUALIFICATION_NOT_PASS");
  },
  assertFhvPreHoldoutFilesMatchReceipt: vi.fn(),
}));

function resetMocks() {
  mocked.computeRaw.mockReset().mockReturnValue(rawHash);
  mocked.sealed = {
    manifest: {
      organizationId: "org", manifestSemanticDigest: digest("b"),
      partitions: [
        { partition: "development", symbol: "BTCUSDT", filePath: "development/BTCUSDT.ndjson", rawSha256: rawHash, semanticDigest, actualBarCount: 2, partitionDigest: digest("c") },
        { partition: "blind-holdout", symbol: "BTCUSDT", filePath: "blind-holdout/BTCUSDT.ndjson", rawSha256: digest("d"), semanticDigest: digest("e"), actualBarCount: 1, partitionDigest: digest("f") },
      ],
    },
    sealReceipt: { sealReceiptDigest: digest("7") },
  };
  mocked.preHoldout = {
    classification: "PRE_HOLDOUT_QUALIFICATION=PASS",
    organizationId: "org",
    releaseSha: "1".repeat(40),
    qualificationReceiptDigest: digest("9"),
    holdout: { status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" },
    partitions: [{ partition: "development", symbol: "BTCUSDT", rawSha256: rawHash,
      semanticContentDigest: semanticDigest, barCount: 2 }],
  };
}

function cycle(index: number, close: string = bars[index]!.close) {
  return { schemaVersion: "waia.trader.historical_sealed_market_cycle.v2", cycleId: `cycle-${index}`, barIndex: index, closedBar: { ...bars[index]!, close }, htxVolumeAuthorityReceipt: {}, htxVolumeRaw: { amount: 10, vol: 10 }, contentDigestHex: digest("8") } as unknown as HistoricalSealedMarketCycleV2;
}
const validCycles = () => [cycle(0), cycle(1)];

describe("Historical Simulation V2 exact dataset membership", () => {
  let datasetRoot = "";
  beforeEach(() => {
    resetMocks();
    datasetRoot = mkdtempSync(join(tmpdir(), "historical-membership-"));
    mkdirSync(join(datasetRoot, "development"));
    writeFileSync(join(datasetRoot, "development/BTCUSDT.ndjson"), raw);
    mkdirSync(join(datasetRoot, "partitions/development/BTCUSDT"), { recursive: true });
    writeFileSync(join(datasetRoot, "partitions/development/BTCUSDT/bars.v2.ndjson"), raw);
  });
  afterEach(() => rmSync(datasetRoot, { recursive: true, force: true }));

  it("binds every cycle to the exact selected sealed partition without reading holdout", async () => {
    const result = await bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: validCycles() });
    expect(result.get("cycle-0")).toMatchObject({ recordIndex: 0, barContentDigestHex: computeBarContentDigest(bars[0]), partition: "DEVELOPMENT" });
    expect(mocked.computeRaw).toHaveBeenCalledTimes(1);
    expect(mocked.computeRaw.mock.calls[0]?.[0]).toBe(join(datasetRoot, "development/BTCUSDT.ndjson"));
    expect(mocked.computeRaw.mock.calls.flat().join(" ")).not.toContain("blind-holdout");
  });

  it("binds qualified pre-holdout cycles without substituting a seal digest", async () => {
    const result = await bindHistoricalCyclesToPreHoldoutDatasetV2({ datasetRoot,
      qualificationReceiptPath: join(datasetRoot, "qualification.json"), releaseSha: "1".repeat(40),
      organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: validCycles() });
    const membership = result.get("cycle-0");
    expect(membership).toMatchObject({ datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1",
      datasetAuthorityDigestHex: digest("9"), qualificationReceiptDigestHex: digest("9") });
    expect(membership).not.toHaveProperty("sealReceiptDigestHex");
    expect(membership).not.toHaveProperty("manifestSemanticDigestHex");
  });

  it("binds only the requested contiguous pre-holdout range after full receipt verification", async () => {
    const result = await bindHistoricalCyclesToPreHoldoutDatasetV2({ datasetRoot,
      qualificationReceiptPath: join(datasetRoot, "qualification.json"), releaseSha: "1".repeat(40),
      organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: [cycle(1)] });
    expect([...result.keys()]).toEqual(["cycle-1"]);
    expect(result.get("cycle-1")).toMatchObject({ recordIndex: 1,
      datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1" });
  });

  it("rejects pre-holdout release, organization and qualification substitution", async () => {
    const base = { datasetRoot, qualificationReceiptPath: join(datasetRoot, "qualification.json"),
      releaseSha: "1".repeat(40), organizationId: "org", partition: "DEVELOPMENT" as const,
      symbol: "BTCUSDT" as const, cycles: validCycles() };
    await expect(bindHistoricalCyclesToPreHoldoutDatasetV2({ ...base, releaseSha: "2".repeat(40) }))
      .rejects.toThrow("RELEASE_SCOPE");
    await expect(bindHistoricalCyclesToPreHoldoutDatasetV2({ ...base, organizationId: "other" }))
      .rejects.toThrow("ORGANIZATION_SCOPE");
    mocked.preHoldout.classification = "PRE_HOLDOUT_QUALIFICATION=HUMAN_DECISION_REQUIRED";
    await expect(bindHistoricalCyclesToPreHoldoutDatasetV2(base)).rejects.toThrow("QUALIFICATION_NOT_PASS");
  });

  it("rejects a self-shaped but non-member bar", async () => {
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: [cycle(0, "9"), cycle(1)] })).rejects.toThrow("BAR_MEMBERSHIP_MISMATCH");
  });

  it("rejects missing, duplicate, skipped and reordered cycle coverage", async () => {
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: [] })).rejects.toThrow("NON_CONTIGUOUS_OR_MISSING_CYCLE");
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: [{ ...cycle(0), barIndex: 1 }, cycle(1)] as never })).rejects.toThrow("NON_CONTIGUOUS_OR_MISSING_CYCLE");
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: [cycle(1), cycle(0)] })).rejects.toThrow("NON_CONTIGUOUS_OR_MISSING_CYCLE");
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: [cycle(0), { ...cycle(1), cycleId: "cycle-0" }] as never })).rejects.toThrow("DUPLICATE_CYCLE_ID");
  });

  it("rejects raw mutation, stale scope and partition or symbol substitution", async () => {
    mocked.computeRaw.mockReturnValueOnce(digest("0"));
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: validCycles() })).rejects.toThrow("RAW_DIGEST_MISMATCH");
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "stale-org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: validCycles() })).rejects.toThrow("ORGANIZATION_SCOPE");
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "WALK_FORWARD", symbol: "BTCUSDT", cycles: validCycles() })).rejects.toThrow("PARTITION_NOT_IN_MANIFEST");
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "ETHUSDT", cycles: validCycles() })).rejects.toThrow("PARTITION_NOT_IN_MANIFEST");
  });

  it("rejects stale semantic/count metadata and escaped manifest paths", async () => {
    mocked.sealed.manifest.partitions[0].semanticDigest = digest("9");
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: validCycles() })).rejects.toThrow("SEMANTIC_DIGEST_MISMATCH");
    resetMocks();
    mocked.sealed.manifest.partitions[0].actualBarCount = 3;
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: validCycles() })).rejects.toThrow("BAR_COUNT_MISMATCH");
    resetMocks();
    mocked.sealed.manifest.partitions[0].filePath = "../outside.ndjson";
    await expect(bindHistoricalCyclesToSealedDatasetV2({ datasetRoot, organizationId: "org", partition: "DEVELOPMENT", symbol: "BTCUSDT", cycles: validCycles() })).rejects.toThrow("FILE_PATH_ESCAPE");
  });
});
