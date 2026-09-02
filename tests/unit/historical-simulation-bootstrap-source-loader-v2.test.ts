import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { qualifyHtxKlineVolumeAuthority } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import {
  loadHistoricalSimulationBootstrapSourceCyclesV2,
  loadHistoricalSimulationBootstrapSourceSnapshotV2,
} from
  "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";

const bind = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trader/market-data/fhv-pre-holdout-qualification", async (original) => ({
  ...await original<typeof import("@/lib/trader/market-data/fhv-pre-holdout-qualification")>(),
  readFhvPreHoldoutQualificationReceipt: bind,
  assertFhvPreHoldoutQualificationPass: vi.fn(),
}));

const bars = [0, 1, 2].map((index) => ({ symbol: "BTC/USDT" as const, interval: "1m" as const,
  open: "100", high: "101", low: "99", close: String(100 + index), volume: "10",
  barOpenTime: `2026-01-01T00:0${index}:00.000Z`,
  barCloseTime: `2026-01-01T00:0${index + 1}:00.000Z` }));

describe("Historical Simulation V2 bootstrap source loader", () => {
  let root = "";
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); bind.mockReset(); });

  it("loads only the requested contiguous range and binds exact memberships", async () => {
    root = mkdtempSync(join(tmpdir(), "historical-bootstrap-"));
    mkdirSync(join(root, "partitions/development/BTCUSDT"), { recursive: true });
    const raw = bars.map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join("");
    writeFileSync(join(root, "partitions/development/BTCUSDT/bars.v2.ndjson"), raw);
    const volume = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT", qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
      rows: [{ id: 1, open: 100, high: 101, low: 99, close: 100, amount: 10, vol: 1000, count: 1 }] });
    const volumePath = join(root, "volume.json"); writeFileSync(volumePath, JSON.stringify(volume));
    bind.mockReturnValue({
      organizationId: "org",
      releaseSha: "a".repeat(40),
      qualificationReceiptDigest: "b".repeat(64),
      developmentWalkForwardContentDigest: "c".repeat(64),
      holdout: { status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" },
      partitions: [{ partition: "development", symbol: "BTCUSDT", barCount: bars.length,
        rawSha256: createHash("sha256").update(raw).digest("hex"),
        semanticContentDigest: "d".repeat(64) }],
    });
    const result = await loadHistoricalSimulationBootstrapSourceCyclesV2({ datasetRoot: root,
      qualificationReceiptPath: join(root, "qualification.json"),
      runtimeRequalificationReceiptPath: join(root, "runtime.json"),
      htxVolumeQualificationReceiptPath: volumePath, releaseSha: "a".repeat(40), organizationId: "org",
      runId: "run", partition: "DEVELOPMENT", symbol: "BTCUSDT", initialRecordIndex: 1, cycleCount: 2 });
    expect(result.map((value) => value.cycle.barIndex)).toEqual([1, 2]);
    expect(result.map((value) => value.membership.recordIndex)).toEqual([1, 2]);
    expect(result.every((value) =>
      value.membership.partitionRawSha256Hex ===
      createHash("sha256").update(raw).digest("hex"))).toBe(true);
  });

  it("fails closed when source registration observes B after authority qualified A", async () => {
    root = mkdtempSync(join(tmpdir(), "historical-bootstrap-"));
    mkdirSync(join(root, "partitions/development/BTCUSDT"), { recursive: true });
    const qualifiedRaw = bars
      .map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join("");
    const substitutedRaw = bars.map((bar, index) => serializeFhvBarsV2Record(
      barToFhvBarsV2Record(index === 1 ? { ...bar, close: "777" } : bar),
    )).join("");
    writeFileSync(join(root, "partitions/development/BTCUSDT/bars.v2.ndjson"), substitutedRaw);
    const volume = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT",
      qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
      rows: [{ id: 1, open: 100, high: 101, low: 99, close: 100,
        amount: 10, vol: 1000, count: 1 }] });
    const volumePath = join(root, "volume.json"); writeFileSync(volumePath, JSON.stringify(volume));
    bind.mockReturnValue({
      organizationId: "org", releaseSha: "a".repeat(40),
      qualificationReceiptDigest: "b".repeat(64),
      developmentWalkForwardContentDigest: "c".repeat(64),
      holdout: { status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" },
      partitions: [{ partition: "development", symbol: "BTCUSDT", barCount: bars.length,
        rawSha256: createHash("sha256").update(qualifiedRaw).digest("hex"),
        semanticContentDigest: "d".repeat(64) }],
    });

    await expect(loadHistoricalSimulationBootstrapSourceSnapshotV2({ datasetRoot: root,
      qualificationReceiptPath: join(root, "qualification.json"),
      runtimeRequalificationReceiptPath: join(root, "runtime.json"),
      htxVolumeQualificationReceiptPath: volumePath, releaseSha: "a".repeat(40), organizationId: "org",
      runId: "run", partition: "DEVELOPMENT", symbol: "BTCUSDT", initialRecordIndex: 1, cycleCount: 2 }))
      .rejects.toThrow("SOURCE_RANGE_MISSING");
  });
});
