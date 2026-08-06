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
  FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES,
  FHV_CHECKPOINT_TARGET_MS_PER_10K,
  measureFhvCheckpointSnapshotCost,
  projectFhvCheckpointDurationMs,
  type FhvCheckpointCostSampleV1,
} from "@/lib/trader/observability/fhv-checkpoint-cost-model";
import {
  calibrateRawDurableCopyBytesPerSecond,
  calibrateSingleStreamSha256BytesPerSecond,
  computeFhvTargetHostRequirement,
  evaluateFhvCheckpointSoftwareGate,
} from "@/lib/trader/observability/fhv-checkpoint-host-requirement";

import { resolveFhvOfficialScaleArtifactRoot } from "./fhv-official-scale-harness";

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
    const sizes = resolveSizes();
    const deepestBytes = Math.max(...sizes);
    let rawCopyBytesPerSecond = 0;
    for (const targetBytes of sizes) {
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
      if (targetBytes === deepestBytes) {
        // Storage half of the fallback baseline, measured with the qualification bytes on the
        // filesystem the checkpoint actually uses.
        rawCopyBytesPerSecond = calibrateRawDurableCopyBytesPerSecond({
          sourcePath: sessionPath,
          destPath: join(caseDir, "raw-copy-baseline.bin"),
        });
      }
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
      `[fhv-checkpoint-cost] mode=blocking ` +
        `slope_ms_per_gb=${model.slopeMsPerGigabyte} intercept_ms=${model.interceptMs} ` +
        `growth_exponent=${model.growthExponent} ficlone=${model.ficloneSucceeded} ` +
        `projected_ms_at_supported_envelope=${model.projectedDurationMsAtSupportedEnvelope} ` +
        `projected_ms_at_1gb_stress=${model.projectedDurationMsAtQualificationDepth} ` +
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

    /*
     * WP-3B software gate (ADR-0025 AD-6). The absolute 1-GiB / 400 ms contract is unchanged but
     * is host-class dependent — run 31098325969 measured 735-781 ms on macos-15 and 2743-3007 ms
     * on macos-15-intel against 392-396 ms on the reference workstation, entirely from SHA-256
     * throughput. Asserting wall clock here would let runner speed decide software correctness,
     * so the absolute gate lives in the Execution Server preflight and this gate measures the
     * algorithm in units of the host's own hashing speed.
     */
    const gate = evaluateFhvCheckpointSoftwareGate({
      samples: model.samples,
      hostSha256BytesPerSecond: calibrateSingleStreamSha256BytesPerSecond(),
      hostRawCopyBytesPerSecond: rawCopyBytesPerSecond,
    });

    process.stderr.write(
      `[fhv-checkpoint-host-requirement] ` +
        `required_sha256_bytes_per_second=${gate.requirement.requiredSingleStreamSha256BytesPerSecond} ` +
        `max_non_hash_ms=${gate.requirement.maximumAllowedNonHashMilliseconds} ` +
        `required_clone=${gate.requirement.requiredNativeCloneCapability} ` +
        `required_filesystems=${gate.requirement.requiredFilesystemSemantics.join("|")} ` +
        `required_complete_ms=${gate.requirement.requiredCompleteCheckpointMilliseconds} ` +
        `qualification_depth_bytes=${gate.requirement.qualificationDepthBytes}\n`,
    );
    process.stderr.write(
      `[fhv-checkpoint-software-gate] host_sha256_bytes_per_second=${gate.hostSha256BytesPerSecond} ` +
        `host_raw_copy_bytes_per_second=${rawCopyBytesPerSecond} ` +
        `necessary_work_ms=${gate.necessaryWorkMs} observed_ms=${gate.observedMs} ` +
        `necessary_work_ratio=${gate.necessaryWorkRatio} allowed_ratio=${gate.allowedNecessaryWorkRatio} ` +
        `source_traversals=${gate.sourceTraversals} dest_traversals=${gate.destTraversals} ` +
        `digest_passes=${gate.digestPasses} traversals_sound=${gate.traversalsSound} ` +
        `timing_sound=${gate.timingSound} ` +
        `native_clone_observed=${gate.nativeCloneObserved} ` +
        `structurally_sound=${gate.structurallySound} ` +
        `host_launch_qualified=${gate.hostLaunchQualified}\n`,
    );

    expect(model.samples.length).toBeGreaterThanOrEqual(2);
    expect(model.projectedDurationMsAtQualificationDepth).toBeGreaterThan(0);

    /*
     * Merge-blocking, proven two independent ways: the algorithm moves each byte once, and it
     * costs about the work that is structurally necessary on this host. Timing alone is not
     * enough — a storage-bound runner is slow without being wrong — and traversal counting alone
     * cannot see redundant work outside the instrumented helpers.
     */
    expect(gate.traversalsSound).toBe(true);
    expect(gate.timingSound).toBe(true);
    expect(gate.structurallySound).toBe(true);
    expect(gate.sourceTraversals).toBeLessThanOrEqual(1.05);
    expect(gate.digestPasses).toBeGreaterThan(0);

    /*
     * Cost must not grow faster than the data it moves. Traversal accounting proves that directly
     * and at every depth: bytes moved divided by session bytes is exactly one, so byte movement is
     * linear in size by construction. This is a stronger claim than the log-log duration fit below,
     * and unlike that fit it cannot be perturbed by a contended disk.
     */
    for (const sample of model.samples) {
      expect(sample.sourceTraversals).toBeLessThanOrEqual(1.05);
      expect(sample.digestPasses).toBeLessThanOrEqual(1.05);
      expect(sample.digestPasses).toBeGreaterThan(0);
      expect(sample.destTraversals).toBeLessThanOrEqual(sample.ficloneSucceeded ? 0.001 : 1.05);
    }
    /*
     * The duration-fit exponent is retained for the qualifying host class, where the checkpoint is
     * CPU-bound on SHA-256 and the fit is stable. On a fallback host the same code measured 1.0972
     * and 1.2064 in two consecutive runs on one GitHub runner, because the second inherited a page
     * cache the first had just flooded with 1.4 GB — that spread is the disk, not the algorithm,
     * whose linearity the traversal assertions above already prove exactly.
     */
    if (gate.nativeCloneObserved) {
      expect(model.growthExponent).toBeLessThanOrEqual(1.15);
    } else {
      process.stderr.write(
        `[fhv-checkpoint-cost] fallback host: growth_exponent=${model.growthExponent} reported, ` +
          `linearity enforced structurally by traversal accounting\n`,
      );
    }
    // Publish must remain a move, not a second full copy, at every measured depth.
    for (const sample of model.samples) {
      expect(sample.publishDurationMs).toBeLessThan(sample.snapshotDurationMs + 50);
    }
    // Every required durability operation must still be inside the measured interval.
    for (const sample of model.samples) {
      expect(sample.fsyncDurationMs).toBeGreaterThan(0);
      expect(sample.directoryDurabilityMs).toBeGreaterThan(0);
      expect(sample.manifestAttestationMs).toBeGreaterThan(0);
      expect(sample.totalDurationMs).toBeGreaterThanOrEqual(
        sample.fsyncDurationMs + sample.directoryDurabilityMs + sample.manifestAttestationMs,
      );
    }
    // The contract itself is never relaxed by this split.
    expect(gate.requirement.requiredCompleteCheckpointMilliseconds).toBe(400);
    expect(gate.requirement.qualificationDepthBytes).toBe(1_073_741_824);
    expect(gate.requirement.requiredNativeCloneCapability).toBe("NATIVE_CLONE_REQUIRED");
  }, 900_000);

  it("computes a target-host requirement that rises when fixed overhead is reintroduced", () => {
    const lean = computeFhvTargetHostRequirement([baseSample(1_073_741_824, 395)]);
    const overheaded = computeFhvTargetHostRequirement([
      { ...baseSample(1_073_741_824, 395), publishDurationMs: 120 },
    ]);

    // Extra non-hash work leaves less of the 400 ms for hashing, demanding a faster host. This is
    // what makes a capability regression visible on any runner.
    expect(overheaded.maximumAllowedNonHashMilliseconds).toBeGreaterThan(
      lean.maximumAllowedNonHashMilliseconds,
    );
    expect(overheaded.requiredSingleStreamSha256BytesPerSecond).toBeGreaterThan(
      lean.requiredSingleStreamSha256BytesPerSecond,
    );
    expect(lean.requiredCompleteCheckpointMilliseconds).toBe(FHV_CHECKPOINT_BUDGET_MS_PER_10K);
  });

  it("fails a structural regression regardless of how fast the host is", () => {
    const bytes = 1_073_741_824;
    const hashBps = 2_700_000_000;
    const copyBps = 400_000_000;
    const hashMs = (bytes / hashBps) * 1000;
    const copyMs = (bytes / copyBps) * 1000;
    const clone = (total: number) => ({
      ...baseSample(bytes, total),
      ficloneSucceeded: true,
      sourceTraversals: 1,
      destTraversals: 0,
      digestPasses: 1,
    });
    const fallback = (total: number) => ({
      ...baseSample(bytes, total),
      ficloneSucceeded: false,
      sourceTraversals: 1,
      destTraversals: 1,
      digestPasses: 1,
    });
    const evaluate = (sample: FhvCheckpointCostSampleV1, hostHashBps = hashBps) =>
      evaluateFhvCheckpointSoftwareGate({
        samples: [sample],
        hostSha256BytesPerSecond: hostHashBps,
        hostRawCopyBytesPerSecond: copyBps,
      });

    expect(evaluate(clone(hashMs * 1.02)).structurallySound).toBe(true);
    expect(evaluate(fallback(copyMs + hashMs)).structurallySound).toBe(true);

    // An extra full read: the clone path rehashes instead of hashing once.
    const extraRead = evaluate({ ...clone(hashMs * 2.2), sourceTraversals: 2, digestPasses: 2 });
    expect(extraRead.traversalsSound).toBe(false);
    expect(extraRead.structurallySound).toBe(false);

    // An extra full copy: the fallback writes the destination twice.
    const extraCopy = evaluate({ ...fallback(copyMs * 2 + hashMs), destTraversals: 2 });
    expect(extraCopy.traversalsSound).toBe(false);

    // Copy-then-rehash: correct traversal counts are impossible, and the timing exceeds the
    // necessary work on this host even though the host itself is unchanged.
    expect(evaluate(fallback(copyMs + hashMs * 2 + copyMs * 0.5)).timingSound).toBe(false);

    // Omitted hashing must never look sound.
    expect(evaluate({ ...clone(hashMs * 0.1), digestPasses: 0 }).structurallySound).toBe(false);

    // False reflink reporting: claiming a clone while still writing the destination.
    expect(evaluate({ ...clone(hashMs * 1.02), destTraversals: 1 }).traversalsSound).toBe(false);

    // A merely slow host stays structurally sound: runner speed must not fail a pull request.
    const slowHost = evaluate(clone(hashMs * 7 * 1.02), hashBps / 7);
    expect(slowHost.structurallySound).toBe(true);
    expect(slowHost.hostLaunchQualified).toBe(false);
  });

  it("documents the Human-approved budget and target", () => {
    expect(FHV_CHECKPOINT_BUDGET_MS_PER_10K).toBe(400);
    expect(FHV_CHECKPOINT_TARGET_MS_PER_10K).toBe(250);
    expect(FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES).toBe(1_073_741_824);
    expect(FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES).toBe(536_870_912);
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
    fsyncDurationMs: totalDurationMs / 9,
    directoryDurabilityMs: totalDurationMs / 9,
    manifestAttestationMs: totalDurationMs / 9,
    publishDurationMs: 0,
    totalDurationMs,
    ficloneSucceeded: false,
    digestFusedIntoSnapshot: false,
    sourceTraversals: 1,
    destTraversals: 1,
    digestPasses: 1,
    effectiveBytesPerSecond: Math.round(sessionBytes / (totalDurationMs / 1000)),
  };
}
