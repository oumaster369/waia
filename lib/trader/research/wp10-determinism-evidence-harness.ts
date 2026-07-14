import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs";
import path from "node:path";

import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";

export type Wp10DefaultReplayResult = {
  metrics: unknown;
  decisionTraceDigest: string;
  reproDigest: string;
  cycleCount: number;
  closedTradeCount: number;
  orderIds: string[];
  fillIds: string[];
  fillExecutedAtIso: string[];
  featureSetIds: string[];
  strategySignalIds: string[];
};

export const HTR_WP10_DETERMINISM_MANIFEST_SCHEMA_VERSION = "htr_wp10_determinism_manifest_v1";
export const HTR_WP10_DETERMINISM_PROPERTY = "default-session-byte-identical-replay";
export const HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH =
  "replay-runs/RI-P7/htr-wp10-determinism-nolookahead";
export const HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST =
  "fa5def3786dd85fe790c5623c09d76f31b9b67c866409e8fa8ae1ad91274926b";
export const HTR_WP10_RECOMMENDED_POST_MACRO_D_RELATIVE_PATH =
  "replay-runs/RI-P7/htr-wp10-determinism-nolookahead-post-macro-d";
export const HTR_WP10_DETERMINISM_COMMAND = "pnpm trader:replay:wp10-evidence";
export const HTR_WP10_TRACKED_EVIDENCE_VAULT_PREFIX = "replay-runs/RI-P7/";
export const HTR_WP10_STAGING_MANIFEST_DIGEST_SCHEMA_VERSION =
  "htr_wp10_staging_manifest_digest_v1";

export type Wp10DeterminismManifest = {
  schemaVersion: typeof HTR_WP10_DETERMINISM_MANIFEST_SCHEMA_VERSION;
  property: typeof HTR_WP10_DETERMINISM_PROPERTY;
  runCount: 2;
  cycleCount: number;
  decisionTraceDigest: string;
  reproDigest: string;
  artifactDigest: string;
};

export type Wp10DeterminismProvenance = {
  schemaVersion: "htr_wp10_determinism_provenance_v1";
  gitSha: string;
  dirtyTree: boolean;
  harnessSourcePath: string;
  harnessSourceSha256: string;
  historicalSealPath: string;
  historicalAcceptedArtifactDigest: string;
  historicalBinding: "WP10_ERA_ACCEPTED_SEAL";
  candidateBinding: "POST_MACRO_D_CODE_AT_EXACT_WORK_SHA";
  candidateStatus: "POST_MACRO_D_WP10_COMPATIBILITY_CANDIDATE_NOT_ACCEPTED";
  candidateSemanticDigests: {
    decisionTraceDigest: string;
    reproDigest: string;
    artifactDigest: string;
  };
  reproductionCommand: string;
};

type FsIdentity = { dev: number; ino: number };

export function resolveHistoricalWp10EvidenceDir(cwd = process.cwd()): string {
  return path.join(cwd, HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH);
}

export function resolveTrackedEvidenceVaultDir(cwd = process.cwd()): string {
  return path.join(cwd, HTR_WP10_TRACKED_EVIDENCE_VAULT_PREFIX);
}

export function parseWp10EvidenceOutputDir(argv: readonly string[]): string | undefined {
  const outIndex = argv.indexOf("--output-dir");
  return outIndex >= 0 ? argv[outIndex + 1] : undefined;
}

export function computeWp10ArtifactDigest(input: {
  decisionTraceDigest: string;
  reproDigest: string;
  orderIds: readonly string[];
  fillIds: readonly string[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        decisionTraceDigest: input.decisionTraceDigest,
        reproDigest: input.reproDigest,
        orderIds: input.orderIds,
        fillIds: input.fillIds,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildWp10DeterminismManifest(
  replay: Pick<
    Wp10DefaultReplayResult,
    "cycleCount" | "decisionTraceDigest" | "reproDigest" | "orderIds" | "fillIds"
  >,
): Wp10DeterminismManifest {
  return {
    schemaVersion: HTR_WP10_DETERMINISM_MANIFEST_SCHEMA_VERSION,
    property: HTR_WP10_DETERMINISM_PROPERTY,
    runCount: 2,
    cycleCount: replay.cycleCount,
    decisionTraceDigest: replay.decisionTraceDigest,
    reproDigest: replay.reproDigest,
    artifactDigest: computeWp10ArtifactDigest({
      decisionTraceDigest: replay.decisionTraceDigest,
      reproDigest: replay.reproDigest,
      orderIds: replay.orderIds,
      fillIds: replay.fillIds,
    }),
  };
}

export function verifyManifestArtifactDigest(
  manifest: Wp10DeterminismManifest,
  replay: Pick<Wp10DefaultReplayResult, "orderIds" | "fillIds">,
): boolean {
  return (
    manifest.artifactDigest ===
    computeWp10ArtifactDigest({
      decisionTraceDigest: manifest.decisionTraceDigest,
      reproDigest: manifest.reproDigest,
      orderIds: replay.orderIds,
      fillIds: replay.fillIds,
    })
  );
}

export function readHistoricalWp10Manifest(cwd = process.cwd()): Wp10DeterminismManifest {
  const manifestPath = path.join(resolveHistoricalWp10EvidenceDir(cwd), "manifest.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Wp10DeterminismManifest;
}

export function readHistoricalWp10Readme(cwd = process.cwd()): string {
  const readmePath = path.join(resolveHistoricalWp10EvidenceDir(cwd), "README.md");
  return fs.readFileSync(readmePath, "utf8");
}

function caseFoldAbsolute(absolutePath: string): string {
  return path.normalize(path.resolve(absolutePath)).toLowerCase();
}

function isPathEqualOrInside(childReal: string, parentReal: string): boolean {
  if (childReal === parentReal) {
    return true;
  }
  const rel = path.relative(parentReal, childReal);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isCaseFoldedPathEqualOrInside(childFolded: string, parentFolded: string): boolean {
  if (childFolded === parentFolded) {
    return true;
  }
  const parentWithSep = parentFolded.endsWith(path.sep)
    ? parentFolded
    : `${parentFolded}${path.sep}`;
  return childFolded.startsWith(parentWithSep);
}

function realpathNative(absolutePath: string): string {
  return fs.realpathSync.native(absolutePath);
}

function getFsIdentity(absolutePath: string): FsIdentity {
  const st = fs.statSync(absolutePath);
  return { dev: st.dev, ino: st.ino };
}

function getLstatIdentity(absolutePath: string): FsIdentity {
  const st = fs.lstatSync(absolutePath);
  return { dev: st.dev, ino: st.ino };
}

function identitiesEqual(left: FsIdentity, right: FsIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function resolveAncestorRealPaths(absolutePath: string): string[] {
  const chain: string[] = [];
  let current = realpathNative(absolutePath);
  const root = path.parse(current).root;
  while (true) {
    chain.push(current);
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }
  return chain;
}

function sharesIdentityWithProtectedPath(absolutePath: string, protectedRealPath: string): boolean {
  const protectedIdentity = getFsIdentity(protectedRealPath);
  for (const ancestor of resolveAncestorRealPaths(absolutePath)) {
    if (identitiesEqual(getLstatIdentity(ancestor), protectedIdentity)) {
      return true;
    }
    if (identitiesEqual(getFsIdentity(ancestor), protectedIdentity)) {
      return true;
    }
  }
  return false;
}

function resolveProtectedRealPaths(cwd: string): {
  historicalReal: string;
  vaultReal: string;
} {
  return {
    historicalReal: realpathNative(resolveHistoricalWp10EvidenceDir(cwd)),
    vaultReal: realpathNative(resolveTrackedEvidenceVaultDir(cwd)),
  };
}

function assertLexicalOutputDirAllowed(resolvedOutput: string, cwd: string): void {
  const historical = resolveHistoricalWp10EvidenceDir(cwd);
  const vaultRoot = resolveTrackedEvidenceVaultDir(cwd);
  const foldedOutput = caseFoldAbsolute(resolvedOutput);
  const foldedHistorical = caseFoldAbsolute(historical);
  const foldedVault = caseFoldAbsolute(vaultRoot);

  if (isCaseFoldedPathEqualOrInside(foldedOutput, foldedHistorical)) {
    throw new Error("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
  }

  if (isCaseFoldedPathEqualOrInside(foldedOutput, foldedVault)) {
    throw new Error("WP10_WRITER_CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT");
  }
}

function assertRealOutputDirAllowed(resolvedOutput: string, cwd: string): void {
  const outputReal = realpathNative(resolvedOutput);
  const { historicalReal, vaultReal } = resolveProtectedRealPaths(cwd);

  if (isPathEqualOrInside(outputReal, vaultReal)) {
    throw new Error("WP10_WRITER_CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT");
  }

  if (isPathEqualOrInside(outputReal, historicalReal)) {
    throw new Error("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
  }

  if (sharesIdentityWithProtectedPath(resolvedOutput, historicalReal)) {
    throw new Error("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
  }

  if (sharesIdentityWithProtectedPath(resolvedOutput, vaultReal)) {
    throw new Error("WP10_WRITER_CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT");
  }
}

export function assertWp10WriterOutputDirAllowed(outputDir: string, cwd = process.cwd()): void {
  if (!outputDir || outputDir.trim().length === 0) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_REQUIRED");
  }

  const resolvedOutput = path.resolve(
    path.isAbsolute(outputDir) ? outputDir : path.join(cwd, outputDir),
  );

  assertLexicalOutputDirAllowed(resolvedOutput, cwd);

  if (!fs.existsSync(resolvedOutput)) {
    return;
  }

  const leafStat = fs.lstatSync(resolvedOutput);
  if (leafStat.isSymbolicLink()) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_LEAF_IS_SYMLINK");
  }

  if (!leafStat.isDirectory()) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_NOT_DIRECTORY");
  }

  assertRealOutputDirAllowed(resolvedOutput, cwd);
}

function assertOutputFilesAbsent(resolvedOutputDir: string): void {
  for (const fileName of ["manifest.json", "README.md", "provenance.json"]) {
    const filePath = path.join(resolvedOutputDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error("WP10_WRITER_OUTPUT_FILE_SYMLINK");
    }
    throw new Error("WP10_WRITER_OUTPUT_DIR_NON_EMPTY");
  }

  if (fs.readdirSync(resolvedOutputDir).length > 0) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_NON_EMPTY");
  }
}

function assertDestinationWritableState(resolvedOutputDir: string, cwd: string): void {
  if (!fs.existsSync(resolvedOutputDir)) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_MISSING");
  }

  const leafStat = fs.lstatSync(resolvedOutputDir);
  if (leafStat.isSymbolicLink()) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_LEAF_IS_SYMLINK");
  }

  if (!leafStat.isDirectory()) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_NOT_DIRECTORY");
  }

  assertWp10WriterOutputDirAllowed(resolvedOutputDir, cwd);
}

function assertInitialEmptyDestination(resolvedOutputDir: string, cwd: string): void {
  assertDestinationWritableState(resolvedOutputDir, cwd);
  assertOutputFilesAbsent(resolvedOutputDir);
}

function writeFileExclusive(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    const leafStat = fs.lstatSync(filePath);
    if (leafStat.isSymbolicLink()) {
      throw new Error("WP10_WRITER_OUTPUT_FILE_SYMLINK");
    }
    throw new Error("WP10_WRITER_OUTPUT_FILE_EXISTS");
  }

  const fd = fs.openSync(filePath, "wx");
  try {
    fs.writeFileSync(fd, content, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function buildWp10DeterminismReadme(manifest: Wp10DeterminismManifest): string {
  return `# HTR-WP10 determinism + no-lookahead qualification

Evidence for deterministic default replay session (HTR-WP10).

## Reproduce

\`\`\`bash
${HTR_WP10_DETERMINISM_COMMAND} -- --output-dir <explicit-output-dir>
\`\`\`

## Manifest digest

\`${manifest.artifactDigest}\`
`;
}

export function buildWp10DeterminismProvenance(input: {
  manifest: Wp10DeterminismManifest;
  harnessSourcePath: string;
  harnessSourceSha256: string;
}): Wp10DeterminismProvenance {
  return {
    schemaVersion: "htr_wp10_determinism_provenance_v1",
    gitSha: readGitCodeSha(),
    dirtyTree: readGitDirtyTree(),
    harnessSourcePath: input.harnessSourcePath,
    harnessSourceSha256: input.harnessSourceSha256,
    historicalSealPath: HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH,
    historicalAcceptedArtifactDigest: HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST,
    historicalBinding: "WP10_ERA_ACCEPTED_SEAL",
    candidateBinding: "POST_MACRO_D_CODE_AT_EXACT_WORK_SHA",
    candidateStatus: "POST_MACRO_D_WP10_COMPATIBILITY_CANDIDATE_NOT_ACCEPTED",
    candidateSemanticDigests: {
      decisionTraceDigest: input.manifest.decisionTraceDigest,
      reproDigest: input.manifest.reproDigest,
      artifactDigest: input.manifest.artifactDigest,
    },
    reproductionCommand: HTR_WP10_DETERMINISM_COMMAND,
  };
}

export type WriteWp10DeterminismEvidenceInput = {
  outputDir: string;
  manifest: Wp10DeterminismManifest;
  provenance: Wp10DeterminismProvenance;
  cwd?: string;
};

export function writeWp10DeterminismEvidence(input: WriteWp10DeterminismEvidenceInput): {
  outputDir: string;
  manifestPath: string;
  readmePath: string;
  provenancePath: string;
} {
  const cwd = input.cwd ?? process.cwd();

  if (input.provenance.dirtyTree) {
    throw new Error("WP10_WRITER_REFUSES_DIRTY_TREE_CANDIDATE_SEAL");
  }

  const resolvedOutputDir = path.resolve(
    path.isAbsolute(input.outputDir) ? input.outputDir : path.join(cwd, input.outputDir),
  );

  assertInitialEmptyDestination(resolvedOutputDir, cwd);

  const manifestPath = path.join(resolvedOutputDir, "manifest.json");
  const readmePath = path.join(resolvedOutputDir, "README.md");
  const provenancePath = path.join(resolvedOutputDir, "provenance.json");

  const outputs = [
    { path: manifestPath, content: `${JSON.stringify(input.manifest, null, 2)}\n` },
    { path: readmePath, content: buildWp10DeterminismReadme(input.manifest) },
    { path: provenancePath, content: `${JSON.stringify(input.provenance, null, 2)}\n` },
  ];

  for (const output of outputs) {
    assertDestinationWritableState(resolvedOutputDir, cwd);
    writeFileExclusive(output.path, output.content);
  }

  return {
    outputDir: resolvedOutputDir,
    manifestPath,
    readmePath,
    provenancePath,
  };
}

export function buildWp10StagingManifestDigestEntries(
  filePaths: readonly string[],
): Array<{ path: string; sha256: string }> {
  return filePaths
    .map((filePath) => ({
      path: path.basename(path.normalize(filePath)),
      sha256: createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function computeWp10StagingManifestDigest(filePaths: readonly string[]): string {
  const entries = buildWp10StagingManifestDigestEntries(filePaths);
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: HTR_WP10_STAGING_MANIFEST_DIGEST_SCHEMA_VERSION,
        entries,
      }),
      "utf8",
    )
    .digest("hex");
}
