/**
 * HTR-WP10 — evidence hermeticity + operator-gated writer safeguards.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertWp10WriterOutputDirAllowed,
  buildWp10DeterminismManifest,
  buildWp10DeterminismProvenance,
  computeWp10StagingManifestDigest,
  HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST,
  HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH,
  HTR_WP10_TRACKED_EVIDENCE_VAULT_PREFIX,
  readHistoricalWp10Manifest,
  sha256File,
  writeWp10DeterminismEvidence,
} from "@/lib/trader/research/wp10-determinism-evidence-harness";
import {
  computeWp10DeterminismEvidence,
  runWp10DefaultSessionReplay,
} from "@/tests/unit/helpers/wp10-replay-fixture";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sha256Bytes(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(process.cwd(), relativePath)))
    .digest("hex");
}

describe("HTR-WP10 evidence hermeticity", () => {
  it("rejects writer output targeting the historical accepted path", () => {
    expect(() =>
      assertWp10WriterOutputDirAllowed(HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH),
    ).toThrow("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
  });

  it("rejects writer output targeting any tracked RI-P7 evidence vault", () => {
    expect(() =>
      assertWp10WriterOutputDirAllowed(
        path.join(HTR_WP10_TRACKED_EVIDENCE_VAULT_PREFIX, "htr-wp11-pit-provider-context"),
      ),
    ).toThrow("WP10_WRITER_CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT");
  });

  it("requires an explicit output directory for the writer", () => {
    expect(() => assertWp10WriterOutputDirAllowed("")).toThrow("WP10_WRITER_OUTPUT_DIR_REQUIRED");
  });

  it("fails when the output directory does not exist", async () => {
    const missingDir = path.join(os.tmpdir(), `wp10-missing-${Date.now()}`);
    const { manifest } = await computeWp10DeterminismEvidence();
    const provenance = {
      ...buildWp10DeterminismProvenance({
        manifest,
        harnessSourcePath: "lib/trader/research/wp10-determinism-evidence-harness.ts",
        harnessSourceSha256: "abc",
      }),
      dirtyTree: false,
    };
    expect(() =>
      writeWp10DeterminismEvidence({
        outputDir: missingDir,
        manifest,
        provenance,
      }),
    ).toThrow("WP10_WRITER_OUTPUT_DIR_MISSING");
  });

  it("refuses dirty-tree candidate sealing", async () => {
    const outputDir = makeTempDir("wp10-writer-dirty-");
    const { manifest } = await computeWp10DeterminismEvidence();
    const provenance = {
      ...buildWp10DeterminismProvenance({
        manifest,
        harnessSourcePath: "lib/trader/research/wp10-determinism-evidence-harness.ts",
        harnessSourceSha256: "abc",
      }),
      dirtyTree: true,
    };
    expect(() =>
      writeWp10DeterminismEvidence({
        outputDir,
        manifest,
        provenance,
      }),
    ).toThrow("WP10_WRITER_REFUSES_DIRTY_TREE_CANDIDATE_SEAL");
  });

  it("writes deterministic candidate output to a temporary directory", async () => {
    const outputDir = makeTempDir("wp10-writer-");
    const first = await computeWp10DeterminismEvidence();
    const harnessSha = await sha256File(
      path.join(process.cwd(), "lib/trader/research/wp10-determinism-evidence-harness.ts"),
    );
    const provenance = {
      ...buildWp10DeterminismProvenance({
        manifest: first.manifest,
        harnessSourcePath: "lib/trader/research/wp10-determinism-evidence-harness.ts",
        harnessSourceSha256: harnessSha,
      }),
      dirtyTree: false,
    };

    const paths = writeWp10DeterminismEvidence({
      outputDir,
      manifest: first.manifest,
      provenance,
    });

    const writtenManifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
    expect(writtenManifest.artifactDigest).toBe(first.manifest.artifactDigest);
    expect(writtenManifest.decisionTraceDigest).toBe(first.manifest.decisionTraceDigest);
    expect(writtenManifest.reproDigest).toBe(first.manifest.reproDigest);

    const writtenProvenance = JSON.parse(readFileSync(paths.provenancePath, "utf8"));
    expect(writtenProvenance.candidateStatus).toBe(
      "POST_MACRO_D_WP10_COMPATIBILITY_CANDIDATE_NOT_ACCEPTED",
    );
    expect(writtenProvenance.historicalAcceptedArtifactDigest).toBe(
      HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST,
    );
    expect(writtenProvenance.harnessSourceSha256).toBe(harnessSha);
    expect(writtenProvenance.gitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(writtenProvenance.dirtyTree).toBe(false);
  });

  it("produces byte-identical manifests across two writer generations", async () => {
    const dirA = makeTempDir("wp10-writer-a-");
    const dirB = makeTempDir("wp10-writer-b-");
    const harnessSha = await sha256File(
      path.join(process.cwd(), "lib/trader/research/wp10-determinism-evidence-harness.ts"),
    );

    const runOnce = async (dir: string) => {
      const { manifest } = await computeWp10DeterminismEvidence();
      const provenance = {
        ...buildWp10DeterminismProvenance({
          manifest,
          harnessSourcePath: "lib/trader/research/wp10-determinism-evidence-harness.ts",
          harnessSourceSha256: harnessSha,
        }),
        dirtyTree: false,
      };
      return writeWp10DeterminismEvidence({ outputDir: dir, manifest, provenance });
    };

    const pathsA = await runOnce(dirA);
    const pathsB = await runOnce(dirB);

    expect(readFileSync(pathsA.manifestPath, "utf8")).toBe(
      readFileSync(pathsB.manifestPath, "utf8"),
    );
    expect(readFileSync(pathsA.provenancePath, "utf8")).toBe(
      readFileSync(pathsB.provenancePath, "utf8"),
    );
  });

  it("keeps historical accepted manifest and README byte-identical after hermeticity tests", () => {
    const manifestSha = sha256Bytes(`${HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH}/manifest.json`);
    const readmeSha = sha256Bytes(`${HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH}/README.md`);
    const manifest = readHistoricalWp10Manifest();
    expect(manifest.artifactDigest).toBe(HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST);
    expect(manifestSha).toBe("f0b9fc74adedc03a9fe729998d42ee00d1884b495b898717b1c453a43b036343");
    expect(readmeSha).toBe("f84ea48063623829da228278f9b393ad0a999b49298b4d4fe33b4f305e89e28a");
  });

  it("proves current-code within-version determinism via pure computation seam", async () => {
    const first = await runWp10DefaultSessionReplay("2026-01-01T00:00:00.000Z");
    const second = await runWp10DefaultSessionReplay("2099-12-31T23:59:59.999Z");
    const manifestA = buildWp10DeterminismManifest(first);
    const manifestB = buildWp10DeterminismManifest(second);
    expect(manifestA).toEqual(manifestB);
  });

  it("computes staging manifest digest over candidate files", async () => {
    const outputDir = makeTempDir("wp10-staging-digest-");
    const { manifest } = await computeWp10DeterminismEvidence();
    const provenance = {
      ...buildWp10DeterminismProvenance({
        manifest,
        harnessSourcePath: "lib/trader/research/wp10-determinism-evidence-harness.ts",
        harnessSourceSha256: "abc",
      }),
      dirtyTree: false,
    };
    const paths = writeWp10DeterminismEvidence({ outputDir, manifest, provenance });
    const digest = computeWp10StagingManifestDigest([
      paths.manifestPath,
      paths.readmePath,
      paths.provenancePath,
    ]);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
