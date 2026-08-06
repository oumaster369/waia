import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

describe("snapshot-fhv-full-corpus-failure-evidence.sh", () => {
  const dirs: string[] = [];
  const script = join(process.cwd(), "scripts/ops/snapshot-fhv-full-corpus-failure-evidence.sh");

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips transient checkpoint temp dirs and incomplete epoch dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-fail-ev-"));
    dirs.push(root);
    const artifactRoot = join(root, "artifacts");
    const stagingRoot = join(root, "staging");
    const runDir = join(
      artifactRoot,
      "RI-P7",
      "fhv-full-historical",
      "fhv-official-scale-full-corpus",
    );
    const checkpoints = join(runDir, "checkpoints");
    mkdirSync(join(checkpoints, "epoch-1"), { recursive: true });
    writeFileSync(join(checkpoints, "epoch-1", "checkpoint-manifest.v1.json"), "{}\n");
    writeFileSync(join(checkpoints, "epoch-1", ".ready"), "");
    writeFileSync(join(checkpoints, "epoch-1", "session.sqlite"), "complete");

    // Incomplete epoch (no .ready) must be skipped.
    mkdirSync(join(checkpoints, "epoch-2"), { recursive: true });
    writeFileSync(join(checkpoints, "epoch-2", "checkpoint-manifest.v1.json"), "{}\n");

    // Transient publication directory must never be traversed as a completed epoch.
    const transient = join(checkpoints, ".epoch-3.tmp-999-1");
    mkdirSync(transient, { recursive: true });
    writeFileSync(join(transient, "session.sqlite"), "mutating");

    writeFileSync(join(runDir, "fhv-launch-journal.v1.json"), '{"lastCommittedEpoch":1}\n');
    writeFileSync(
      join(artifactRoot, "fhv-full-historical-progress.v1.json"),
      '{"schemaVersion":"fhv-full-historical-progress/v1","globalEventSequence":100}\n',
    );

    chmodSync(script, 0o755);
    execFileSync(
      "bash",
      [
        script,
        "--artifact-root",
        artifactRoot,
        "--staging-root",
        stagingRoot,
        "--primary-exit-code",
        "1",
        "--skip-kill",
      ],
      { stdio: "pipe" },
    );

    const stagedEpoch1 = join(stagingRoot, "run", "checkpoints", "epoch-1");
    const stagedEpoch2 = join(stagingRoot, "run", "checkpoints", "epoch-2");
    const stagedTransient = join(stagingRoot, "run", "checkpoints", ".epoch-3.tmp-999-1");
    // WP-10: the completed epoch is staged, but its session database is represented by a digest
    // rather than a copy — two epochs of it were 2.33 GB of a 2.35 GB upload.
    expect(existsSync(join(stagedEpoch1, "checkpoint-manifest.v1.json"))).toBe(true);
    expect(existsSync(join(stagedEpoch1, "session.sqlite"))).toBe(false);
    const digest = readFileSync(join(stagedEpoch1, "session.sqlite.digest.txt"), "utf8");
    expect(digest).toContain("bytes=8");
    expect(digest).toMatch(/sha256=[0-9a-f]{64}/);
    expect(existsSync(stagedEpoch2)).toBe(false);
    expect(existsSync(stagedTransient)).toBe(false);

    const missing = readFileSync(join(stagingRoot, "missing-required-evidence.txt"), "utf8");
    expect(missing).toContain("skipped_incomplete_checkpoint:");
    expect(missing).toContain("skipped_transient:");

    const manifest = JSON.parse(
      readFileSync(join(stagingRoot, "fhv-full-corpus-failure-evidence-manifest.v1.json"), "utf8"),
    ) as { passUpgraded: boolean; completedCheckpointCount: number; primaryExitCode: number };
    expect(manifest.passUpgraded).toBe(false);
    expect(manifest.completedCheckpointCount).toBe(1);
    expect(manifest.primaryExitCode).toBe(1);
  });

  it("tolerates rename race during copy without failing the snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-fail-race-"));
    dirs.push(root);
    const artifactRoot = join(root, "artifacts");
    const stagingRoot = join(root, "staging");
    const runDir = join(
      artifactRoot,
      "RI-P7",
      "fhv-full-historical",
      "fhv-official-scale-full-corpus",
    );
    const checkpoints = join(runDir, "checkpoints");
    mkdirSync(join(checkpoints, "epoch-9"), { recursive: true });
    writeFileSync(join(checkpoints, "epoch-9", "checkpoint-manifest.v1.json"), "{}\n");
    writeFileSync(join(checkpoints, "epoch-9", ".ready"), "");
    writeFileSync(join(checkpoints, "epoch-9", "session.sqlite"), "x".repeat(1024));

    // Simulate retention deleting an epoch while listing: create then rename away mid-flight
    // by having the script skip incompletes; here we rename a completed dir to a temp name
    // before snapshot — snapshot must still exit 0.
    renameSync(join(checkpoints, "epoch-9"), join(checkpoints, ".epoch-9.tmp-gone"));

    chmodSync(script, 0o755);
    expect(() =>
      execFileSync(
        "bash",
        [
          script,
          "--artifact-root",
          artifactRoot,
          "--staging-root",
          stagingRoot,
          "--primary-exit-code",
          "124",
          "--skip-kill",
        ],
        { stdio: "pipe" },
      ),
    ).not.toThrow();

    const manifest = JSON.parse(
      readFileSync(join(stagingRoot, "fhv-full-corpus-failure-evidence-manifest.v1.json"), "utf8"),
    ) as { classification: string; passUpgraded: boolean };
    expect(manifest.classification).toBe("FHV_FULL_CORPUS_FAILURE_EVIDENCE_STAGED");
    expect(manifest.passUpgraded).toBe(false);
  });
});
