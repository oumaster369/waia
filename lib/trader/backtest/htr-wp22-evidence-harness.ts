import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import { runHtrWp22BoundedMemorySoak } from "@/lib/trader/backtest/htr-wp22-bounded-memory-soak";
import { runHtrWp22CheckpointResumeParity } from "@/lib/trader/backtest/htr-wp22-checkpoint-resume-parity";
import { runHtrWp22CrashRecoveryMatrix } from "@/lib/trader/backtest/htr-wp22-crash-recovery-matrix";
import { buildHtrWp22FixtureManifest } from "@/lib/trader/backtest/htr-wp22-fixture-manifest";
import type { HtrWp22CompletedRuntimeQualificationResult } from "@/lib/trader/backtest/htr-completed-runtime-qualification.types";
import type { HtrWp22BoundedMemorySoakResult } from "@/lib/trader/backtest/htr-wp22-bounded-memory-soak";
import type { HtrWp22CheckpointResumeParityResult } from "@/lib/trader/backtest/htr-wp22-checkpoint-resume-parity";
import type { HtrWp22CrashRecoveryMatrixResult } from "@/lib/trader/backtest/htr-wp22-crash-recovery-matrix";
import { runHtrWp22MultiPositionCorrectness } from "@/lib/trader/backtest/htr-wp22-multi-position-correctness";
import type { HtrWp22MultiRegimePostgresEvidenceResult } from "@/lib/trader/backtest/htr-wp22-multi-regime-postgres-evidence";
import type { HtrWp22MultiPositionCorrectnessResult } from "@/lib/trader/backtest/htr-wp22-multi-position-correctness";
import type { HtrWp22FixtureManifest } from "@/lib/trader/backtest/htr-wp22-fixture-manifest";

export const HTR_WP22_EVIDENCE_INTEGRITY_CONTRACT_ID = "waia.htr.evidence-integrity.v2" as const;
export const HTR_WP22_EVIDENCE_MANIFEST_SCHEMA = "htr-wp22-runtime-evidence-manifest/v2" as const;
export const HTR_WP22_EVIDENCE_STAGING_ROOT = ".cursor/plans/dee-415-wp22/evidence-staging";
export const HTR_WP22_HERMETIC_QUALIFICATION_STAGING_ROOT =
  "tests/fixtures/trader/wp22/qualification-staging" as const;

export type HtrWp22EvidenceArtifactEntry = {
  path: string;
  sizeBytes: number;
  fileSha256: string;
  payloadSha256: string;
  schemaVersion: string;
  /** Git SHA that owns the semantic content of this artifact. */
  artifactSourceGitSha: string;
  /** Git SHA of the evidence-assembly commit that generated/wrote this artifact file. */
  generatorGitSha: string;
  /** Deterministic fingerprint of generator provenance bound to generatorGitSha. */
  generatorSha256: string;
  sourceDirtyTree: boolean;
  generatorProvenance: string;
};

/** Sequential orchestration order — must not use Promise.all (shared DATABASE_URL singleton). */
export const HTR_WP22_EVIDENCE_SEAL_RESILIENCE_TASK_ORDER = [
  "crash-recovery-matrix",
  "checkpoint-resume-parity",
  "bounded-memory-soak",
] as const;

export type HtrWp22EvidenceManifest = {
  schemaVersion: typeof HTR_WP22_EVIDENCE_MANIFEST_SCHEMA;
  contractId: typeof HTR_WP22_EVIDENCE_INTEGRITY_CONTRACT_ID;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  generatorProvenance: string;
  artifactIndex: HtrWp22EvidenceArtifactEntry[];
};

export type HtrWp22EvidenceBundleInput = {
  /** Evidence-assembly commit SHA (manifest binding). */
  sourceGitSha: string;
  /** D-11B qualification commit SHA when loaded without re-measurement. */
  qualificationSourceGitSha?: string;
  sourceDirtyTree?: boolean;
  completedRuntime?: HtrWp22CompletedRuntimeQualificationResult;
  crashRecoveryMatrix?: HtrWp22CrashRecoveryMatrixResult;
  checkpointResumeParity?: HtrWp22CheckpointResumeParityResult;
  boundedMemorySoak?: HtrWp22BoundedMemorySoakResult;
  multiRegimePostgres?: HtrWp22MultiRegimePostgresEvidenceResult;
  fixtureManifest?: HtrWp22FixtureManifest;
  multiPositionCorrectness?: HtrWp22MultiPositionCorrectnessResult;
};

export function sha256FileBytes(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function computeReportPayloadSha256(payload: Record<string, unknown>): string {
  const rest = { ...payload };
  delete rest.payloadSha256;
  delete rest.fileSha256;
  return computeSemanticSha256Hex(rest);
}

export function resolveHtrWp22EvidenceStagingDir(
  sourceGitSha: string,
  cwd = process.cwd(),
  options?: { stagingRoot?: string },
): string {
  const root = options?.stagingRoot ?? path.join(cwd, HTR_WP22_EVIDENCE_STAGING_ROOT);
  return path.join(root, sourceGitSha);
}

export function computeHtrWp22EvidenceGeneratorSha256(
  generatorProvenance: string,
  generatorGitSha: string,
): string {
  return createHash("sha256")
    .update(`${generatorProvenance}\n${generatorGitSha}`, "utf8")
    .digest("hex");
}

export function assertHtrWp22EvidenceStagingTargetWritable(stagingDir: string): void {
  const manifestPath = path.join(stagingDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return;
  }
  if (verifyHtrWp22EvidenceStaging(stagingDir)) {
    throw new Error("HTR_WP22_EVIDENCE_STAGING_ALREADY_SEALED");
  }
  throw new Error("HTR_WP22_EVIDENCE_STAGING_PARTIAL_NOT_ACCEPTED");
}

export function loadHtrWp22CompletedRuntimeFromQualificationStaging(input: {
  qualificationSourceGitSha: string;
  cwd?: string;
  stagingRoot?: string;
}): HtrWp22CompletedRuntimeQualificationResult {
  const cwd = input.cwd ?? process.cwd();
  const artifactPath = path.join(
    resolveHtrWp22EvidenceStagingDir(input.qualificationSourceGitSha, cwd, {
      stagingRoot: input.stagingRoot,
    }),
    "completed-runtime-d11b.json",
  );
  if (!existsSync(artifactPath)) {
    throw new Error(
      `HTR_WP22_EVIDENCE_QUALIFICATION_ARTIFACT_MISSING:${input.qualificationSourceGitSha}`,
    );
  }
  const parsed = JSON.parse(
    readFileSync(artifactPath, "utf8"),
  ) as HtrWp22CompletedRuntimeQualificationResult & { payloadSha256?: string };
  if (parsed.terminalState !== "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS") {
    throw new Error(`HTR_WP22_EVIDENCE_QUALIFICATION_ARTIFACT_NOT_PASS:${parsed.terminalState}`);
  }
  if (parsed.sourceGitSha !== input.qualificationSourceGitSha) {
    throw new Error(
      `HTR_WP22_EVIDENCE_QUALIFICATION_SHA_MISMATCH:expected=${input.qualificationSourceGitSha}:artifact=${parsed.sourceGitSha}`,
    );
  }
  if (parsed.qualificationAttempt?.gitSha !== input.qualificationSourceGitSha) {
    throw new Error("HTR_WP22_EVIDENCE_QUALIFICATION_ATTEMPT_SHA_MISMATCH");
  }
  const { payloadSha256, ...semanticBody } = parsed;
  const expectedPayloadSha256 = computeReportPayloadSha256(semanticBody as Record<string, unknown>);
  if (payloadSha256 !== expectedPayloadSha256) {
    throw new Error("HTR_WP22_EVIDENCE_QUALIFICATION_PAYLOAD_SHA256_MISMATCH");
  }
  return parsed;
}

export async function assembleHtrWp22EvidenceBundleSequential(input: {
  sourceGitSha: string;
  qualificationSourceGitSha: string;
}): Promise<
  Required<
    Pick<
      HtrWp22EvidenceBundleInput,
      | "completedRuntime"
      | "crashRecoveryMatrix"
      | "checkpointResumeParity"
      | "boundedMemorySoak"
      | "fixtureManifest"
      | "multiPositionCorrectness"
    >
  > &
    HtrWp22EvidenceBundleInput
> {
  const currentHead = readGitCodeSha();
  if (currentHead !== input.sourceGitSha) {
    throw new Error(
      `HTR_WP22_EVIDENCE_SEAL:SOURCE_GIT_SHA_HEAD_MISMATCH:expected=${input.sourceGitSha}:actual=${currentHead}`,
    );
  }
  if (readGitDirtyTree()) {
    throw new Error("HTR_WP22_EVIDENCE_SEAL:DIRTY_SOURCE_TREE");
  }

  const completedRuntime = loadHtrWp22CompletedRuntimeFromQualificationStaging({
    qualificationSourceGitSha: input.qualificationSourceGitSha,
  });

  const crashRecoveryMatrix = await runHtrWp22CrashRecoveryMatrix();
  const checkpointResumeParity = await runHtrWp22CheckpointResumeParity();
  const boundedMemorySoak = await runHtrWp22BoundedMemorySoak();
  const fixtureManifest = buildHtrWp22FixtureManifest();
  const multiPositionCorrectness = await runHtrWp22MultiPositionCorrectness();

  return {
    sourceGitSha: input.sourceGitSha,
    qualificationSourceGitSha: input.qualificationSourceGitSha,
    sourceDirtyTree: false,
    completedRuntime,
    crashRecoveryMatrix,
    checkpointResumeParity,
    boundedMemorySoak,
    fixtureManifest,
    multiPositionCorrectness,
  };
}

function writeReportArtifact(
  stagingDir: string,
  relativePath: string,
  payload: Record<string, unknown>,
  input: {
    artifactSourceGitSha: string;
    generatorGitSha: string;
    sourceDirtyTree: boolean;
    schemaVersion: string;
    generatorProvenance: string;
  },
): HtrWp22EvidenceArtifactEntry {
  mkdirSync(stagingDir, { recursive: true });
  const absolutePath = path.join(stagingDir, relativePath);
  const payloadSha256 = computeReportPayloadSha256(payload);
  const reportBody = { ...payload, payloadSha256 };
  const serialized = `${JSON.stringify(reportBody, null, 2)}\n`;
  writeFileSync(absolutePath, serialized, "utf8");
  const fileSha256 = sha256FileBytes(absolutePath);
  const sizeBytes = statSync(absolutePath).size;
  const generatorProvenance = input.generatorProvenance;
  return {
    path: relativePath,
    sizeBytes,
    fileSha256,
    payloadSha256,
    schemaVersion: input.schemaVersion,
    artifactSourceGitSha: input.artifactSourceGitSha,
    generatorGitSha: input.generatorGitSha,
    generatorSha256: computeHtrWp22EvidenceGeneratorSha256(
      generatorProvenance,
      input.generatorGitSha,
    ),
    sourceDirtyTree: input.sourceDirtyTree,
    generatorProvenance,
  };
}

export function buildHtrWp22EvidenceManifest(
  stagingDir: string,
  bundle: HtrWp22EvidenceBundleInput,
): HtrWp22EvidenceManifest {
  const sourceDirtyTree = bundle.sourceDirtyTree ?? readGitDirtyTree();
  const artifactIndex: HtrWp22EvidenceArtifactEntry[] = [];
  const generatorGitSha = readGitCodeSha();
  const generatorProvenance = "lib/trader/backtest/htr-wp22-evidence-harness.ts";
  const qualificationSourceGitSha = bundle.qualificationSourceGitSha ?? bundle.sourceGitSha;

  const assemblyCommon = {
    generatorGitSha,
    sourceDirtyTree,
    generatorProvenance,
  };

  if (bundle.completedRuntime) {
    artifactIndex.push(
      writeReportArtifact(
        stagingDir,
        "completed-runtime-d11b.json",
        bundle.completedRuntime as unknown as Record<string, unknown>,
        {
          ...assemblyCommon,
          artifactSourceGitSha: qualificationSourceGitSha,
          schemaVersion: bundle.completedRuntime.schemaVersion,
        },
      ),
    );
  }

  if (bundle.crashRecoveryMatrix) {
    artifactIndex.push(
      writeReportArtifact(
        stagingDir,
        "crash-recovery-matrix.json",
        bundle.crashRecoveryMatrix as unknown as Record<string, unknown>,
        {
          ...assemblyCommon,
          artifactSourceGitSha: bundle.sourceGitSha,
          schemaVersion: bundle.crashRecoveryMatrix.schemaVersion,
        },
      ),
    );
  }

  if (bundle.checkpointResumeParity) {
    artifactIndex.push(
      writeReportArtifact(
        stagingDir,
        "checkpoint-resume-parity.json",
        bundle.checkpointResumeParity as unknown as Record<string, unknown>,
        {
          ...assemblyCommon,
          artifactSourceGitSha: bundle.sourceGitSha,
          schemaVersion: bundle.checkpointResumeParity.schemaVersion,
        },
      ),
    );
  }

  if (bundle.boundedMemorySoak) {
    artifactIndex.push(
      writeReportArtifact(
        stagingDir,
        "bounded-memory-soak.json",
        bundle.boundedMemorySoak as unknown as Record<string, unknown>,
        {
          ...assemblyCommon,
          artifactSourceGitSha: bundle.sourceGitSha,
          schemaVersion: bundle.boundedMemorySoak.schemaVersion,
        },
      ),
    );
  }

  if (bundle.multiRegimePostgres) {
    artifactIndex.push(
      writeReportArtifact(
        stagingDir,
        "multi-regime-postgres-evidence.json",
        bundle.multiRegimePostgres as unknown as Record<string, unknown>,
        {
          ...assemblyCommon,
          artifactSourceGitSha: bundle.sourceGitSha,
          schemaVersion: bundle.multiRegimePostgres.schemaVersion,
        },
      ),
    );
  }

  if (bundle.fixtureManifest) {
    artifactIndex.push(
      writeReportArtifact(
        stagingDir,
        "multi-position-fixture-manifest.json",
        bundle.fixtureManifest as unknown as Record<string, unknown>,
        {
          ...assemblyCommon,
          artifactSourceGitSha: bundle.sourceGitSha,
          schemaVersion: bundle.fixtureManifest.schemaVersion,
        },
      ),
    );
  }

  if (bundle.multiPositionCorrectness) {
    artifactIndex.push(
      writeReportArtifact(
        stagingDir,
        "multi-position-correctness-result.json",
        bundle.multiPositionCorrectness as unknown as Record<string, unknown>,
        {
          ...assemblyCommon,
          artifactSourceGitSha: bundle.sourceGitSha,
          schemaVersion: bundle.multiPositionCorrectness.schemaVersion,
        },
      ),
    );
  }

  return {
    schemaVersion: HTR_WP22_EVIDENCE_MANIFEST_SCHEMA,
    contractId: HTR_WP22_EVIDENCE_INTEGRITY_CONTRACT_ID,
    sourceGitSha: bundle.sourceGitSha,
    sourceDirtyTree,
    generatorProvenance: "lib/trader/backtest/htr-wp22-evidence-harness.ts",
    artifactIndex,
  };
}

export function sealHtrWp22EvidenceStaging(input: {
  sourceGitSha: string;
  bundle: HtrWp22EvidenceBundleInput;
  cwd?: string;
}): {
  stagingDir: string;
  manifest: HtrWp22EvidenceManifest;
  manifestDigest: string;
  semanticDigest: string;
} {
  const cwd = input.cwd ?? process.cwd();
  const stagingDir = resolveHtrWp22EvidenceStagingDir(input.sourceGitSha, cwd);
  if (stagingDir.includes("replay-runs/RI-P7/htr-wp22-runtime-qualification")) {
    throw new Error("HTR_WP22_EVIDENCE_ACCEPTED_PATH_WRITE_DURING_PHASE_A");
  }
  assertHtrWp22EvidenceStagingTargetWritable(stagingDir);

  const manifest = buildHtrWp22EvidenceManifest(stagingDir, {
    ...input.bundle,
    sourceGitSha: input.sourceGitSha,
  });

  const manifestPath = path.join(stagingDir, "manifest.json");
  const manifestSerialized = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, manifestSerialized, "utf8");

  const manifestDigest = sha256FileBytes(manifestPath);
  writeFileSync(path.join(stagingDir, "manifest.digest"), `${manifestDigest}\n`, "utf8");

  const semanticDigest = computeSemanticSha256Hex({
    contractId: manifest.contractId,
    sourceGitSha: manifest.sourceGitSha,
    sourceDirtyTree: manifest.sourceDirtyTree,
    artifactIndex: manifest.artifactIndex.map((entry) => ({
      path: entry.path,
      payloadSha256: entry.payloadSha256,
      schemaVersion: entry.schemaVersion,
    })),
  });
  writeFileSync(path.join(stagingDir, "semantic.digest"), `${semanticDigest}\n`, "utf8");

  return { stagingDir, manifest, manifestDigest, semanticDigest };
}

export function verifyHtrWp22EvidenceStaging(stagingDir: string): boolean {
  const manifestPath = path.join(stagingDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as HtrWp22EvidenceManifest;
  const manifestDigest = readFileSync(path.join(stagingDir, "manifest.digest"), "utf8").trim();
  const semanticDigest = readFileSync(path.join(stagingDir, "semantic.digest"), "utf8").trim();

  if (manifestDigest !== sha256FileBytes(manifestPath)) {
    return false;
  }

  for (const entry of manifest.artifactIndex) {
    const artifactPath = path.join(stagingDir, entry.path);
    if (sha256FileBytes(artifactPath) !== entry.fileSha256) {
      return false;
    }
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
    if (computeReportPayloadSha256(parsed) !== entry.payloadSha256) {
      return false;
    }
  }

  const expectedSemanticDigest = computeSemanticSha256Hex({
    contractId: manifest.contractId,
    sourceGitSha: manifest.sourceGitSha,
    sourceDirtyTree: manifest.sourceDirtyTree,
    artifactIndex: manifest.artifactIndex.map((entry) => ({
      path: entry.path,
      payloadSha256: entry.payloadSha256,
      schemaVersion: entry.schemaVersion,
    })),
  });

  return semanticDigest === expectedSemanticDigest;
}

export function readCurrentGitShaForWp22Evidence(): string {
  return readGitCodeSha();
}
