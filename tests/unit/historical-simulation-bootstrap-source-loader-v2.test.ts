import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { computePayloadDigest } from
  "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA } from
  "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
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

  function fixture(sourceReleaseSha = "a".repeat(40)) {
    root = mkdtempSync(join(tmpdir(), "historical-bootstrap-"));
    mkdirSync(join(root, "partitions/development/BTCUSDT"), { recursive: true });
    const raw = bars.map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join("");
    writeFileSync(join(root, "partitions/development/BTCUSDT/bars.v2.ndjson"), raw);
    const volume = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT",
      qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
      rows: [{ id: 1, open: 100, high: 101, low: 99, close: 100,
        amount: 10, vol: 1000, count: 1 }] });
    const volumePath = join(root, "volume.json");
    writeFileSync(volumePath, JSON.stringify(volume));
    bind.mockReturnValue({
      organizationId: "org", releaseSha: sourceReleaseSha,
      qualificationReceiptDigest: "b".repeat(64),
      developmentWalkForwardContentDigest: "c".repeat(64),
      holdout: { status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" },
      partitions: [{ partition: "development", symbol: "BTCUSDT", barCount: bars.length,
        rawSha256: createHash("sha256").update(raw).digest("hex"),
        semanticContentDigest: "d".repeat(64) }],
    });
    return { raw, volume, input: {
      datasetRoot: root,
      qualificationReceiptPath: join(root, "qualification.json"),
      runtimeRequalificationReceiptPath: join(root, "runtime.json"),
      htxVolumeQualificationReceiptPath: volumePath,
      releaseSha: "a".repeat(40), organizationId: "org", runId: "run",
      partition: "DEVELOPMENT" as const, symbol: "BTCUSDT" as const,
      initialRecordIndex: 1, cycleCount: 2,
    } };
  }

  it.each(["file", "directory"])("bounded source refuses a %s symlink with otherwise valid bytes", async kind => {
    const { raw, input } = fixture();
    const original = join(root, kind === "file" ? "partitions/development/BTCUSDT/bars.v2.ndjson" : "partitions/development/BTCUSDT");
    const moved = join(root, "substituted-source");
    renameSync(original, moved);
    symlinkSync(moved, original, kind === "file" ? "file" : "dir");
    await expect(loadHistoricalSimulationBootstrapSourceSnapshotV2({ ...input,
      maxSourceBytes: Buffer.byteLength(raw), maxReceiptBytes: 1024 * 1024,
    })).rejects.toThrow("SOURCE_PATH_SYMLINK");
  });

  it.each(["FIFO", "directory"])("bounded source refuses a nonregular %s without waiting for payload", async kind => {
    const { input } = fixture();
    const file = join(root, "partitions/development/BTCUSDT/bars.v2.ndjson");
    rmSync(file);
    if (kind === "FIFO") execFileSync("mkfifo", [file]);
    else mkdirSync(file);
    await expect(loadHistoricalSimulationBootstrapSourceSnapshotV2({ ...input,
      maxSourceBytes: 1024 * 1024,
    })).rejects.toThrow("SOURCE_NOT_REGULAR");
  });

  function writeRequalification(input: Readonly<{
    sourceQualificationReceiptDigest: string; sourceReleaseSha: string; targetReleaseSha: string;
  }>) {
    const body = {
      schemaVersion: FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA,
      classification: "RUNTIME_REQUALIFICATION=PASS" as const,
      sourceQualificationReceiptDigest: input.sourceQualificationReceiptDigest,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
      datasetContentDigest: "c".repeat(64), organizationId: "org",
      operatorId: "synthetic-operator", verifiedAtUtc: "2026-01-01T00:00:00.000Z",
    };
    const requalificationReceiptDigest = computePayloadDigest(body);
    writeFileSync(join(root, "runtime.json"), JSON.stringify({
      ...body, requalificationReceiptDigest,
    }));
    return requalificationReceiptDigest;
  }

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

  it("returns only verified same-release source metadata from the loaded file and receipts", async () => {
    const { input, raw, volume } = fixture();
    const snapshot = await loadHistoricalSimulationBootstrapSourceSnapshotV2(input);

    expect(snapshot.verifiedSource).toEqual({
      sourceReleaseSha: "a".repeat(40), targetReleaseSha: "a".repeat(40),
      runtimeRequalificationDigestHex: null,
      volumeQualificationDigestHex: volume.qualificationReceiptDigest,
    });
    expect(snapshot.qualificationReceiptDigestHex).toBe("b".repeat(64));
    expect(snapshot.partitionRawSha256Hex).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(snapshot.partitionSemanticDigestHex).toBe("d".repeat(64));
    expect(snapshot.sources.map(source => source.membership.recordIndex)).toEqual([1, 2]);
  });

  it("returns a checked source-to-target release binding and refuses a resealed wrong receipt", async () => {
    const { input, volume } = fixture("e".repeat(40));
    const validDigest = writeRequalification({
      sourceQualificationReceiptDigest: "b".repeat(64),
      sourceReleaseSha: "e".repeat(40), targetReleaseSha: "a".repeat(40),
    });
    const snapshot = await loadHistoricalSimulationBootstrapSourceSnapshotV2(input);
    expect(snapshot.verifiedSource).toEqual({
      sourceReleaseSha: "e".repeat(40), targetReleaseSha: "a".repeat(40),
      runtimeRequalificationDigestHex: validDigest,
      volumeQualificationDigestHex: volume.qualificationReceiptDigest,
    });

    writeRequalification({
      sourceQualificationReceiptDigest: "f".repeat(64),
      sourceReleaseSha: "e".repeat(40), targetReleaseSha: "a".repeat(40),
    });
    await expect(loadHistoricalSimulationBootstrapSourceSnapshotV2(input))
      .rejects.toThrow("RUNTIME_SCOPE");
  });

  it("accepts the exact source byte budget and refuses one byte less", async () => {
    const { input, raw } = fixture();
    const exact = Buffer.byteLength(raw, "utf8");
    const snapshot = await loadHistoricalSimulationBootstrapSourceSnapshotV2({
      ...input, maxSourceBytes: exact,
    });
    expect(snapshot.sources).toHaveLength(2);
    await expect(loadHistoricalSimulationBootstrapSourceSnapshotV2({
      ...input, maxSourceBytes: exact - 1,
    })).rejects.toThrow("SOURCE_BYTE_LIMIT");
  });

  it("refuses an already aborted source load before reading qualification or file bytes", async () => {
    const { input } = fixture();
    const controller = new AbortController();
    controller.abort(new Error("ABORTED_BEFORE_SOURCE_READ"));
    bind.mockClear();

    await expect(loadHistoricalSimulationBootstrapSourceSnapshotV2({
      ...input, signal: controller.signal,
    })).rejects.toThrow("ABORTED_BEFORE_SOURCE_READ");
    expect(bind).not.toHaveBeenCalled();
  });
});
