import { spawn } from "node:child_process";
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
export const HTR_WP10_CANDIDATE_STAGING_MANIFEST_SCHEMA_VERSION =
  "htr_wp10_candidate_staging_manifest_v1";
export const HTR_WP10_CANDIDATE_COMPLETION_SCHEMA_VERSION = "htr_wp10_candidate_completion_v1";
export const HTR_WP10_WRITER_CHILD_INPUT_SCHEMA_VERSION = "htr_wp10_writer_child_input_v1";
export const HTR_WP10_CANDIDATE_REQUIRED_FILES = [
  "manifest.json",
  "README.md",
  "provenance.json",
  "staging-manifest.json",
  "completion.json",
] as const;
export const WP10_WRITER_CHILD_SCRIPT = path.join(
  process.cwd(),
  "scripts/trader/wp10-evidence-writer-child.ts",
);
const WP10_WRITER_TSX_BINARY = path.join(process.cwd(), "node_modules", ".bin", "tsx");

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
  for (const fileName of HTR_WP10_CANDIDATE_REQUIRED_FILES) {
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

function compareCodePointPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function computeWp10StagingManifestDigestFromContents(
  entries: readonly { path: string; content: string }[],
): string {
  const sorted = entries
    .map((entry) => ({
      path: entry.path,
      sha256: sha256Utf8(entry.content),
    }))
    .sort((left, right) => compareCodePointPaths(left.path, right.path));

  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: HTR_WP10_STAGING_MANIFEST_DIGEST_SCHEMA_VERSION,
        entries: sorted,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildWp10StagingManifestFile(input: {
  workCommitSha: string;
  harnessSourceSha256: string;
  manifestContent: string;
  readmeContent: string;
  provenanceContent: string;
}): { content: string; digest: string } {
  const digest = computeWp10StagingManifestDigestFromContents([
    { path: "manifest.json", content: input.manifestContent },
    { path: "README.md", content: input.readmeContent },
    { path: "provenance.json", content: input.provenanceContent },
  ]);

  const content = `${JSON.stringify(
    {
      schemaVersion: HTR_WP10_CANDIDATE_STAGING_MANIFEST_SCHEMA_VERSION,
      workCommitSha: input.workCommitSha,
      harnessSourceSha256: input.harnessSourceSha256,
      candidateStagingManifestDigest: digest,
      candidateStagingManifestDigestAlgorithm: HTR_WP10_STAGING_MANIFEST_DIGEST_SCHEMA_VERSION,
      files: [
        { path: "manifest.json", sha256: sha256Utf8(input.manifestContent) },
        { path: "README.md", sha256: sha256Utf8(input.readmeContent) },
        { path: "provenance.json", sha256: sha256Utf8(input.provenanceContent) },
      ],
    },
    null,
    2,
  )}\n`;

  return { content, digest };
}

export function buildWp10CandidateCompletionFile(input: {
  workCommitSha: string;
  stagingManifestDigest: string;
  fileDigests: Record<string, string>;
}): string {
  return `${JSON.stringify(
    {
      schemaVersion: HTR_WP10_CANDIDATE_COMPLETION_SCHEMA_VERSION,
      status: "COMPLETE_NOT_ACCEPTED",
      workCommitSha: input.workCommitSha,
      requiredFiles: [...HTR_WP10_CANDIDATE_REQUIRED_FILES],
      fileDigests: input.fileDigests,
      stagingManifestDigest: input.stagingManifestDigest,
    },
    null,
    2,
  )}\n`;
}

export function isWp10CandidateComplete(outputDir: string): boolean {
  for (const fileName of HTR_WP10_CANDIDATE_REQUIRED_FILES) {
    const filePath = path.join(outputDir, fileName);
    if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()) {
      return false;
    }
  }

  const completion = JSON.parse(
    fs.readFileSync(path.join(outputDir, "completion.json"), "utf8"),
  ) as {
    schemaVersion: string;
    status: string;
    requiredFiles: string[];
    fileDigests: Record<string, string>;
    stagingManifestDigest: string;
  };

  if (
    completion.schemaVersion !== HTR_WP10_CANDIDATE_COMPLETION_SCHEMA_VERSION ||
    completion.status !== "COMPLETE_NOT_ACCEPTED"
  ) {
    return false;
  }

  for (const fileName of HTR_WP10_CANDIDATE_REQUIRED_FILES) {
    if (fileName === "completion.json") {
      continue;
    }
    const expected = completion.fileDigests[fileName];
    if (!expected) {
      return false;
    }
    const actual = sha256Utf8(fs.readFileSync(path.join(outputDir, fileName), "utf8"));
    if (actual !== expected) {
      return false;
    }
  }

  const stagingDigest = computeWp10StagingManifestDigestFromContents([
    {
      path: "manifest.json",
      content: fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"),
    },
    {
      path: "README.md",
      content: fs.readFileSync(path.join(outputDir, "README.md"), "utf8"),
    },
    {
      path: "provenance.json",
      content: fs.readFileSync(path.join(outputDir, "provenance.json"), "utf8"),
    },
  ]);

  return stagingDigest === completion.stagingManifestDigest;
}

type SpawnWriterChildInput = {
  cwd: string;
  expectedIdentity: FsIdentity;
  workCommitSha: string;
  files: Record<(typeof HTR_WP10_CANDIDATE_REQUIRED_FILES)[number], string>;
  barrier?: {
    onChildReady: () => void | Promise<void>;
  };
  testInjectFailAfter?: (typeof HTR_WP10_CANDIDATE_REQUIRED_FILES)[number];
};

async function spawnWriterChild(input: SpawnWriterChildInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(WP10_WRITER_TSX_BINARY, [WP10_WRITER_CHILD_SCRIPT], {
      cwd: input.cwd,
      env: {
        ...process.env,
        WP10_WRITER_CHILD: "1",
        WP10_WRITER_TEST_MODE: input.testInjectFailAfter ? "1" : "",
      },
      stdio: input.barrier ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
    });

    let barrierReleased = false;

    if (input.barrier) {
      child.on("message", (message: unknown) => {
        if (
          barrierReleased ||
          typeof message !== "object" ||
          message === null ||
          !("type" in message) ||
          (message as { type: string }).type !== "READY"
        ) {
          return;
        }
        barrierReleased = true;
        Promise.resolve(input.barrier!.onChildReady())
          .then(() => {
            child.send?.({ type: "GO" });
          })
          .catch(reject);
      });
    }

    if (!child.stdin || !child.stderr) {
      reject(new Error("WP10_WRITER_CHILD_STDIO_UNAVAILABLE"));
      return;
    }

    child.stdin.write(
      JSON.stringify({
        schemaVersion: HTR_WP10_WRITER_CHILD_INPUT_SCHEMA_VERSION,
        expectedIdentity: input.expectedIdentity,
        workCommitSha: input.workCommitSha,
        barrier: Boolean(input.barrier),
        testInjectFailAfter: input.testInjectFailAfter,
        files: input.files,
      }),
    );
    child.stdin.end();

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`WP10_WRITER_CHILD_EXIT_${code ?? "unknown"}:${stderr.trim()}`));
    });
  });
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
  testBarrier?: {
    onChildReady: () => void | Promise<void>;
  };
  testInjectFailAfter?: (typeof HTR_WP10_CANDIDATE_REQUIRED_FILES)[number];
};

export async function writeWp10DeterminismEvidence(
  input: WriteWp10DeterminismEvidenceInput,
): Promise<{
  outputDir: string;
  manifestPath: string;
  readmePath: string;
  provenancePath: string;
  stagingManifestPath: string;
  completionPath: string;
}> {
  const cwd = input.cwd ?? process.cwd();

  if (input.provenance.dirtyTree) {
    throw new Error("WP10_WRITER_REFUSES_DIRTY_TREE_CANDIDATE_SEAL");
  }

  const resolvedOutputDir = path.resolve(
    path.isAbsolute(input.outputDir) ? input.outputDir : path.join(cwd, input.outputDir),
  );

  assertInitialEmptyDestination(resolvedOutputDir, cwd);

  const expectedIdentity = getFsIdentity(resolvedOutputDir);
  const workCommitSha = input.provenance.gitSha;

  const manifestContent = `${JSON.stringify(input.manifest, null, 2)}\n`;
  const readmeContent = buildWp10DeterminismReadme(input.manifest);
  const provenanceContent = `${JSON.stringify(input.provenance, null, 2)}\n`;

  const stagingManifest = buildWp10StagingManifestFile({
    workCommitSha,
    harnessSourceSha256: input.provenance.harnessSourceSha256,
    manifestContent,
    readmeContent,
    provenanceContent,
  });

  const fileDigests = {
    "manifest.json": sha256Utf8(manifestContent),
    "README.md": sha256Utf8(readmeContent),
    "provenance.json": sha256Utf8(provenanceContent),
    "staging-manifest.json": sha256Utf8(stagingManifest.content),
  };

  const completionContent = buildWp10CandidateCompletionFile({
    workCommitSha,
    stagingManifestDigest: stagingManifest.digest,
    fileDigests,
  });

  await spawnWriterChild({
    cwd: resolvedOutputDir,
    expectedIdentity,
    workCommitSha,
    barrier: input.testBarrier,
    testInjectFailAfter: input.testInjectFailAfter,
    files: {
      "manifest.json": manifestContent,
      "README.md": readmeContent,
      "provenance.json": provenanceContent,
      "staging-manifest.json": stagingManifest.content,
      "completion.json": completionContent,
    },
  });

  return {
    outputDir: resolvedOutputDir,
    manifestPath: path.join(resolvedOutputDir, "manifest.json"),
    readmePath: path.join(resolvedOutputDir, "README.md"),
    provenancePath: path.join(resolvedOutputDir, "provenance.json"),
    stagingManifestPath: path.join(resolvedOutputDir, "staging-manifest.json"),
    completionPath: path.join(resolvedOutputDir, "completion.json"),
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
    .sort((left, right) => compareCodePointPaths(left.path, right.path));
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
