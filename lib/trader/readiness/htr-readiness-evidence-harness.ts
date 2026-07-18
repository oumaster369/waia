import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  buildHtrExecutionServerPackageManifest,
  computeHtrExecutionServerPackageDigest,
} from "@/lib/trader/readiness/htr-execution-server-package";
import {
  HTR_FHV_RUN_CONTRACT_V0,
  computeHtrFhvRunContractDigest,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { HTR_OPERATOR_REPORT_SCHEMA_VERSION } from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import { listHtrReadinessGateGroupsRequiringPreflight } from "@/lib/trader/readiness/htr-readiness-gate-groups";
import {
  assertHtrReadinessPreflightPass,
  runHtrReadinessPreflight,
  type HtrReadinessPreflightResult,
} from "@/lib/trader/readiness/htr-readiness-preflight";

export const HTR_WP23_EVIDENCE_INTEGRITY_CONTRACT_ID = "waia.htr.evidence-integrity.v2" as const;
export const HTR_WP23_EVIDENCE_MANIFEST_SCHEMA = "htr-wp23-readiness-evidence-manifest/v1" as const;
export const HTR_WP23_EVIDENCE_STAGING_ROOT = ".cursor/plans/dee-415-wp23/evidence-staging";
export const HTR_WP23_ACCEPTED_REPLAY_RUNS_EVIDENCE_PATH =
  "replay-runs/RI-P7/htr-wp23-readiness-package";

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

const HTR_WP23_EVIDENCE_ARTIFACT_FILES = [
  "readiness-preflight-report.json",
  "fhv-run-contract-v0.json",
  "execution-server-package-manifest.json",
  "gate-groups-index.json",
  "manifest.json",
  "manifest.digest",
  "semantic.digest",
] as const;

const HTR_WP23_CREDENTIAL_PATTERNS = [
  /postgresql:\/\//i,
  /DATABASE_URL/i,
  /BEGIN (RSA |EC )?PRIVATE KEY/i,
  /api[_-]?key\s*[:=]/i,
  /secret\s*[:=]/i,
  /password\s*[:=]/i,
] as const;

export type HtrWp23EvidenceArtifactEntry = {
  path: string;
  sizeBytes: number;
  fileSha256: string;
  payloadSha256: string;
  schemaVersion: string;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  generatorProvenance: string;
};

export type HtrWp23EvidenceManifest = {
  schemaVersion: typeof HTR_WP23_EVIDENCE_MANIFEST_SCHEMA;
  contractId: typeof HTR_WP23_EVIDENCE_INTEGRITY_CONTRACT_ID;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  generatorProvenance: string;
  artifactIndex: HtrWp23EvidenceArtifactEntry[];
};

export type HtrWp23EvidenceBundleInput = {
  sourceGitSha: string;
  sourceDirtyTree?: boolean;
  preflightResult: HtrReadinessPreflightResult;
  cwd?: string;
};

export type HtrWp23OfficialEvidenceSealResult = {
  stagingDir: string;
  sourceGitSha: string;
  sourceDirtyTree: false;
  generatorGitSha: string;
  manifestDigest: string;
  semanticDigest: string;
  manifestVerification: true;
  semanticVerification: true;
  credentialsDetected: false;
  holdoutRead: false;
  executionServerMutation: false;
  artifactCount: number;
};

export function assertHtrWp23EvidenceSourceGitSha(sourceGitSha: string): void {
  if (sourceGitSha.length !== 40) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:SOURCE_GIT_SHA_SHORT_OR_LONG");
  }
  if (sourceGitSha !== sourceGitSha.toLowerCase()) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:SOURCE_GIT_SHA_NOT_LOWERCASE");
  }
  if (!FULL_GIT_SHA_PATTERN.test(sourceGitSha)) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:SOURCE_GIT_SHA_MALFORMED");
  }
}

export function assertHtrWp23EvidenceGitHeadMatches(
  sourceGitSha: string,
  headSha = readGitCodeSha(),
): void {
  assertHtrWp23EvidenceSourceGitSha(sourceGitSha);
  if (headSha !== sourceGitSha) {
    throw new Error(
      `HTR_WP23_EVIDENCE_SEAL:SOURCE_GIT_SHA_HEAD_MISMATCH:expected=${sourceGitSha}:actual=${headSha}`,
    );
  }
}

export function assertHtrWp23EvidenceGitTreeClean(dirtyTree = readGitDirtyTree()): void {
  if (dirtyTree) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:DIRTY_SOURCE_TREE");
  }
}

function assertResolvedPathUnderRoot(resolvedPath: string, resolvedRoot: string): void {
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootWithSep)) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:PATH_TRAVERSAL");
  }
}

export function assertHtrWp23EvidenceStagingTargetAllowed(
  sourceGitSha: string,
  cwd = process.cwd(),
): string {
  assertHtrWp23EvidenceSourceGitSha(sourceGitSha);
  const stagingDir = resolveHtrWp23EvidenceStagingDir(sourceGitSha, cwd);
  const resolvedStaging = path.resolve(stagingDir);
  const resolvedRoot = path.resolve(cwd, HTR_WP23_EVIDENCE_STAGING_ROOT);
  const resolvedAccepted = path.resolve(cwd, HTR_WP23_ACCEPTED_REPLAY_RUNS_EVIDENCE_PATH);

  assertResolvedPathUnderRoot(resolvedStaging, resolvedRoot);
  if (path.basename(resolvedStaging) !== sourceGitSha) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:PATH_TRAVERSAL");
  }
  if (
    resolvedStaging === resolvedAccepted ||
    resolvedStaging.startsWith(`${resolvedAccepted}${path.sep}`)
  ) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:ACCEPTED_PATH_SUBSTITUTION_FORBIDDEN");
  }

  if (existsSync(resolvedStaging)) {
    const leafStat = lstatSync(resolvedStaging);
    if (leafStat.isSymbolicLink()) {
      throw new Error("HTR_WP23_EVIDENCE_SEAL:STAGING_DIR_LEAF_IS_SYMLINK");
    }
    const realStaging = realpathSync(resolvedStaging);
    assertResolvedPathUnderRoot(realStaging, resolvedRoot);
  }

  return resolvedStaging;
}

export function assertHtrWp23EvidenceStagingTargetWritable(stagingDir: string): void {
  const manifestPath = path.join(stagingDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return;
  }
  if (verifyHtrWp23EvidenceStaging(stagingDir)) {
    throw new Error("HTR_WP23_EVIDENCE_STAGING_ALREADY_SEALED");
  }
  throw new Error("HTR_WP23_EVIDENCE_STAGING_PARTIAL_NOT_ACCEPTED");
}

export function scanHtrWp23EvidenceCredentials(stagingDir: string): boolean {
  for (const fileName of HTR_WP23_EVIDENCE_ARTIFACT_FILES) {
    const filePath = path.join(stagingDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    const contents = readFileSync(filePath, "utf8");
    if (HTR_WP23_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(contents))) {
      return true;
    }
  }
  return false;
}

export function sha256FileBytes(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function computeReportPayloadSha256(payload: Record<string, unknown>): string {
  const rest = { ...payload };
  delete rest.payloadSha256;
  delete rest.fileSha256;
  return computeSemanticSha256Hex(rest);
}

export function resolveHtrWp23EvidenceStagingDir(
  sourceGitSha: string,
  cwd = process.cwd(),
): string {
  return path.join(cwd, HTR_WP23_EVIDENCE_STAGING_ROOT, sourceGitSha);
}

function writeReportArtifact(
  stagingDir: string,
  relativePath: string,
  payload: Record<string, unknown>,
  input: { sourceGitSha: string; sourceDirtyTree: boolean; schemaVersion: string },
): HtrWp23EvidenceArtifactEntry {
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
    generatorProvenance: "lib/trader/readiness/htr-readiness-evidence-harness.ts",
  };
}

export function buildHtrWp23EvidenceManifest(
  stagingDir: string,
  bundle: HtrWp23EvidenceBundleInput,
): HtrWp23EvidenceManifest {
  const sourceDirtyTree = bundle.sourceDirtyTree ?? readGitDirtyTree();
  const common = {
    sourceGitSha: bundle.sourceGitSha,
    sourceDirtyTree,
  };

  const artifactIndex: HtrWp23EvidenceArtifactEntry[] = [
    writeReportArtifact(
      stagingDir,
      "readiness-preflight-report.json",
      bundle.preflightResult as unknown as Record<string, unknown>,
      {
        ...common,
        schemaVersion: "htr-wp23-readiness-preflight-report/v1",
      },
    ),
    writeReportArtifact(
      stagingDir,
      "fhv-run-contract-v0.json",
      HTR_FHV_RUN_CONTRACT_V0 as unknown as Record<string, unknown>,
      {
        ...common,
        schemaVersion: HTR_FHV_RUN_CONTRACT_V0.schemaVersion,
      },
    ),
    writeReportArtifact(
      stagingDir,
      "execution-server-package-manifest.json",
      buildHtrExecutionServerPackageManifest() as unknown as Record<string, unknown>,
      {
        ...common,
        schemaVersion: buildHtrExecutionServerPackageManifest().schemaVersion,
      },
    ),
    writeReportArtifact(
      stagingDir,
      "gate-groups-index.json",
      {
        gateGroups: listHtrReadinessGateGroupsRequiringPreflight(),
        operatorReportSchemaVersion: HTR_OPERATOR_REPORT_SCHEMA_VERSION,
        fhvRunContractDigest: computeHtrFhvRunContractDigest(),
        executionServerPackageDigest: computeHtrExecutionServerPackageDigest(),
      },
      {
        ...common,
        schemaVersion: "htr-wp23-gate-groups-index/v1",
      },
    ),
  ];

  return {
    schemaVersion: HTR_WP23_EVIDENCE_MANIFEST_SCHEMA,
    contractId: HTR_WP23_EVIDENCE_INTEGRITY_CONTRACT_ID,
    sourceGitSha: bundle.sourceGitSha,
    sourceDirtyTree,
    generatorProvenance: "lib/trader/readiness/htr-readiness-evidence-harness.ts",
    artifactIndex,
  };
}

function writeSidecar(stagingDir: string, fileName: string, digest: string): void {
  writeFileSync(path.join(stagingDir, fileName), `${digest}\n`, "utf8");
}

export function sealHtrWp23EvidenceStaging(bundle: HtrWp23EvidenceBundleInput): {
  stagingDir: string;
  manifest: HtrWp23EvidenceManifest;
} {
  const cwd = bundle.cwd ?? process.cwd();
  const stagingDir = resolveHtrWp23EvidenceStagingDir(bundle.sourceGitSha, cwd);
  assertHtrWp23EvidenceStagingTargetWritable(stagingDir);
  const manifest = buildHtrWp23EvidenceManifest(stagingDir, bundle);
  const manifestPath = path.join(stagingDir, "manifest.json");
  const manifestSerialized = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, manifestSerialized, "utf8");
  writeSidecar(stagingDir, "manifest.digest", sha256FileBytes(manifestPath));
  writeSidecar(
    stagingDir,
    "semantic.digest",
    computeSemanticSha256Hex({
      contractId: manifest.contractId,
      sourceGitSha: manifest.sourceGitSha,
      artifactPayloadDigests: manifest.artifactIndex.map((entry) => entry.payloadSha256),
    }),
  );
  return { stagingDir, manifest };
}

export function verifyHtrWp23EvidenceStaging(stagingDir: string): boolean {
  const manifestPath = path.join(stagingDir, "manifest.json");
  const manifestDigestPath = path.join(stagingDir, "manifest.digest");
  const semanticDigestPath = path.join(stagingDir, "semantic.digest");
  const manifest: HtrWp23EvidenceManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifestDigest = readFileSync(manifestDigestPath, "utf8").trim();
  if (manifestDigest !== sha256FileBytes(manifestPath)) {
    return false;
  }
  for (const entry of manifest.artifactIndex) {
    const artifactPath = path.join(stagingDir, entry.path);
    if (sha256FileBytes(artifactPath) !== entry.fileSha256) {
      return false;
    }
    const artifactPayload = JSON.parse(readFileSync(artifactPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (computeReportPayloadSha256(artifactPayload) !== entry.payloadSha256) {
      return false;
    }
  }
  const semanticDigest = readFileSync(semanticDigestPath, "utf8").trim();
  const expectedSemanticDigest = computeSemanticSha256Hex({
    contractId: manifest.contractId,
    sourceGitSha: manifest.sourceGitSha,
    artifactPayloadDigests: manifest.artifactIndex.map((entry) => entry.payloadSha256),
  });
  return semanticDigest === expectedSemanticDigest;
}

export function buildDefaultHtrWp23EvidenceBundle(
  preflightResult: HtrReadinessPreflightResult,
  sourceGitSha = readGitCodeSha(),
): HtrWp23EvidenceBundleInput {
  return {
    sourceGitSha,
    sourceDirtyTree: readGitDirtyTree(),
    preflightResult,
  };
}

export function runHtrWp23OfficialEvidenceSeal(
  sourceGitSha: string,
  cwd = process.cwd(),
): HtrWp23OfficialEvidenceSealResult {
  assertHtrWp23EvidenceGitHeadMatches(sourceGitSha);
  assertHtrWp23EvidenceGitTreeClean();
  const stagingDir = assertHtrWp23EvidenceStagingTargetAllowed(sourceGitSha, cwd);
  assertHtrWp23EvidenceStagingTargetWritable(stagingDir);

  const preflightResult = runHtrReadinessPreflight({
    mode: "self-test",
    sourceGitSha,
  });
  assertHtrReadinessPreflightPass(preflightResult);
  if (preflightResult.holdoutNoReadAttestation !== true) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:HOLDOUT_READ_ATTESTATION_FAILED");
  }
  if (preflightResult.noServerMutationAttestation !== true) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:EXECUTION_SERVER_MUTATION_ATTESTATION_FAILED");
  }

  const generatorGitSha = readGitCodeSha();
  const sealed = sealHtrWp23EvidenceStaging({
    sourceGitSha,
    sourceDirtyTree: false,
    preflightResult,
    cwd,
  });

  if (!verifyHtrWp23EvidenceStaging(sealed.stagingDir)) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:INTERNAL_VERIFICATION_FAILED");
  }
  if (scanHtrWp23EvidenceCredentials(sealed.stagingDir)) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:CREDENTIALS_DETECTED");
  }

  const manifestDigest = readFileSync(
    path.join(sealed.stagingDir, "manifest.digest"),
    "utf8",
  ).trim();
  const semanticDigest = readFileSync(
    path.join(sealed.stagingDir, "semantic.digest"),
    "utf8",
  ).trim();

  return {
    stagingDir: sealed.stagingDir,
    sourceGitSha,
    sourceDirtyTree: false,
    generatorGitSha,
    manifestDigest,
    semanticDigest,
    manifestVerification: true,
    semanticVerification: true,
    credentialsDetected: false,
    holdoutRead: false,
    executionServerMutation: false,
    artifactCount: sealed.manifest.artifactIndex.length,
  };
}
