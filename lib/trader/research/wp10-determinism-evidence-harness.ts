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

export function resolveHistoricalWp10EvidenceDir(cwd = process.cwd()): string {
  return path.join(cwd, HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH);
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

function normalizePathForComparison(absolutePath: string): string {
  return path.normalize(path.resolve(absolutePath));
}

export function assertWp10WriterOutputDirAllowed(outputDir: string, cwd = process.cwd()): void {
  if (!outputDir || outputDir.trim().length === 0) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_REQUIRED");
  }

  const resolved = normalizePathForComparison(
    path.isAbsolute(outputDir) ? outputDir : path.join(cwd, outputDir),
  );
  const historical = normalizePathForComparison(resolveHistoricalWp10EvidenceDir(cwd));
  const trackedVaultRoot = normalizePathForComparison(
    path.join(cwd, HTR_WP10_TRACKED_EVIDENCE_VAULT_PREFIX),
  );

  if (resolved === historical || resolved.startsWith(`${historical}${path.sep}`)) {
    throw new Error("WP10_WRITER_CANNOT_TARGET_HISTORICAL_ACCEPTED_PATH");
  }

  if (resolved.startsWith(`${trackedVaultRoot}${path.sep}`) || resolved === trackedVaultRoot) {
    throw new Error("WP10_WRITER_CANNOT_TARGET_TRACKED_ACCEPTED_EVIDENCE_VAULT");
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
  assertWp10WriterOutputDirAllowed(input.outputDir, cwd);

  if (input.provenance.dirtyTree) {
    throw new Error("WP10_WRITER_REFUSES_DIRTY_TREE_CANDIDATE_SEAL");
  }

  const resolvedOutputDir = path.isAbsolute(input.outputDir)
    ? input.outputDir
    : path.join(cwd, input.outputDir);

  if (!fs.existsSync(resolvedOutputDir)) {
    throw new Error("WP10_WRITER_OUTPUT_DIR_MISSING");
  }

  const manifestPath = path.join(resolvedOutputDir, "manifest.json");
  const readmePath = path.join(resolvedOutputDir, "README.md");
  const provenancePath = path.join(resolvedOutputDir, "provenance.json");

  fs.writeFileSync(manifestPath, `${JSON.stringify(input.manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(readmePath, buildWp10DeterminismReadme(input.manifest), "utf8");
  fs.writeFileSync(provenancePath, `${JSON.stringify(input.provenance, null, 2)}\n`, "utf8");

  return {
    outputDir: resolvedOutputDir,
    manifestPath,
    readmePath,
    provenancePath,
  };
}

export function computeWp10StagingManifestDigest(filePaths: readonly string[]): string {
  const sorted = [...filePaths].sort();
  const entries = sorted.map((filePath) => ({
    path: path.basename(filePath),
    sha256: createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
  }));
  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}
