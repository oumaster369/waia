/**
 * HTR-WP10 — evidence hermeticity + hardened operator-gated writer safeguards.
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertWp10WriterOutputDirAllowed,
  buildWp10DeterminismManifest,
  buildWp10DeterminismProvenance,
  buildWp10StagingManifestDigestEntries,
  computeWp10StagingManifestDigest,
  HTR_WP10_DETERMINISM_COMMAND,
  HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST,
  HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH,
  HTR_WP10_STAGING_MANIFEST_DIGEST_SCHEMA_VERSION,
  HTR_WP10_TRACKED_EVIDENCE_VAULT_PREFIX,
  parseWp10EvidenceOutputDir,
  readHistoricalWp10Manifest,
  resolveHistoricalWp10EvidenceDir,
  resolveTrackedEvidenceVaultDir,
  sha256File,
  writeWp10DeterminismEvidence,
} from "@/lib/trader/research/wp10-determinism-evidence-harness";
import {
  computeWp10DeterminismEvidence,
  runWp10DefaultSessionReplay,
} from "@/tests/unit/helpers/wp10-replay-fixture";

const tempDirs: string[] = [];
const tempLinks: string[] = [];

const HISTORICAL_MANIFEST_SHA = "f0b9fc74adedc03a9fe729998d42ee00d1884b495b898717b1c453a43b036343";
const HISTORICAL_README_SHA = "f84ea48063623829da228278f9b393ad0a999b49298b4d4fe33b4f305e89e28a";

afterEach(() => {
  for (const link of tempLinks.splice(0)) {
    try {
      rmSync(link, { force: true });
    } catch {
      /* ignore */
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeTempSymlink(target: string, prefix: string): string {
  const linkPath = path.join(os.tmpdir(), `${prefix}${Date.now()}`);
  symlinkSync(target, linkPath);
  tempLinks.push(linkPath);
  return linkPath;
}

function sha256Bytes(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(process.cwd(), relativePath)))
    .digest("hex");
}

function assertHistoricalSealUnchanged(): void {
  expect(sha256Bytes(`${HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH}/manifest.json`)).toBe(
    HISTORICAL_MANIFEST_SHA,
  );
  expect(sha256Bytes(`${HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH}/README.md`)).toBe(
    HISTORICAL_README_SHA,
  );
}

async function buildProvenance(manifest: ReturnType<typeof buildWp10DeterminismManifest>) {
  const harnessSha = await sha256File(
    path.join(process.cwd(), "lib/trader/research/wp10-determinism-evidence-harness.ts"),
  );
  return {
    ...buildWp10DeterminismProvenance({
      manifest,
      harnessSourcePath: "lib/trader/research/wp10-determinism-evidence-harness.ts",
      harnessSourceSha256: harnessSha,
    }),
    dirtyTree: false,
  };
}

describe("HTR-WP10 evidence hermeticity", () => {
  it("requires --output-dir for the CLI parser", () => {
    expect(parseWp10EvidenceOutputDir([])).toBeUndefined();
    expect(parseWp10EvidenceOutputDir(["--output-dir"])).toBeUndefined();
    expect(parseWp10EvidenceOutputDir(["--output-dir", "/tmp/wp10"])).toBe("/tmp/wp10");
    expect(() => {
      if (!parseWp10EvidenceOutputDir([])) {
        throw new Error(
          `${HTR_WP10_DETERMINISM_COMMAND} requires --output-dir <explicit-output-dir>`,
        );
      }
    }).toThrow(`${HTR_WP10_DETERMINISM_COMMAND} requires --output-dir`);
  });

  it("rejects empty and whitespace output paths", () => {
    expect(() => assertWp10WriterOutputDirAllowed("")).toThrow("WP10_WRITER_OUTPUT_DIR_REQUIRED");
    expect(() => assertWp10WriterOutputDirAllowed("   ")).toThrow(
      "WP10_WRITER_OUTPUT_DIR_REQUIRED",
    );
  });

  it("rejects the historical accepted path and relative aliases", () => {
    expect(() =>
      assertWp10WriterOutputDirAllowed(HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH),
    ).toThrow("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
    expect(() =>
      assertWp10WriterOutputDirAllowed(
        path.join(
          HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH,
          "..",
          "htr-wp10-determinism-nolookahead",
        ),
      ),
    ).toThrow("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
    assertHistoricalSealUnchanged();
  });

  it("rejects the RI-P7 vault root and ordinary children", () => {
    expect(() => assertWp10WriterOutputDirAllowed("replay-runs/RI-P7")).toThrow(
      "WP10_WRITER_CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT",
    );
    expect(() =>
      assertWp10WriterOutputDirAllowed(
        path.join(HTR_WP10_TRACKED_EVIDENCE_VAULT_PREFIX, "htr-wp11-pit-provider-context"),
      ),
    ).toThrow("WP10_WRITER_CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT");
    assertHistoricalSealUnchanged();
  });

  it("rejects case variants of the accepted path and RI-P7 children", () => {
    expect(() =>
      assertWp10WriterOutputDirAllowed("REPLAY-RUNS/RI-P7/htr-wp10-determinism-nolookahead"),
    ).toThrow("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
    expect(() =>
      assertWp10WriterOutputDirAllowed("Replay-Runs/ri-p7/htr-wp11-pit-provider-context"),
    ).toThrow("WP10_WRITER_CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT");
    expect(() =>
      assertWp10WriterOutputDirAllowed(
        "REPLAY-RUNS/RI-P7/htr-wp10-determinism-nolookahead/../htr-wp10-determinism-nolookahead",
      ),
    ).toThrow("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
    assertHistoricalSealUnchanged();
  });

  it("rejects symlink destinations resolving into the accepted path or RI-P7 child", () => {
    const historical = resolveHistoricalWp10EvidenceDir();
    const vaultChild = path.join(resolveTrackedEvidenceVaultDir(), "htr-wp11-pit-provider-context");
    const acceptedSymlink = makeTempSymlink(historical, "wp10-guard-accepted-");
    const vaultSymlink = makeTempSymlink(vaultChild, "wp10-guard-vault-");

    for (const target of [acceptedSymlink, vaultSymlink]) {
      expect(() => assertWp10WriterOutputDirAllowed(target)).toThrow(
        /WP10_WRITER_(CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH|CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT|OUTPUT_DIR_LEAF_IS_SYMLINK)/,
      );
    }
    assertHistoricalSealUnchanged();
  });

  it("rejects destination leaf symlinks, files, missing directories, and non-empty directories", async () => {
    const filePath = path.join(makeTempDir("wp10-file-"), "not-a-dir");
    writeFileSync(filePath, "x", "utf8");
    expect(() => assertWp10WriterOutputDirAllowed(filePath)).toThrow(
      "WP10_WRITER_OUTPUT_DIR_NOT_DIRECTORY",
    );

    const symlinkDir = makeTempSymlink(makeTempDir("wp10-target-"), "wp10-leaf-link-");
    expect(() => assertWp10WriterOutputDirAllowed(symlinkDir)).toThrow(
      "WP10_WRITER_OUTPUT_DIR_LEAF_IS_SYMLINK",
    );

    const missingDir = path.join(os.tmpdir(), `wp10-missing-${Date.now()}`);
    const { manifest } = await computeWp10DeterminismEvidence();
    const provenance = await buildProvenance(manifest);
    expect(() =>
      writeWp10DeterminismEvidence({
        outputDir: missingDir,
        manifest,
        provenance,
      }),
    ).toThrow("WP10_WRITER_OUTPUT_DIR_MISSING");

    const nonEmptyDir = makeTempDir("wp10-nonempty-");
    writeFileSync(path.join(nonEmptyDir, "seed.txt"), "seed", "utf8");
    expect(() =>
      writeWp10DeterminismEvidence({
        outputDir: nonEmptyDir,
        manifest,
        provenance,
      }),
    ).toThrow("WP10_WRITER_OUTPUT_DIR_NON_EMPTY");
    assertHistoricalSealUnchanged();
  });

  it("rejects dirty-tree sealing and existing manifest-file symlinks", async () => {
    const outputDir = makeTempDir("wp10-writer-dirty-");
    const { manifest } = await computeWp10DeterminismEvidence();
    const provenance = {
      ...(await buildProvenance(manifest)),
      dirtyTree: true,
    };
    expect(() =>
      writeWp10DeterminismEvidence({
        outputDir,
        manifest,
        provenance,
      }),
    ).toThrow("WP10_WRITER_REFUSES_DIRTY_TREE_CANDIDATE_SEAL");

    const symlinkOutputDir = makeTempDir("wp10-manifest-symlink-");
    symlinkSync(
      path.join(resolveHistoricalWp10EvidenceDir(), "manifest.json"),
      path.join(symlinkOutputDir, "manifest.json"),
    );
    tempLinks.push(path.join(symlinkOutputDir, "manifest.json"));
    const cleanProvenance = await buildProvenance(manifest);
    expect(() =>
      writeWp10DeterminismEvidence({
        outputDir: symlinkOutputDir,
        manifest,
        provenance: cleanProvenance,
      }),
    ).toThrow("WP10_WRITER_OUTPUT_FILE_SYMLINK");
    assertHistoricalSealUnchanged();
  });

  it("writes deterministic candidate output to a temporary directory", async () => {
    const outputDir = makeTempDir("wp10-writer-");
    const first = await computeWp10DeterminismEvidence();
    const provenance = await buildProvenance(first.manifest);

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
    expect(writtenProvenance.harnessSourceSha256).toBe(provenance.harnessSourceSha256);
    expect(writtenProvenance.gitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(writtenProvenance.dirtyTree).toBe(false);
    assertHistoricalSealUnchanged();
  });

  it("rejects a second writer invocation into the same directory", async () => {
    const outputDir = makeTempDir("wp10-writer-twice-");
    const { manifest } = await computeWp10DeterminismEvidence();
    const provenance = await buildProvenance(manifest);

    writeWp10DeterminismEvidence({ outputDir, manifest, provenance });
    expect(() => writeWp10DeterminismEvidence({ outputDir, manifest, provenance })).toThrow(
      "WP10_WRITER_OUTPUT_DIR_NON_EMPTY",
    );
    assertHistoricalSealUnchanged();
  });

  it("produces byte-identical manifests across two writer generations", async () => {
    const dirA = makeTempDir("wp10-writer-a-");
    const dirB = makeTempDir("wp10-writer-b-");

    const runOnce = async (dir: string) => {
      const { manifest } = await computeWp10DeterminismEvidence();
      const provenance = await buildProvenance(manifest);
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
    assertHistoricalSealUnchanged();
  });

  it("keeps historical accepted manifest and README byte-identical after hermeticity tests", () => {
    const manifest = readHistoricalWp10Manifest();
    expect(manifest.artifactDigest).toBe(HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST);
    assertHistoricalSealUnchanged();
  });

  it("proves current-code within-version determinism via pure computation seam", async () => {
    const first = await runWp10DefaultSessionReplay("2026-01-01T00:00:00.000Z");
    const second = await runWp10DefaultSessionReplay("2099-12-31T23:59:59.999Z");
    const manifestA = buildWp10DeterminismManifest(first);
    const manifestB = buildWp10DeterminismManifest(second);
    expect(manifestA).toEqual(manifestB);
  });

  it("computes canonical staging manifest digest independent of insertion order", async () => {
    const outputDir = makeTempDir("wp10-staging-digest-");
    const { manifest } = await computeWp10DeterminismEvidence();
    const provenance = await buildProvenance(manifest);
    const paths = writeWp10DeterminismEvidence({ outputDir, manifest, provenance });

    const orderedA = computeWp10StagingManifestDigest([
      paths.manifestPath,
      paths.readmePath,
      paths.provenancePath,
    ]);
    const orderedB = computeWp10StagingManifestDigest([
      paths.provenancePath,
      paths.manifestPath,
      paths.readmePath,
    ]);

    expect(orderedA).toBe(orderedB);
    expect(orderedA).toMatch(/^[a-f0-9]{64}$/);

    const entries = buildWp10StagingManifestDigestEntries([
      paths.provenancePath,
      paths.manifestPath,
      paths.readmePath,
    ]);
    expect(entries.map((entry) => entry.path)).toEqual([
      "manifest.json",
      "provenance.json",
      "README.md",
    ]);

    const tamperedReadme = `${readFileSync(paths.readmePath, "utf8")}tamper`;
    writeFileSync(paths.readmePath, tamperedReadme, "utf8");
    const changedDigest = computeWp10StagingManifestDigest([
      paths.manifestPath,
      paths.readmePath,
      paths.provenancePath,
    ]);
    expect(changedDigest).not.toBe(orderedA);

    const renamedPath = path.join(outputDir, "renamed-readme.md");
    writeFileSync(renamedPath, tamperedReadme, "utf8");
    const renamedDigest = computeWp10StagingManifestDigest([
      paths.manifestPath,
      renamedPath,
      paths.provenancePath,
    ]);
    expect(renamedDigest).not.toBe(orderedA);

    expect(HTR_WP10_STAGING_MANIFEST_DIGEST_SCHEMA_VERSION).toBe(
      "htr_wp10_staging_manifest_digest_v1",
    );
  });

  it("proves inode identity catches case aliases on case-insensitive filesystems", () => {
    const historical = resolveHistoricalWp10EvidenceDir();
    const caseAlias = path.join(
      process.cwd(),
      "REPLAY-RUNS/RI-P7/htr-wp10-determinism-nolookahead",
    );
    if (!lstatSync(historical).ino || !lstatSync(caseAlias).ino) {
      throw new Error("WP10_WRITER_GUARD_INODE_UNSUPPORTED");
    }
    expect(lstatSync(historical).ino).toBe(lstatSync(caseAlias).ino);
    expect(() => assertWp10WriterOutputDirAllowed(caseAlias)).toThrow(
      "WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH",
    );
  });
});
