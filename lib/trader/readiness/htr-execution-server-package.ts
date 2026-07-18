import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { createHtrHistoricalCostModelAuthorityV1 } from "@/lib/trader/execution/htr-historical-cost-model-authority";
import {
  HTR_FHV_RUN_CONTRACT_V0,
  computeHtrFhvRunContractDigest,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { HTR_OPERATOR_REPORT_SCHEMA_VERSION } from "@/lib/trader/readiness/htr-operator-report-schema.v1";

export const HTR_EXECUTION_SERVER_PACKAGE_SCHEMA_VERSION =
  "htr-execution-server-code-ready-package/v1" as const;

export const HTR_EXECUTION_SERVER_PACKAGE_MODE = "option-a-code-ready" as const;

export type HtrExecutionServerPackageAttestation = Readonly<{
  actualServerMutation: "PROHIBITED";
  holdoutRead: "PROHIBITED";
  blindHoldoutStatus: "SEALED_NOT_ACCESSED";
  datasetAcquisitionRequiredBeforeActualFhv: true;
  deploymentQualificationDeferred: true;
}>;

export type HtrExecutionServerResourceAssumption = Readonly<{
  id: string;
  description: string;
  minimumMemoryGb: number;
  minimumDiskGb: number;
  networkEgress: "HTX_MARKET_DATA_AND_POSTGRES_ONLY";
}>;

export type HtrExecutionServerCommandReference = Readonly<{
  id: string;
  classification: "READ_ONLY" | "HUMAN_ONLY_MUTATION";
  path: string;
  purpose: string;
}>;

export type HtrExecutionServerPackageManifestV1 = Readonly<{
  schemaVersion: typeof HTR_EXECUTION_SERVER_PACKAGE_SCHEMA_VERSION;
  packageMode: typeof HTR_EXECUTION_SERVER_PACKAGE_MODE;
  packageId: "HTR-WP23-EXECUTION-SERVER-CODE-READY";
  fhvRunContractDigest: string;
  costModelDigest: string;
  operatorReportSchemaVersion: typeof HTR_OPERATOR_REPORT_SCHEMA_VERSION;
  attestation: HtrExecutionServerPackageAttestation;
  resourceAssumptions: readonly HtrExecutionServerResourceAssumption[];
  commandReferences: readonly HtrExecutionServerCommandReference[];
  checkpointEvidencePaths: readonly string[];
  operatorRunbookPath: "docs/ops/HISTORICAL-TEST-READINESS-RUNBOOK.md";
  packageDocPath: "docs/ops/HTR-EXECUTION-SERVER-CODE-READY-PACKAGE.md";
  executionServerRunbookPath: "docs/ops/EXECUTION-SERVER-RUNBOOK.md";
  requiredConfirmationTokens: readonly string[];
}>;

export const HTR_EXECUTION_SERVER_PACKAGE_ATTESTATION: HtrExecutionServerPackageAttestation = {
  actualServerMutation: "PROHIBITED",
  holdoutRead: "PROHIBITED",
  blindHoldoutStatus: "SEALED_NOT_ACCESSED",
  datasetAcquisitionRequiredBeforeActualFhv: true,
  deploymentQualificationDeferred: true,
};

export const HTR_EXECUTION_SERVER_RESOURCE_ASSUMPTIONS: readonly HtrExecutionServerResourceAssumption[] =
  [
    {
      id: "exec-host-baseline",
      description:
        "Dedicated execution host with pinned git SHA checkout, Docker build capability, and Postgres session-mode connectivity.",
      minimumMemoryGb: 16,
      minimumDiskGb: 256,
      networkEgress: "HTX_MARKET_DATA_AND_POSTGRES_ONLY",
    },
  ];

export const HTR_EXECUTION_SERVER_COMMAND_REFERENCES: readonly HtrExecutionServerCommandReference[] =
  [
    {
      id: "preflight-read-only",
      classification: "READ_ONLY",
      path: "scripts/ops/execution-server-preflight.sh",
      purpose: "Verify checkout SHA and stale-code guard before any human-operated deploy.",
    },
    {
      id: "sync-human-only",
      classification: "HUMAN_ONLY_MUTATION",
      path: "scripts/ops/execution-server-sync.sh",
      purpose: "Pin host checkout to approved integration SHA (requires --confirm).",
    },
    {
      id: "build-human-only",
      classification: "HUMAN_ONLY_MUTATION",
      path: "scripts/ops/execution-server-build.sh",
      purpose: "Build execution host container image (requires --confirm).",
    },
    {
      id: "deploy-human-only",
      classification: "HUMAN_ONLY_MUTATION",
      path: "scripts/ops/execution-server-deploy.sh",
      purpose: "Deploy execution host container (requires --confirm).",
    },
    {
      id: "htr-readiness-preflight",
      classification: "READ_ONLY",
      path: "scripts/trader/historical-readiness-preflight.ts",
      purpose: "Fail-closed readiness preflight for FHV Run Contract v0 pinning.",
    },
  ];

export const HTR_EXECUTION_SERVER_CHECKPOINT_EVIDENCE_PATHS = [
  ".cursor/plans/dee-415-wp23/evidence-staging",
  "replay-runs/RI-P7/htr-wp23-readiness-package",
] as const;

export const HTR_EXECUTION_SERVER_REQUIRED_CONFIRMATION_TOKENS = [
  "CERTIFY-HTR-READY",
  "APPROVE-HTR-FHV-DATASET-SOURCE",
  "APPROVE-HTR-EXECSERVER-PACKAGE-MODE:option-a-code-ready",
] as const;

export function buildHtrExecutionServerPackageManifest(): HtrExecutionServerPackageManifestV1 {
  return {
    schemaVersion: HTR_EXECUTION_SERVER_PACKAGE_SCHEMA_VERSION,
    packageMode: HTR_EXECUTION_SERVER_PACKAGE_MODE,
    packageId: "HTR-WP23-EXECUTION-SERVER-CODE-READY",
    fhvRunContractDigest: computeHtrFhvRunContractDigest(HTR_FHV_RUN_CONTRACT_V0),
    costModelDigest: createHtrHistoricalCostModelAuthorityV1().costModelDigest,
    operatorReportSchemaVersion: HTR_OPERATOR_REPORT_SCHEMA_VERSION,
    attestation: HTR_EXECUTION_SERVER_PACKAGE_ATTESTATION,
    resourceAssumptions: HTR_EXECUTION_SERVER_RESOURCE_ASSUMPTIONS,
    commandReferences: HTR_EXECUTION_SERVER_COMMAND_REFERENCES,
    checkpointEvidencePaths: HTR_EXECUTION_SERVER_CHECKPOINT_EVIDENCE_PATHS,
    operatorRunbookPath: "docs/ops/HISTORICAL-TEST-READINESS-RUNBOOK.md",
    packageDocPath: "docs/ops/HTR-EXECUTION-SERVER-CODE-READY-PACKAGE.md",
    executionServerRunbookPath: "docs/ops/EXECUTION-SERVER-RUNBOOK.md",
    requiredConfirmationTokens: HTR_EXECUTION_SERVER_REQUIRED_CONFIRMATION_TOKENS,
  };
}

export function computeHtrExecutionServerPackageDigest(
  manifest: HtrExecutionServerPackageManifestV1 = buildHtrExecutionServerPackageManifest(),
): string {
  return computeSemanticSha256Hex(manifest as unknown as Record<string, unknown>);
}

export function assertHtrExecutionServerPackageManifest(
  manifest: HtrExecutionServerPackageManifestV1 = buildHtrExecutionServerPackageManifest(),
): void {
  if (manifest.schemaVersion !== HTR_EXECUTION_SERVER_PACKAGE_SCHEMA_VERSION) {
    throw new Error("HTR_WP23_EXEC_SERVER_PACKAGE:SCHEMA_VERSION_MISMATCH");
  }
  if (manifest.packageMode !== HTR_EXECUTION_SERVER_PACKAGE_MODE) {
    throw new Error("HTR_WP23_EXEC_SERVER_PACKAGE:PACKAGE_MODE_MISMATCH");
  }
  if (manifest.attestation.actualServerMutation !== "PROHIBITED") {
    throw new Error("HTR_WP23_EXEC_SERVER_PACKAGE:SERVER_MUTATION_MUST_BE_PROHIBITED");
  }
  if (manifest.attestation.holdoutRead !== "PROHIBITED") {
    throw new Error("HTR_WP23_EXEC_SERVER_PACKAGE:HOLDOUT_READ_MUST_BE_PROHIBITED");
  }
  if (manifest.attestation.blindHoldoutStatus !== "SEALED_NOT_ACCESSED") {
    throw new Error("HTR_WP23_EXEC_SERVER_PACKAGE:BLIND_HOLDOUT_STATUS_INVALID");
  }
  if (manifest.resourceAssumptions.length === 0) {
    throw new Error("HTR_WP23_EXEC_SERVER_PACKAGE:RESOURCE_ASSUMPTIONS_REQUIRED");
  }
  if (manifest.commandReferences.length === 0) {
    throw new Error("HTR_WP23_EXEC_SERVER_PACKAGE:COMMAND_REFERENCES_REQUIRED");
  }
  if (manifest.requiredConfirmationTokens.length === 0) {
    throw new Error("HTR_WP23_EXEC_SERVER_PACKAGE:CONFIRMATION_TOKENS_REQUIRED");
  }
}
