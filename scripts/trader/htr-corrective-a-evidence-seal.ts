/**
 * HTR-FINAL-AUDIT-CORRECTIVE-A (C-A5) — gitignored evidence seal CLI.
 *
 * Usage:
 *   pnpm trader:htr:corrective-a:evidence-seal
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

function readGitCodeSha(cwd = process.cwd()): string {
  return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
}

function readGitDirtyTree(cwd = process.cwd()): boolean {
  return execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim().length > 0;
}

export const HTR_CORRECTIVE_A_PACKET_SHA256 =
  "04863e7af156a3593ff5380d519decff0e33168bf518c4b05886b1ad2f82c6a2" as const;

export const HTR_CORRECTIVE_A_EVIDENCE_STAGING_ROOT =
  "replay-runs/RI-P7/htr-corrective-a-qualification" as const;

export const HTR_CORRECTIVE_A_EVIDENCE_INTEGRITY_CONTRACT_ID =
  "waia.htr.evidence-integrity.v2" as const;

export const HTR_CORRECTIVE_A_EVIDENCE_MANIFEST_SCHEMA =
  "htr-corrective-a-evidence-manifest/v1" as const;

export const HTR_CORRECTIVE_A_FORBIDDEN_ACCEPTED_EVIDENCE_PATHS = [
  "replay-runs/RI-P7/htr-wp22-runtime-qualification",
  "replay-runs/RI-P7/htr-wp23-readiness-package",
] as const;

export type HtrCorrectiveAEvidenceQualificationInput = Readonly<{
  schemaVersion: string;
  terminalState: string;
  gateStatuses: ReadonlyArray<{
    gate: string;
    correctiveArea: string;
    terminalState: string;
    proofSummary: string;
  }>;
}>;

export type HtrCorrectiveAEvidenceArtifactEntry = {
  path: string;
  sizeBytes: number;
  fileSha256: string;
  payloadSha256: string;
  schemaVersion: string;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  packetSha256: typeof HTR_CORRECTIVE_A_PACKET_SHA256;
  generatorProvenance: string;
};

export type HtrCorrectiveAEvidenceManifest = {
  schemaVersion: typeof HTR_CORRECTIVE_A_EVIDENCE_MANIFEST_SCHEMA;
  contractId: typeof HTR_CORRECTIVE_A_EVIDENCE_INTEGRITY_CONTRACT_ID;
  sourceGitSha: string;
  sourceDirtyTree: false;
  packetSha256: typeof HTR_CORRECTIVE_A_PACKET_SHA256;
  generatorProvenance: string;
  artifactIndex: HtrCorrectiveAEvidenceArtifactEntry[];
};

export type HtrCorrectiveAEvidenceSealResult = {
  stagingDir: string;
  sourceGitSha: string;
  sourceDirtyTree: false;
  packetSha256: typeof HTR_CORRECTIVE_A_PACKET_SHA256;
  manifestDigest: string;
  semanticDigest: string;
  artifactCount: number;
};

const GENERATOR_PROVENANCE = "scripts/trader/htr-corrective-a-evidence-seal.ts";

export function readCorrectiveAEvidenceHarnessSha256(cwd = process.cwd()): string {
  const hash = createHash("sha256");
  for (const relPath of [
    "scripts/trader/htr-corrective-a-qualify.ts",
    "scripts/trader/htr-corrective-a-evidence-seal.ts",
  ]) {
    hash.update(readFileSync(path.join(cwd, relPath), "utf8"));
  }
  return hash.digest("hex");
}

export function sha256FileBytes(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function computeReportPayloadSha256(payload: Record<string, unknown>): string {
  const rest = { ...payload };
  delete rest.payloadSha256;
  delete rest.fileSha256;
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) {
      delete rest[key];
    }
  }
  return computeSemanticSha256Hex(rest);
}

export function resolveHtrCorrectiveAEvidenceStagingDir(
  sourceGitSha: string,
  cwd = process.cwd(),
): string {
  return path.join(cwd, HTR_CORRECTIVE_A_EVIDENCE_STAGING_ROOT, sourceGitSha);
}

export function assertHtrCorrectiveAEvidenceStagingTargetAllowed(
  sourceGitSha: string,
  cwd = process.cwd(),
): string {
  const stagingDir = resolveHtrCorrectiveAEvidenceStagingDir(sourceGitSha, cwd);
  const resolvedStaging = path.resolve(stagingDir);
  const resolvedRoot = path.resolve(cwd, HTR_CORRECTIVE_A_EVIDENCE_STAGING_ROOT);

  if (
    resolvedStaging !== resolvedRoot &&
    !resolvedStaging.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:PATH_TRAVERSAL");
  }
  if (path.basename(resolvedStaging) !== sourceGitSha) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:PATH_TRAVERSAL");
  }

  for (const forbiddenPath of HTR_CORRECTIVE_A_FORBIDDEN_ACCEPTED_EVIDENCE_PATHS) {
    const resolvedForbidden = path.resolve(cwd, forbiddenPath);
    if (
      resolvedStaging === resolvedForbidden ||
      resolvedStaging.startsWith(`${resolvedForbidden}${path.sep}`)
    ) {
      throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:ACCEPTED_PATH_SUBSTITUTION_FORBIDDEN");
    }
  }

  return resolvedStaging;
}

export function assertHtrCorrectiveAEvidenceStagingTargetWritable(stagingDir: string): void {
  const manifestPath = path.join(stagingDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return;
  }
  if (verifyHtrCorrectiveAEvidenceStaging(stagingDir)) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_STAGING_ALREADY_SEALED");
  }
  throw new Error("HTR_CORRECTIVE_A_EVIDENCE_STAGING_PARTIAL_NOT_ACCEPTED");
}

function writeReportArtifact(
  stagingDir: string,
  relativePath: string,
  payload: Record<string, unknown>,
  input: {
    sourceGitSha: string;
    sourceDirtyTree: false;
    schemaVersion: string;
  },
): HtrCorrectiveAEvidenceArtifactEntry {
  mkdirSync(stagingDir, { recursive: true });
  const absolutePath = path.join(stagingDir, relativePath);
  const payloadSha256 = computeReportPayloadSha256(payload);
  const reportBody = { ...payload, payloadSha256 };
  const serialized = `${JSON.stringify(reportBody, null, 2)}\n`;
  writeFileSync(absolutePath, serialized, "utf8");
  const fileSha256 = sha256FileBytes(absolutePath);
  const sizeBytes = statSync(absolutePath).size;
  return {
    path: relativePath,
    sizeBytes,
    fileSha256,
    payloadSha256,
    schemaVersion: input.schemaVersion,
    sourceGitSha: input.sourceGitSha,
    sourceDirtyTree: input.sourceDirtyTree,
    packetSha256: HTR_CORRECTIVE_A_PACKET_SHA256,
    generatorProvenance: GENERATOR_PROVENANCE,
  };
}

export function buildHtrCorrectiveAEvidenceManifest(input: {
  stagingDir: string;
  sourceGitSha: string;
  qualification: HtrCorrectiveAEvidenceQualificationInput;
}): HtrCorrectiveAEvidenceManifest {
  const common = {
    sourceGitSha: input.sourceGitSha,
    sourceDirtyTree: false as const,
  };

  const artifactIndex: HtrCorrectiveAEvidenceArtifactEntry[] = [
    writeReportArtifact(
      input.stagingDir,
      "integrated-qualification-report.json",
      input.qualification as unknown as Record<string, unknown>,
      {
        ...common,
        schemaVersion: input.qualification.schemaVersion,
      },
    ),
    writeReportArtifact(
      input.stagingDir,
      "corrective-a-packet-binding.json",
      {
        packetSha256: HTR_CORRECTIVE_A_PACKET_SHA256,
        macroPackage: "HTR-FINAL-AUDIT-CORRECTIVE-A",
        correctiveItems: ["C-A1", "C-A2", "C-A3", "C-A4", "C-A5"],
        evidenceHarnessSha256: readCorrectiveAEvidenceHarnessSha256(),
      },
      {
        ...common,
        schemaVersion: "htr-corrective-a-packet-binding/v1",
      },
    ),
    writeReportArtifact(
      input.stagingDir,
      "gate-status-index.json",
      {
        gateStatuses: input.qualification.gateStatuses,
        terminalState: input.qualification.terminalState,
      },
      {
        ...common,
        schemaVersion: "htr-corrective-a-gate-status-index/v1",
      },
    ),
  ];

  return {
    schemaVersion: HTR_CORRECTIVE_A_EVIDENCE_MANIFEST_SCHEMA,
    contractId: HTR_CORRECTIVE_A_EVIDENCE_INTEGRITY_CONTRACT_ID,
    sourceGitSha: input.sourceGitSha,
    sourceDirtyTree: false,
    packetSha256: HTR_CORRECTIVE_A_PACKET_SHA256,
    generatorProvenance: GENERATOR_PROVENANCE,
    artifactIndex,
  };
}

export function verifyHtrCorrectiveAEvidenceStaging(stagingDir: string): boolean {
  const manifestPath = path.join(stagingDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return false;
  }

  const manifestDigestPath = path.join(stagingDir, "manifest.digest");
  const semanticDigestPath = path.join(stagingDir, "semantic.digest");
  if (!existsSync(manifestDigestPath) || !existsSync(semanticDigestPath)) {
    return false;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as HtrCorrectiveAEvidenceManifest;
  const manifestDigest = readFileSync(manifestDigestPath, "utf8").trim();
  const semanticDigest = readFileSync(semanticDigestPath, "utf8").trim();

  if (manifestDigest !== sha256FileBytes(manifestPath)) {
    return false;
  }

  if (manifest.packetSha256 !== HTR_CORRECTIVE_A_PACKET_SHA256) {
    return false;
  }

  if (manifest.sourceDirtyTree !== false) {
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
    if (entry.packetSha256 !== HTR_CORRECTIVE_A_PACKET_SHA256) {
      return false;
    }
  }

  const expectedSemanticDigest = computeSemanticSha256Hex({
    contractId: manifest.contractId,
    sourceGitSha: manifest.sourceGitSha,
    sourceDirtyTree: manifest.sourceDirtyTree,
    packetSha256: manifest.packetSha256,
    artifactIndex: manifest.artifactIndex.map((entry) => ({
      path: entry.path,
      payloadSha256: entry.payloadSha256,
      schemaVersion: entry.schemaVersion,
    })),
  });

  return semanticDigest === expectedSemanticDigest;
}

export function assertCorrectiveAEvidenceOneByteMutationRejected(stagingDir: string): void {
  if (!verifyHtrCorrectiveAEvidenceStaging(stagingDir)) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:MUTATION_BASELINE_INVALID");
  }

  const manifestDigestPath = path.join(stagingDir, "manifest.digest");
  const originalDigest = readFileSync(manifestDigestPath, "utf8");
  writeFileSync(manifestDigestPath, `${originalDigest}x`, "utf8");
  if (verifyHtrCorrectiveAEvidenceStaging(stagingDir)) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:MUTATION_NOT_REJECTED");
  }
  writeFileSync(manifestDigestPath, originalDigest, "utf8");
  if (!verifyHtrCorrectiveAEvidenceStaging(stagingDir)) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:MUTATION_RESTORE_FAILED");
  }
}

export function sealHtrCorrectiveAEvidenceStaging(input: {
  sourceGitSha: string;
  qualification: HtrCorrectiveAEvidenceQualificationInput;
  cwd?: string;
}): HtrCorrectiveAEvidenceSealResult {
  const cwd = input.cwd ?? process.cwd();
  const stagingDir = assertHtrCorrectiveAEvidenceStagingTargetAllowed(input.sourceGitSha, cwd);
  assertHtrCorrectiveAEvidenceStagingTargetWritable(stagingDir);

  const manifest = buildHtrCorrectiveAEvidenceManifest({
    stagingDir,
    sourceGitSha: input.sourceGitSha,
    qualification: input.qualification,
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
    packetSha256: manifest.packetSha256,
    artifactIndex: manifest.artifactIndex.map((entry) => ({
      path: entry.path,
      payloadSha256: entry.payloadSha256,
      schemaVersion: entry.schemaVersion,
    })),
  });
  writeFileSync(path.join(stagingDir, "semantic.digest"), `${semanticDigest}\n`, "utf8");

  return {
    stagingDir,
    sourceGitSha: input.sourceGitSha,
    sourceDirtyTree: false,
    packetSha256: HTR_CORRECTIVE_A_PACKET_SHA256,
    manifestDigest,
    semanticDigest,
    artifactCount: manifest.artifactIndex.length,
  };
}

export function runHtrCorrectiveAEvidenceSeal(
  cwd = process.cwd(),
): HtrCorrectiveAEvidenceSealResult {
  if (readGitDirtyTree()) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:DIRTY_SOURCE_TREE");
  }

  const sourceGitSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  if (sourceGitSha !== readGitCodeSha()) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:SOURCE_GIT_SHA_HEAD_MISMATCH");
  }

  const qualificationOutput = execSync(
    `WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server scripts/trader/htr-corrective-a-qualify.ts -- --source-git-sha ${sourceGitSha}`,
    {
      cwd,
      encoding: "utf8",
    },
  );
  const qualification = JSON.parse(
    qualificationOutput,
  ) as HtrCorrectiveAEvidenceQualificationInput & {
    terminalState: string;
    sourceDirtyTree: boolean;
    packetSha256: string;
  };

  if (qualification.terminalState !== "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PASS") {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:QUALIFICATION_FAILED");
  }
  if (qualification.sourceDirtyTree) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:DIRTY_SOURCE_TREE");
  }
  if (qualification.packetSha256 !== HTR_CORRECTIVE_A_PACKET_SHA256) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:PACKET_SHA256_MISMATCH");
  }

  const sealed = sealHtrCorrectiveAEvidenceStaging({
    sourceGitSha,
    qualification,
    cwd,
  });

  if (!verifyHtrCorrectiveAEvidenceStaging(sealed.stagingDir)) {
    throw new Error("HTR_CORRECTIVE_A_EVIDENCE_SEAL:INTERNAL_VERIFICATION_FAILED");
  }

  assertCorrectiveAEvidenceOneByteMutationRejected(sealed.stagingDir);

  return sealed;
}

function isCliEntrypoint(scriptSuffix: string): boolean {
  return (process.argv[1] ?? "").endsWith(scriptSuffix);
}

function main(): void {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("WAIA_TRADER_CLI=1 required");
  }

  try {
    const sealed = runHtrCorrectiveAEvidenceSeal();
    console.log(JSON.stringify(sealed, null, 2));
  } catch (error: unknown) {
    console.error("[htr-corrective-a-evidence-seal] failed:", error);
    process.exitCode = 1;
  }
}

if (isCliEntrypoint("htr-corrective-a-evidence-seal.ts")) {
  main();
}
