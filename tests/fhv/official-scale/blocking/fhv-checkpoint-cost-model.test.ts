/**
 * WP-3A/WP-3B — FHV checkpoint cost-model gate.
 *
 * GS-13 only ever asserted that a JSON fixture literal equalled 400 and that a source file
 * contained two identifier strings, so a 19x runtime breach (7,647 ms against a 400 ms budget at
 * epoch 414 of PR452 run 31011816726) passed silently. This measures the real curve.
 *
 * Report-only by default (WP-3A). WP-3B promotes it by setting FHV_CHECKPOINT_COST_GATE=blocking.
 */
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  buildFhvCheckpointCostModel,
  FHV_CHECKPOINT_BUDGET_MS_PER_10K,
  FHV_CHECKPOINT_COST_MODEL_FILENAME,
  FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES,
  FHV_CHECKPOINT_TARGET_MS_PER_10K,
  measureFhvCheckpointSnapshotCost,
  projectFhvCheckpointDurationMs,
  type FhvCheckpointCostSampleV1,
} from "@/lib/trader/observability/fhv-checkpoint-cost-model";

import { resolveFhvOfficialScaleArtifactRoot } from "./fhv-official-scale-harness";

const BLOCKING = process.env.FHV_CHECKPOINT_COST_GATE === "blocking";

/**
 * Sizes spanning the observed regime: PR452 epoch 0 was 4.5 MB and epoch 414 was 1.17 GB.
 * The 1-GB point is the Human-approved qualification depth.
 */
const DEFAULT_SIZES_BYTES = [8 * 1024 * 1024, 64 * 1024 * 1024, 256 * 1024 * 1024, 1_073_741_824];

function resolveSizes(): number[] {
  const raw = process.env.FHV_CHECKPOINT_COST_SIZES_BYTES?.trim();
  if (!raw) {
    return DEFAULT_SIZES_BYTES;
  }
  return raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/** Build a real SQLite database of approximately `targetBytes`, then WAL-truncate it. */
function materializeSessionDatabase(path: string, targetBytes: number): void {
  const db = new Database(path);
  try {
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS payload (id INTEGER PRIMARY KEY, blob BLOB NOT NULL)");
    const insert = db.prepare("INSERT INTO payload (blob) VALUES (?)");
    const chunk = Buffer.alloc(1 << 20, 7);
    const rows = Math.max(1, Math.ceil(targetBytes / chunk.length));
    const insertMany = db.transaction((count: number) => {
      for (let index = 0; index < count; index += 1) {
        insert.run(chunk);
      }
    });
    insertMany(rows);
    // Production snapshots always run against a truncated WAL.
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

describe("FHV checkpoint cost model", () => {
  const root = mkdtempSync(join(tmpdir(), "fhv-checkpoint-cost-"));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("measures checkpoint duration across session-database sizes", () => {
    const samples: FhvCheckpointCostSampleV1[] = [];
    for (const targetBytes of resolveSizes()) {
      const caseDir = join(root, `size-${targetBytes}`);
      mkdirSync(caseDir, { recursive: true });
      const sessionPath = join(caseDir, "session.sqlite");
      materializeSessionDatabase(sessionPath, targetBytes);
      samples.push(
        measureFhvCheckpointSnapshotCost({
          sessionPath,
          workDir: join(caseDir, "work"),
        }),
      );
      rmSync(caseDir, { recursive: true, force: true });
    }

    const model = buildFhvCheckpointCostModel(samples);

    const artifactRoot = resolveFhvOfficialScaleArtifactRoot();
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(
      join(artifactRoot, FHV_CHECKPOINT_COST_MODEL_FILENAME),
      `${JSON.stringify(model, null, 2)}\n`,
      "utf8",
    );

    process.stderr.write(
      `[fhv-checkpoint-cost] mode=${BLOCKING ? "blocking" : "report-only"} ` +
        `slope_ms_per_gb=${model.slopeMsPerGigabyte} intercept_ms=${model.interceptMs} ` +
        `growth_exponent=${model.growthExponent} ficlone=${model.ficloneSucceeded} ` +
        `projected_ms_at_1gb=${model.projectedDurationMsAtQualificationDepth} ` +
        `budget_ms=${model.budgetMs} target_ms=${model.targetMs} ` +
        `classification=${model.classification}\n`,
    );
    for (const sample of model.samples) {
      process.stderr.write(
        `[fhv-checkpoint-cost] bytes=${sample.sessionBytes} total_ms=${sample.totalDurationMs} ` +
          `snapshot_ms=${sample.snapshotDurationMs} digest_ms=${sample.digestDurationMs} ` +
          `publish_ms=${sample.publishDurationMs} ficlone=${sample.ficloneSucceeded}\n`,
      );
    }

    expect(model.samples.length).toBeGreaterThanOrEqual(2);
    expect(model.projectedDurationMsAtQualificationDepth).toBeGreaterThan(0);

    if (BLOCKING) {
      // WP-3B: the Human-approved budget at 1-GB-equivalent qualification depth.
      expect(model.projectedDurationMsAtQualificationDepth).toBeLessThanOrEqual(
        FHV_CHECKPOINT_BUDGET_MS_PER_10K,
      );
      // Cost must not grow faster than the data it copies.
      expect(model.growthExponent).toBeLessThanOrEqual(1.15);
    }
  }, 900_000);

  it("documents the Human-approved budget and target", () => {
    expect(FHV_CHECKPOINT_BUDGET_MS_PER_10K).toBe(400);
    expect(FHV_CHECKPOINT_TARGET_MS_PER_10K).toBe(250);
    expect(FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES).toBe(1_073_741_824);
    expect(FHV_CHECKPOINT_TARGET_MS_PER_10K).toBeLessThan(FHV_CHECKPOINT_BUDGET_MS_PER_10K);
  });

  it("detects an injected regression", () => {
    const clean = buildFhvCheckpointCostModel([
      { ...baseSample(8 * 1024 * 1024, 2) },
      { ...baseSample(1_073_741_824, 120) },
    ]);
    expect(clean.withinBudget).toBe(true);
    expect(clean.classification).toBe("FHV_CHECKPOINT_COST_WITHIN_TARGET");

    // The PR452 curve: 32 ms at 3.4 MB, 7,647 ms at 1.17 GB.
    const regressed = buildFhvCheckpointCostModel([
      { ...baseSample(3_379_928, 32.19) },
      { ...baseSample(1_171_103_744, 7_646.92) },
    ]);
    expect(regressed.withinBudget).toBe(false);
    expect(regressed.classification).toBe("FHV_CHECKPOINT_COST_BUDGET_EXCEEDED");
    expect(regressed.projectedDurationMsAtQualificationDepth).toBeGreaterThan(
      FHV_CHECKPOINT_BUDGET_MS_PER_10K,
    );
  });

  it("projects duration linearly in session-database size", () => {
    const model = { slopeMsPerGigabyte: 1_000, interceptMs: 10 };
    expect(projectFhvCheckpointDurationMs(model, 1_073_741_824)).toBeCloseTo(1_010, 3);
    expect(projectFhvCheckpointDurationMs(model, 0)).toBeCloseTo(10, 3);
  });
});

function baseSample(sessionBytes: number, totalDurationMs: number): FhvCheckpointCostSampleV1 {
  return {
    sessionBytes,
    snapshotDurationMs: totalDurationMs / 3,
    digestDurationMs: totalDurationMs / 3,
    publishDurationMs: totalDurationMs / 3,
    totalDurationMs,
    ficloneSucceeded: false,
    effectiveBytesPerSecond: Math.round(sessionBytes / (totalDurationMs / 1000)),
  };
}
