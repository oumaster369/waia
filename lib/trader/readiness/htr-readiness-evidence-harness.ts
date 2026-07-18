import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
import type { HtrReadinessPreflightResult } from "@/lib/trader/readiness/htr-readiness-preflight";

export const HTR_WP23_EVIDENCE_INTEGRITY_CONTRACT_ID = "waia.htr.evidence-integrity.v2" as const;
export const HTR_WP23_EVIDENCE_MANIFEST_SCHEMA = "htr-wp23-readiness-evidence-manifest/v1" as const;
export const HTR_WP23_EVIDENCE_STAGING_ROOT = ".cursor/plans/dee-415-wp23/evidence-staging";

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
  const stagingDir = resolveHtrWp23EvidenceStagingDir(bundle.sourceGitSha);
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
