import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { qualifyHtxKlineVolumeAuthority } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { loadHistoricalSimulationBootstrapSourceCyclesV2 } from
  "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";

const bind = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trader/historical-simulation-v2/dataset-membership-v2", async (original) => ({
  ...await original<typeof import("@/lib/trader/historical-simulation-v2/dataset-membership-v2")>(),
  bindHistoricalCyclesToPreHoldoutDatasetV2: bind,
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
    writeFileSync(join(root, "partitions/development/BTCUSDT/bars.v2.ndjson"),
      bars.map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join(""));
    const volume = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT", qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
      rows: [{ id: 1, open: 100, high: 101, low: 99, close: 100, amount: 10, vol: 1000, count: 1 }] });
    const volumePath = join(root, "volume.json"); writeFileSync(volumePath, JSON.stringify(volume));
    bind.mockImplementation(async ({ cycles }: { cycles: Array<{ cycleId: string; barIndex: number }> }) =>
      new Map(cycles.map((cycle) => [cycle.cycleId, { cycleId: cycle.cycleId, recordIndex: cycle.barIndex }])));
    const result = await loadHistoricalSimulationBootstrapSourceCyclesV2({ datasetRoot: root,
      qualificationReceiptPath: join(root, "qualification.json"),
      runtimeRequalificationReceiptPath: join(root, "runtime.json"),
      htxVolumeQualificationReceiptPath: volumePath, releaseSha: "a".repeat(40), organizationId: "org",
      runId: "run", partition: "DEVELOPMENT", symbol: "BTCUSDT", initialRecordIndex: 1, cycleCount: 2 });
    expect(result.map((value) => value.cycle.barIndex)).toEqual([1, 2]);
    expect(result.map((value) => value.membership.recordIndex)).toEqual([1, 2]);
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ releaseSha: "a".repeat(40),
      runtimeRequalificationReceiptPath: join(root, "runtime.json") }));
  });
});
