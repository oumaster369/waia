/**
 * WP-2 — FHV artifact identity filename contract.
 *
 * The writer emitted FINAL_HEAD.txt / artifact-identity.v1.json while the failure-evidence
 * snapshot looked for FINAL_HEAD / fhv-artifact-identity.v1.json. All four names mismatched,
 * so every published full-corpus failure artifact lost its FINAL_HEAD / EXECUTED_SHA / BASE_SHA
 * binding and reported them as missing evidence (PR452 artifact 8937404026).
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const NAMES_SCRIPT = join(process.cwd(), "scripts/ops/_fhv-artifact-identity-names.sh");
const RECORD_SCRIPT = join(process.cwd(), "scripts/ops/record-fhv-artifact-identity.sh");
const SNAPSHOT_SCRIPT = join(
  process.cwd(),
  "scripts/ops/snapshot-fhv-full-corpus-failure-evidence.sh",
);

type IdentityNames = Record<string, string>;

function readCanonicalNames(): IdentityNames {
  const out = execFileSync(
    "bash",
    [
      "-c",
      `source ${JSON.stringify(NAMES_SCRIPT)} && ` +
        "printf '%s\\n%s\\n%s\\n%s\\n' " +
        '"$FHV_IDENTITY_FINAL_HEAD_FILE" "$FHV_IDENTITY_EXECUTED_SHA_FILE" ' +
        '"$FHV_IDENTITY_BASE_SHA_FILE" "$FHV_IDENTITY_MANIFEST_FILE"',
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  return {
    finalHead: out[0]!,
    executedSha: out[1]!,
    baseSha: out[2]!,
    manifest: out[3]!,
  };
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(root);
  return root;
}

function seedRunDir(artifactRoot: string): string {
  const runDir = join(
    artifactRoot,
    "RI-P7",
    "fhv-full-historical",
    "fhv-official-scale-full-corpus",
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "fhv-launch-journal.v1.json"), '{"lastCommittedEpoch":1}\n');
  writeFileSync(join(runDir, "fhv-full-launch-result.v1.json"), "{}\n");
  writeFileSync(join(runDir, "fhv-full-launch-receipt.v1.json"), "{}\n");
  writeFileSync(join(runDir, "fhv-full-historical-progress.v1.json"), "{}\n");
  writeFileSync(join(runDir, "fhv-full-historical-progress.v1.jsonl"), "{}\n");
  writeFileSync(join(artifactRoot, "fhv-full-historical-progress.v1.json"), "{}\n");
  writeFileSync(join(artifactRoot, "fhv-full-historical-progress.v1.jsonl"), "{}\n");
  writeFileSync(join(artifactRoot, "fhv-official-scale-metrics.v1.json"), "{}\n");
  return runDir;
}

function runSnapshot(artifactRoot: string, stagingRoot: string): Record<string, unknown> {
  chmodSync(SNAPSHOT_SCRIPT, 0o755);
  execFileSync(
    "bash",
    [
      SNAPSHOT_SCRIPT,
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
  return JSON.parse(
    readFileSync(join(stagingRoot, "fhv-full-corpus-failure-evidence-manifest.v1.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("WP-2 FHV artifact identity contract", () => {
  it("the writer emits exactly the canonical names the reader expects", () => {
    const names = readCanonicalNames();
    const artifactRoot = makeRoot("fhv-identity-writer-");

    chmodSync(RECORD_SCRIPT, 0o755);
    execFileSync("bash", [RECORD_SCRIPT], {
      stdio: "pipe",
      env: {
        ...process.env,
        FHV_OFFICIAL_SCALE_ARTIFACT_ROOT: artifactRoot,
        GITHUB_EVENT_NAME: "push",
        PUSH_BEFORE_SHA: "b".repeat(40),
      },
    });

    for (const name of Object.values(names)) {
      expect(existsSync(join(artifactRoot, name))).toBe(true);
    }
    const identity = JSON.parse(readFileSync(join(artifactRoot, names.manifest!), "utf8")) as {
      schemaVersion: string;
      finalHead: string;
    };
    expect(identity.schemaVersion).toBe("fhv-artifact-identity/v1");
    expect(identity.finalHead).toMatch(/^[0-9a-f]{40}$/);
  });

  it("a complete run directory stages identity-bound evidence with zero missing entries", () => {
    const names = readCanonicalNames();
    const root = makeRoot("fhv-identity-snapshot-");
    const artifactRoot = join(root, "artifacts");
    const stagingRoot = join(root, "staging");
    mkdirSync(artifactRoot, { recursive: true });
    seedRunDir(artifactRoot);

    writeFileSync(join(artifactRoot, names.finalHead!), `${"a".repeat(40)}\n`);
    writeFileSync(join(artifactRoot, names.executedSha!), `${"b".repeat(40)}\n`);
    writeFileSync(join(artifactRoot, names.baseSha!), `${"c".repeat(40)}\n`);
    writeFileSync(
      join(artifactRoot, names.manifest!),
      '{"schemaVersion":"fhv-artifact-identity/v1"}\n',
    );

    const manifest = runSnapshot(artifactRoot, stagingRoot);
    expect(manifest.missingRequiredEvidenceCount).toBe(0);
    expect(manifest.identityBound).toBe(true);
    expect(manifest.passUpgraded).toBe(false);

    for (const name of Object.values(names)) {
      expect(existsSync(join(stagingRoot, name))).toBe(true);
    }
    expect(readFileSync(join(stagingRoot, names.finalHead!), "utf8").trim()).toBe("a".repeat(40));
  });

  it("pre-WP-2 extensionless identity files are still accepted", () => {
    const names = readCanonicalNames();
    const root = makeRoot("fhv-identity-legacy-");
    const artifactRoot = join(root, "artifacts");
    const stagingRoot = join(root, "staging");
    mkdirSync(artifactRoot, { recursive: true });
    seedRunDir(artifactRoot);

    writeFileSync(join(artifactRoot, "FINAL_HEAD"), `${"a".repeat(40)}\n`);
    writeFileSync(join(artifactRoot, "EXECUTED_SHA"), `${"b".repeat(40)}\n`);
    writeFileSync(join(artifactRoot, "BASE_SHA"), `${"c".repeat(40)}\n`);
    writeFileSync(join(artifactRoot, "fhv-artifact-identity.v1.json"), "{}\n");

    const manifest = runSnapshot(artifactRoot, stagingRoot);
    expect(manifest.missingRequiredEvidenceCount).toBe(0);
    expect(manifest.identityBound).toBe(true);
    expect(readFileSync(join(stagingRoot, names.baseSha!), "utf8").trim()).toBe("c".repeat(40));
  });

  it("absent identity remains fail-closed and is reported as missing_required", () => {
    const root = makeRoot("fhv-identity-absent-");
    const artifactRoot = join(root, "artifacts");
    const stagingRoot = join(root, "staging");
    mkdirSync(artifactRoot, { recursive: true });
    seedRunDir(artifactRoot);

    const manifest = runSnapshot(artifactRoot, stagingRoot);
    expect(manifest.missingRequiredEvidenceCount).toBe(4);
    expect(manifest.identityBound).toBe(false);

    const missing = readFileSync(join(stagingRoot, "missing-required-evidence.txt"), "utf8");
    expect(missing.split("\n").filter((line) => line.startsWith("missing_required:"))).toHaveLength(
      4,
    );
  });

  it("skipped checkpoint entries are counted separately from missing evidence", () => {
    const root = makeRoot("fhv-identity-skipped-");
    const artifactRoot = join(root, "artifacts");
    const stagingRoot = join(root, "staging");
    mkdirSync(artifactRoot, { recursive: true });
    const runDir = seedRunDir(artifactRoot);
    const names = readCanonicalNames();
    for (const [key, value] of Object.entries(names)) {
      writeFileSync(join(artifactRoot, value), key === "manifest" ? "{}\n" : `${"a".repeat(40)}\n`);
    }

    const checkpoints = join(runDir, "checkpoints");
    mkdirSync(join(checkpoints, "epoch-2"), { recursive: true });
    writeFileSync(join(checkpoints, "epoch-2", "checkpoint-manifest.v1.json"), "{}\n");
    mkdirSync(join(checkpoints, ".epoch-3.tmp-999-1"), { recursive: true });

    const manifest = runSnapshot(artifactRoot, stagingRoot);
    expect(manifest.missingRequiredEvidenceCount).toBe(0);
    expect(manifest.identityBound).toBe(true);
    expect(manifest.skippedEvidenceEntryCount).toBe(2);
  });
});
