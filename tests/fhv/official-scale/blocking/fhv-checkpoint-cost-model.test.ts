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
        `hash_equivalent_passes=${gate.hashEquivalentPasses} ` +
        `allowed_passes=${gate.allowedHashEquivalentPasses} ` +
        `native_clone_observed=${gate.nativeCloneObserved} ` +
        `structurally_sound=${gate.structurallySound} ` +
        `host_launch_qualified=${gate.hostLaunchQualified}\n`,
    );

    expect(model.samples.length).toBeGreaterThanOrEqual(2);
    expect(model.projectedDurationMsAtQualificationDepth).toBeGreaterThan(0);

    // Merge-blocking: the checkpoint must cost about one hash pass over its own bytes. A
    // reintroduced full copy lands near 2.0 and the pre-WP-3B clone-then-rehash shape near 3.0.
    expect(gate.structurallySound).toBe(true);
    // Cost must not grow faster than the data it copies.
    expect(model.growthExponent).toBeLessThanOrEqual(1.15);
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
    const hostBytesPerSecond = 2_700_000_000;
    const oneHashPassMs = (bytes / hostBytesPerSecond) * 1000;

    const cloneShaped = evaluateFhvCheckpointSoftwareGate({
      samples: [{ ...baseSample(bytes, oneHashPassMs * 1.02), ficloneSucceeded: true }],
      hostSha256BytesPerSecond: hostBytesPerSecond,
    });
    expect(cloneShaped.structurallySound).toBe(true);

    // A reintroduced second full pass fails even though the host is unchanged.
    const regressed = evaluateFhvCheckpointSoftwareGate({
      samples: [{ ...baseSample(bytes, oneHashPassMs * 2.4), ficloneSucceeded: true }],
      hostSha256BytesPerSecond: hostBytesPerSecond,
    });
    expect(regressed.structurallySound).toBe(false);

    // A merely slow host stays structurally sound: runner speed must not fail a pull request.
    const slowHost = evaluateFhvCheckpointSoftwareGate({
      samples: [{ ...baseSample(bytes, oneHashPassMs * 1.02 * 7), ficloneSucceeded: true }],
      hostSha256BytesPerSecond: hostBytesPerSecond / 7,
    });
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
    effectiveBytesPerSecond: Math.round(sessionBytes / (totalDurationMs / 1000)),
  };
}
