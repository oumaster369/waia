import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FULL_CORPUS_CHECKPOINT_EVERY_CYCLES,
  FHV_OFFICIAL_SCALE_PROFILE_RUN_COUNT,
  FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE,
  FHV_OFFICIAL_SCALE_PROFILE_TOTAL_CYCLES,
  resolveProfileRunId,
  type FhvOfficialScaleProfileRunLabel,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-profile-constants";
import {
  buildHotspotRegisterAndSummaryDocuments,
  buildTierBaseline,
  computeBracketControlMsPerBar,
  computeExclusiveFloorMsPerBar,
  computeProfilerOverheadPercent,
  median,
  reconcileExclusiveStages,
  resolveSourceCapturedAtUtc,
  stableJsonStringify,
  writeHotspotRegisterAndSummary,
  type ProfileRunMetricsV1,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-profile-harness";

const SEALED_MACHINE = {
  hostname: "fixture-host",
  nodeVersion: "v22.0.0",
  platform: "darwin",
  arch: "arm64",
  cpuModel: "fixture-cpu",
  logicalCores: 8,
  totalMemoryBytes: 16_000_000_000,
  cwd: "/fixture/cwd",
  filesystemNote: "local workspace artifact root",
  freeMemoryBytesOmittedReason:
    "volatile_at_finalize_excluded_from_sealed_summary_measurement_rss_heap_live_in_run_metrics",
} as const;

function fixtureMetrics(): ProfileRunMetricsV1[] {
  return FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE.map((entry, index) => {
    const stages =
      entry.runLabel === "A-P1"
        ? {
            stageExclusiveNsByStage: {
              "paper-cycle": "90000000000",
              "bar-source-next": "1000000000",
              "account-state-refresh": "2000000000",
              "evidence-export": "500000000",
              "clock-advance": "100000000",
              "fused-context-build": "50000000",
              "canvas-advance": "0",
            },
            stageExclusiveTotalNs: "93650000000",
          }
        : {};
    const windowAt100k =
      entry.runLabel === "C-P0-3"
        ? {
            wallTimeMs: 5_000_000,
            barsProcessed: 100_000,
            barsPerSecond: 20,
            rssBytes: 1_000_000_000,
            heapUsedBytes: 200_000_000,
          }
        : null;
    return {
      schemaVersion: "fhv-official-scale-profile-run-metrics/v1",
      runLabel: entry.runLabel,
      runId: resolveProfileRunId(entry.runLabel),
      runRoot: `/fixture/runs/${entry.runLabel}`,
      mode: entry.mode,
      tier: entry.tier,
      targetCycleCount: entry.targetCycleCount,
      cycleCount: entry.targetCycleCount,
      barsProcessed: entry.targetCycleCount,
      wallTimeMs: 1_000_000 + index,
      barsPerSecond: 50 - index * 0.1,
      cyclesPerSecond: 49 - index * 0.1,
      msPerBar: 20 + index * 0.01,
      heapUsedBytes: 100_000_000,
      rssBytes: 500_000_000,
      checkpointCount: Math.max(1, Math.floor(entry.targetCycleCount / 10_000)),
      checkpointBytes: 1_000_000,
      checkpointBackupDurationMs: null,
      sessionDbBytes: 2_000_000,
      walBytes: null,
      evidenceBytes: 3_000_000,
      classification: "FHV_SYNTHETIC_SCALE_PROBE_COMPLETED",
      ...stages,
      windowAt100k,
      capturedAtUtc: `2026-08-02T12:${String(index).padStart(2, "0")}:00.000Z`,
    };
  });
}

describe("fhv-official-scale-profile-harness math", () => {
  it("locks schedule size and cycle budget", () => {
    expect(FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE).toHaveLength(FHV_OFFICIAL_SCALE_PROFILE_RUN_COUNT);
    expect(FHV_OFFICIAL_SCALE_PROFILE_TOTAL_CYCLES).toBe(860_000);
    expect(FULL_CORPUS_CHECKPOINT_EVERY_CYCLES).toBe(10_000);
    const sum = FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE.reduce(
      (acc, entry) => acc + entry.targetCycleCount,
      0,
    );
    expect(sum).toBe(860_000);
  });

  it("builds deterministic run ids", () => {
    expect(resolveProfileRunId("A-P1")).toBe("pr452-profile-a-p1-1336ed3");
    expect(resolveProfileRunId("C-P0-3")).toBe("pr452-profile-c-p0-3-1336ed3");
  });

  it("computes median and tier baseline", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const baseline = buildTierBaseline([70, 72, 71]);
    expect(baseline.median).toBe(71);
    expect(baseline.min).toBe(70);
    expect(baseline.max).toBe(72);
    expect(baseline.range).toBe(2);
  });

  it("computes bracketing profiler overhead formula", () => {
    const bracket = computeBracketControlMsPerBar(10, 12);
    expect(bracket).toBe(11);
    expect(computeProfilerOverheadPercent(12.1, bracket)).toBeCloseTo(10, 5);
  });

  it("reconciles exclusive stages within 5%", () => {
    // 100 ms wall = 100_000_000 ns; exclusive 90 ms leaves 10 ms unattributed.
    const ok = reconcileExclusiveStages({
      exclusiveStageTotalNs: 90_000_000n,
      controlNormalizedWallTimeMs: 100,
    });
    expect(ok.pass).toBe(true);
    const fail = reconcileExclusiveStages({
      exclusiveStageTotalNs: 50_000_000n,
      controlNormalizedWallTimeMs: 100,
      unattributedNs: 0n,
    });
    expect(fail.pass).toBe(false);
  });

  it("computes exclusive floor vs 1.140 ms/bar", () => {
    const floor = computeExclusiveFloorMsPerBar({
      stageExclusiveNsByStage: {
        // totals across 10_000 bars → ms/bar = totalNs/1e6/bars
        "paper-cycle": String(80_000_000_000), // 8 ms/bar
        "bar-source-next": String(5_000_000_000), // 0.5 ms/bar
        "fused-context-build": String(1_000_000_000), // removable 0.1 ms/bar
      },
      barsProcessed: 10_000,
    });
    expect(floor.nonRemovableExclusiveFloorMsPerBar).toBeCloseTo(8.5, 5);
    expect(floor.floorAtOrBelowTarget).toBe(false);
  });

  it("derives captured provenance timestamp from source metrics", () => {
    const metrics = fixtureMetrics();
    const expected = metrics.reduce(
      (max, row) => (row.capturedAtUtc > max ? row.capturedAtUtc : max),
      metrics[0]!.capturedAtUtc,
    );
    expect(resolveSourceCapturedAtUtc(metrics)).toBe(expected);
    const docs = buildHotspotRegisterAndSummaryDocuments({
      profilingHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      allMetrics: metrics,
      terminalClassification:
        "PR452_OFFICIAL_SCALE_PROFILE_COMPLETE_AWAITING_HUMAN_ARCHITECTURE_DECISION",
      sealedMachineRuntime: SEALED_MACHINE,
    });
    expect(docs.summary.sourceCapturedAtUtc).toBe(expected);
    expect(docs.summary.capturedAtUtc).toBe(expected);
    expect(docs.hotspotRegister.sourceCapturedAtUtc).toBe(expected);
  });

  it("requires canonical twenty-run schedule order", () => {
    const metrics = fixtureMetrics();
    const swapped = [...metrics];
    const tmp = swapped[0]!;
    swapped[0] = swapped[1]!;
    swapped[1] = tmp;
    expect(() =>
      buildHotspotRegisterAndSummaryDocuments({
        profilingHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        allMetrics: swapped,
        terminalClassification:
          "PR452_OFFICIAL_SCALE_PROFILE_COMPLETE_AWAITING_HUMAN_ARCHITECTURE_DECISION",
        sealedMachineRuntime: SEALED_MACHINE,
      }),
    ).toThrow(/NON_CANONICAL_ORDER/);
  });

  it("two finalize-only executions over identical fixtures are byte-identical", () => {
    const metrics = fixtureMetrics();
    const profilingHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const terminal = "PR452_OFFICIAL_SCALE_PROFILE_COMPLETE_AWAITING_HUMAN_ARCHITECTURE_DECISION";
    const rootA = mkdtempSync(join(tmpdir(), "fhv-profile-seal-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "fhv-profile-seal-b-"));
    try {
      writeHotspotRegisterAndSummary({
        profileRoot: rootA,
        profilingHead,
        allMetrics: metrics,
        terminalClassification: terminal,
        sealedMachineRuntime: SEALED_MACHINE,
      });
      writeHotspotRegisterAndSummary({
        profileRoot: rootB,
        profilingHead,
        allMetrics: metrics,
        terminalClassification: terminal,
        sealedMachineRuntime: SEALED_MACHINE,
      });
      const hotspotA = readFileSync(join(rootA, "hotspot-register.v1.json"));
      const hotspotB = readFileSync(join(rootB, "hotspot-register.v1.json"));
      const summaryA = readFileSync(join(rootA, "profile-summary.v1.json"));
      const summaryB = readFileSync(join(rootB, "profile-summary.v1.json"));
      expect(hotspotA.equals(hotspotB)).toBe(true);
      expect(summaryA.equals(summaryB)).toBe(true);
      const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
      expect(sha(hotspotA)).toBe(sha(hotspotB));
      expect(sha(summaryA)).toBe(sha(summaryB));
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("changing one source metric changes the summary digest", () => {
    const metrics = fixtureMetrics();
    const profilingHead = "cccccccccccccccccccccccccccccccccccccccc";
    const terminal = "PR452_OFFICIAL_SCALE_PROFILE_COMPLETE_AWAITING_HUMAN_ARCHITECTURE_DECISION";
    const base = buildHotspotRegisterAndSummaryDocuments({
      profilingHead,
      allMetrics: metrics,
      terminalClassification: terminal,
      sealedMachineRuntime: SEALED_MACHINE,
    });
    const mutated = fixtureMetrics();
    const cIndex = mutated.findIndex(
      (row) => row.runLabel === ("C-P0-3" as FhvOfficialScaleProfileRunLabel),
    );
    mutated[cIndex] = {
      ...mutated[cIndex]!,
      barsPerSecond: mutated[cIndex]!.barsPerSecond + 1,
    };
    const next = buildHotspotRegisterAndSummaryDocuments({
      profilingHead,
      allMetrics: mutated,
      terminalClassification: terminal,
      sealedMachineRuntime: SEALED_MACHINE,
    });
    const sha = (value: unknown) =>
      createHash("sha256").update(stableJsonStringify(value)).digest("hex");
    expect(sha(base.summary)).not.toBe(sha(next.summary));
    expect(sha(base.hotspotRegister)).toBe(sha(next.hotspotRegister));
  });
});
