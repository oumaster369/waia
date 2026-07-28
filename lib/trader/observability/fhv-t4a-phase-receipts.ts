/**
 * DEE-436 — workstation-side T4A phase receipts (immutable, ordered).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import { FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS } from "@/lib/trader/observability/fhv-t4-evidence-seal";
import { extractFhvT4aCeremonyClassificationsFromReceipt } from "@/lib/trader/observability/fhv-t4a-ceremony-results";
import type { FhvT4aPreauthLedgerEntry } from "@/lib/trader/observability/fhv-t4a-preauth-ledger";
import {
  assertFhvT4aSupervisorResidualStateSafe,
  fhvT4aSupervisorResidualStateDigest,
  type FhvT4aSupervisorResidualStateProofV1,
} from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";

export const FHV_T4A_LOCAL_RELEASE_RECEIPT_SCHEMA = "fhv-t4a-local-release-receipt/v1" as const;
export const FHV_T4A_PREAUTH_RECEIPT_SCHEMA = "fhv-t4a-preauth-receipt/v1" as const;
export const FHV_T4A_POST_BEFORE_RECEIPT_SCHEMA = "fhv-t4a-post-before-receipt/v1" as const;
export const FHV_T4A_POST_FINALIZE_RECEIPT_SCHEMA = "fhv-t4a-post-finalize-receipt/v1" as const;

export class FhvT4aPhaseReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aPhaseReceiptError";
  }
}

export type FhvT4aPreflightHostFactsV1 = Readonly<{
  hostname: string;
  machineIdSha256: string;
  serviceUser: string;
  serviceUid: number;
  serviceGid: number;
  servicePrimaryGroup: string;
  environmentFile: string;
  artifactRoot: string;
  checkoutParent: string;
  nodeBin: string;
  corepackBin: string;
  gitBin: string;
  pythonBin: string;
  dockerBin: string;
  systemctlBin: string;
  systemdAnalyzeBin: string;
  legacyContainerName: string;
  legacyContainerImage: string;
  legacyContainerState: string;
  hostBootId: string;
  minimumFreeKiB: number;
  observedFreeKiB: number;
  hostMonotonicSample: Readonly<Record<string, unknown>>;
}>;

export type FhvT4aLocalReleaseReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_LOCAL_RELEASE_RECEIPT_SCHEMA;
  targetSha: string;
  releaseTag: string;
  originUrl: string;
  bootstrapBlobDigests: Readonly<Record<string, string>>;
  bindingDigest: string;
  completedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4aPreauthReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_PREAUTH_RECEIPT_SCHEMA;
  targetSha: string;
  releaseTag: string;
  originUrl: string;
  execHost: string;
  sshUser: string;
  expectedHostname: string;
  expectedMachineIdSha256: string;
  serviceUser: string;
  serviceUid: number;
  serviceGid: number;
  runId: string;
  organizationId: string;
  nodeBin: string;
  corepackBin: string;
  gitBin: string;
  pythonBin: string;
  dockerBin: string;
  systemctlBin: string;
  systemdAnalyzeBin: string;
  legacyContainerName: string;
  legacyContainerImage: string;
  bootstrapBlobDigests: Readonly<Record<string, string>>;
  bindingDigest: string;
  preauthLedger: readonly FhvT4aPreauthLedgerEntry[];
  preauthLedgerDigest: string;
  rejectedCommandCount: number;
  mutatingCommandCount: number;
  preflightHostFacts: FhvT4aPreflightHostFactsV1;
  supervisorResidualState: FhvT4aSupervisorResidualStateProofV1;
  supervisorResidualStateDigest: string;
  supervisorResidualClassification: string;
  completedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4aPostBeforeReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_POST_BEFORE_RECEIPT_SCHEMA;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  execHost: string;
  sshUser: string;
  bindingDigest: string;
  runDir: string;
  continuityBeforePath: string;
  continuityBeforeDigest: string;
  observerIdentityDigest: string;
  campaignIdentityDigest: string;
  observerQualificationPrePath: string;
  observerQualificationPreDigest: string;
  stepProofDigests: Readonly<Record<string, string>>;
  completedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4aPostFinalizeReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_POST_FINALIZE_RECEIPT_SCHEMA;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  bindingDigest: string;
  postBeforeReceiptDigest: string;
  continuityAfterPath: string;
  continuityAfterDigest: string;
  continuityVerificationProofPath: string;
  continuityVerificationProofDigest: string;
  evidenceSealRootDigest: string;
  evidenceSealManifestDigest: string;
  evidenceSealVerifyClassification: string;
  ceremonyClassifications: Readonly<Record<string, string>>;
  stepProofDigests: Readonly<Record<string, string>>;
  proofDigestBundle: Readonly<Record<string, string>>;
  completedAtUtc: string;
  contentDigest: string;
}>;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function withDigest<T extends { contentDigest: string }>(payload: Omit<T, "contentDigest">): T {
  const contentDigest = computePayloadDigest(payload);
  return { ...payload, contentDigest } as T;
}

function validateReceiptDigest<T extends { contentDigest: string }>(receipt: T, code: string): T {
  const { contentDigest, ...body } = receipt;
  if (computePayloadDigest(body) !== contentDigest) {
    throw new FhvT4aPhaseReceiptError(code, "digest mismatch.");
  }
  return receipt;
}

export function fhvT4aBindingDigest(input: Readonly<Record<string, string>>): string {
  return sha256Hex(JSON.stringify(input, Object.keys(input).sort()));
}

export function fhvT4aPreauthLedgerDigest(entries: readonly FhvT4aPreauthLedgerEntry[]): string {
  return sha256Hex(JSON.stringify(entries));
}

export function fhvT4aFullBindingFields(
  bindings: import("@/scripts/ops/fhv-t4a-operator").FhvT4aOperatorBindings,
): Record<string, string> {
  return {
    execHost: bindings.execHost,
    sshUser: bindings.sshUser,
    expectedHostname: bindings.expectedHostname,
    expectedMachineIdSha256: bindings.expectedMachineIdSha256,
    serviceUser: bindings.serviceUser,
    environmentFile: bindings.environmentFile,
    artifactRoot: bindings.artifactRoot,
    checkoutParent: bindings.checkoutParent,
    localNodeBin: bindings.localNodeBin,
    localGitBin: bindings.localGitBin,
    localSshBin: bindings.localSshBin,
    nodeBin: bindings.nodeBin,
    corepackBin: bindings.corepackBin,
    gitBin: bindings.gitBin,
    pythonBin: bindings.pythonBin,
    dockerBin: bindings.dockerBin,
    systemctlBin: bindings.systemctlBin,
    systemdAnalyzeBin: bindings.systemdAnalyzeBin,
    targetSha: bindings.targetSha,
    releaseTag: bindings.releaseTag,
    originUrl: bindings.originUrl,
    runId: bindings.runId,
    organizationId: bindings.organizationId,
    operatorId: bindings.operatorId,
    legacyContainerName: FHV_T4A_LEGACY_CONTAINER_NAME,
    legacyContainerImage: FHV_T4A_LEGACY_CONTAINER_IMAGE,
  };
}

function assertReceiptNotExists(path: string, code: string): void {
  if (existsSync(path)) {
    throw new FhvT4aPhaseReceiptError(code, `Receipt already exists: ${path}`);
  }
}

function writeReceiptExclusive<T>(path: string, receipt: T): void {
  assertReceiptNotExists(path, "PHASE_RECEIPT_OVERWRITE_ALLOWED");
  writeFileAtomicExclusive(path, `${JSON.stringify(receipt)}\n`);
}

export function fhvT4aPhaseReceiptPath(localStateDir: string, name: string): string {
  return join(localStateDir, name);
}

export function writeFhvT4aLocalReleaseReceipt(
  localStateDir: string,
  input: Omit<FhvT4aLocalReleaseReceiptV1, "schemaVersion" | "contentDigest" | "completedAtUtc">,
): FhvT4aLocalReleaseReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-local-release-receipt.v1.json");
  const receipt = withDigest<FhvT4aLocalReleaseReceiptV1>({
    schemaVersion: FHV_T4A_LOCAL_RELEASE_RECEIPT_SCHEMA,
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeReceiptExclusive(path, receipt);
  return receipt;
}

export function readFhvT4aLocalReleaseReceipt(
  localStateDir: string,
  expectedBindingDigest?: string,
): FhvT4aLocalReleaseReceiptV1 {
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-local-release-receipt.v1.json");
  if (!existsSync(path)) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_LOCAL_RELEASE_RECEIPT_MISSING",
      "Local release receipt missing.",
    );
  }
  const receipt = validateReceiptDigest(
    JSON.parse(readFileSync(path, "utf8")) as FhvT4aLocalReleaseReceiptV1,
    "FHV_T4A_LOCAL_RELEASE_RECEIPT_DIGEST",
  );
  if (receipt.schemaVersion !== FHV_T4A_LOCAL_RELEASE_RECEIPT_SCHEMA) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_LOCAL_RELEASE_RECEIPT_INVALID", "schema mismatch.");
  }
  if (expectedBindingDigest && receipt.bindingDigest !== expectedBindingDigest) {
    throw new FhvT4aPhaseReceiptError(
      "PHASE_RECEIPT_FULL_BINDING_GAP",
      "Local release receipt binding digest mismatch.",
    );
  }
  return receipt;
}

export function writeFhvT4aPreauthReceipt(
  localStateDir: string,
  input: Omit<
    FhvT4aPreauthReceiptV1,
    | "schemaVersion"
    | "contentDigest"
    | "completedAtUtc"
    | "legacyContainerName"
    | "legacyContainerImage"
  >,
): FhvT4aPreauthReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-preauth-receipt.v1.json");
  const receipt = withDigest<FhvT4aPreauthReceiptV1>({
    schemaVersion: FHV_T4A_PREAUTH_RECEIPT_SCHEMA,
    ...input,
    legacyContainerName: FHV_T4A_LEGACY_CONTAINER_NAME,
    legacyContainerImage: FHV_T4A_LEGACY_CONTAINER_IMAGE,
    completedAtUtc: new Date().toISOString(),
  });
  writeReceiptExclusive(path, receipt);
  return receipt;
}

export function readFhvT4aPreauthReceipt(
  localStateDir: string,
  expectedBindingDigest?: string,
): FhvT4aPreauthReceiptV1 {
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-preauth-receipt.v1.json");
  if (!existsSync(path)) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_PREAUTH_RECEIPT_MISSING",
      "PRE_AUTH receipt missing.",
    );
  }
  const receipt = validateReceiptDigest(
    JSON.parse(readFileSync(path, "utf8")) as FhvT4aPreauthReceiptV1,
    "FHV_T4A_PREAUTH_RECEIPT_DIGEST",
  );
  if (receipt.schemaVersion !== FHV_T4A_PREAUTH_RECEIPT_SCHEMA) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_PREAUTH_RECEIPT_INVALID", "schema mismatch.");
  }
  if (receipt.mutatingCommandCount !== 0) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_PREAUTH_REMOTE_WRITES",
      `PRE_AUTH mutating command count must be 0, got ${receipt.mutatingCommandCount}.`,
    );
  }
  if (receipt.rejectedCommandCount !== 0) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_PREAUTH_REJECTED_COMMANDS",
      `PRE_AUTH rejected command count must be 0, got ${receipt.rejectedCommandCount}.`,
    );
  }
  if (fhvT4aPreauthLedgerDigest(receipt.preauthLedger) !== receipt.preauthLedgerDigest) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_PREAUTH_LEDGER_DIGEST_MISMATCH",
      "PRE_AUTH ledger digest mismatch.",
    );
  }
  if (expectedBindingDigest && receipt.bindingDigest !== expectedBindingDigest) {
    throw new FhvT4aPhaseReceiptError(
      "PHASE_RECEIPT_FULL_BINDING_GAP",
      "PRE_AUTH receipt binding digest mismatch.",
    );
  }
  if (
    !receipt.supervisorResidualState ||
    !receipt.supervisorResidualStateDigest ||
    !receipt.supervisorResidualClassification
  ) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_PREAUTH_RESIDUAL_PROOF_MISSING",
      "PRE_AUTH receipt missing supervisor residual-state proof.",
    );
  }
  if (
    fhvT4aSupervisorResidualStateDigest(receipt.supervisorResidualState) !==
    receipt.supervisorResidualStateDigest
  ) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_PREAUTH_RESIDUAL_DIGEST_MISMATCH",
      "PRE_AUTH supervisor residual-state digest mismatch.",
    );
  }
  if (receipt.supervisorResidualClassification !== "FHV_T4A_SUPERVISOR_RESIDUAL_SAFE") {
    throw new FhvT4aPhaseReceiptError(
      receipt.supervisorResidualClassification,
      "PRE_AUTH supervisor residual-state classification is not safe.",
    );
  }
  try {
    assertFhvT4aSupervisorResidualStateSafe(receipt.supervisorResidualState);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as { code: string }).code)
        : "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED";
    throw new FhvT4aPhaseReceiptError(code, "PRE_AUTH residual-state proof is not safe.");
  }
  return receipt;
}

export function assertPreauthReceiptMatches(
  receipt: FhvT4aPreauthReceiptV1,
  expected: Readonly<{
    targetSha: string;
    releaseTag: string;
    originUrl: string;
    runId: string;
    organizationId: string;
  }>,
): void {
  for (const [key, value] of Object.entries(expected)) {
    const actual = receipt[key as keyof typeof expected];
    if (actual !== value) {
      throw new FhvT4aPhaseReceiptError(
        "FHV_T4A_PREAUTH_RECEIPT_IDENTITY_MISMATCH",
        `${key} mismatch.`,
      );
    }
  }
}

export function writeFhvT4aPostBeforeReceipt(
  localStateDir: string,
  input: Omit<FhvT4aPostBeforeReceiptV1, "schemaVersion" | "contentDigest" | "completedAtUtc">,
): FhvT4aPostBeforeReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-post-before-receipt.v1.json");
  const receipt = withDigest<FhvT4aPostBeforeReceiptV1>({
    schemaVersion: FHV_T4A_POST_BEFORE_RECEIPT_SCHEMA,
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeReceiptExclusive(path, receipt);
  return receipt;
}

export function readFhvT4aPostBeforeReceipt(localStateDir: string): FhvT4aPostBeforeReceiptV1 {
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-post-before-receipt.v1.json");
  if (!existsSync(path)) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_POST_BEFORE_RECEIPT_MISSING",
      "POST before receipt missing.",
    );
  }
  const receipt = validateReceiptDigest(
    JSON.parse(readFileSync(path, "utf8")) as FhvT4aPostBeforeReceiptV1,
    "FHV_T4A_POST_BEFORE_RECEIPT_DIGEST",
  );
  if (receipt.schemaVersion !== FHV_T4A_POST_BEFORE_RECEIPT_SCHEMA) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_POST_BEFORE_RECEIPT_INVALID", "schema mismatch.");
  }
  if (
    !receipt.bindingDigest ||
    !receipt.observerIdentityDigest ||
    !receipt.campaignIdentityDigest ||
    !receipt.observerQualificationPrePath ||
    !receipt.observerQualificationPreDigest
  ) {
    throw new FhvT4aPhaseReceiptError(
      "PHASE_RECEIPT_FULL_BINDING_GAP",
      "POST before receipt missing persisted continuity baseline fields.",
    );
  }
  return receipt;
}

export function writeFhvT4aPostFinalizeReceipt(
  localStateDir: string,
  input: Omit<FhvT4aPostFinalizeReceiptV1, "schemaVersion" | "contentDigest" | "completedAtUtc">,
): FhvT4aPostFinalizeReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-post-finalize-receipt.v1.json");
  const receipt = withDigest<FhvT4aPostFinalizeReceiptV1>({
    schemaVersion: FHV_T4A_POST_FINALIZE_RECEIPT_SCHEMA,
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeReceiptExclusive(path, receipt);
  return receipt;
}

export function readFhvT4aPostFinalizeReceipt(localStateDir: string): FhvT4aPostFinalizeReceiptV1 {
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-post-finalize-receipt.v1.json");
  if (!existsSync(path)) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_POST_FINALIZE_RECEIPT_MISSING",
      "POST finalize receipt missing.",
    );
  }
  const receipt = validateReceiptDigest(
    JSON.parse(readFileSync(path, "utf8")) as FhvT4aPostFinalizeReceiptV1,
    "FHV_T4A_POST_FINALIZE_RECEIPT_DIGEST",
  );
  if (receipt.schemaVersion !== FHV_T4A_POST_FINALIZE_RECEIPT_SCHEMA) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_POST_FINALIZE_RECEIPT_INVALID", "schema mismatch.");
  }
  if (!receipt.bindingDigest || !receipt.postBeforeReceiptDigest) {
    throw new FhvT4aPhaseReceiptError(
      "PHASE_RECEIPT_FULL_BINDING_GAP",
      "POST finalize receipt missing binding linkage fields.",
    );
  }
  if (!receipt.evidenceSealRootDigest) {
    throw new FhvT4aPhaseReceiptError(
      "FINAL_RECEIPT_SEAL_ROOT_MISSING",
      "POST finalize receipt missing evidenceSealRootDigest.",
    );
  }
  if (!receipt.evidenceSealManifestDigest) {
    throw new FhvT4aPhaseReceiptError(
      "FINAL_RECEIPT_SEAL_MANIFEST_DIGEST_EMPTY",
      "POST finalize receipt missing evidenceSealManifestDigest.",
    );
  }
  if (
    !receipt.evidenceSealVerifyClassification ||
    receipt.evidenceSealVerifyClassification !== FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS
  ) {
    throw new FhvT4aPhaseReceiptError(
      "FINAL_RECEIPT_VERIFY_SEAL_CLASSIFICATION_EMPTY",
      "POST finalize receipt verify-seal classification invalid.",
    );
  }
  if (!receipt.continuityVerificationProofPath || !receipt.continuityVerificationProofDigest) {
    throw new FhvT4aPhaseReceiptError(
      "FINAL_RECEIPT_CONTINUITY_VERIFICATION_PROOF_MISSING",
      "POST finalize receipt missing continuity verification proof binding.",
    );
  }
  if (!receipt.ceremonyClassifications) {
    throw new FhvT4aPhaseReceiptError(
      "CEREMONY_REQUIRED_FIELD_MISSING",
      "POST finalize receipt missing ceremonyClassifications.",
    );
  }
  try {
    extractFhvT4aCeremonyClassificationsFromReceipt(receipt.ceremonyClassifications);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as { code?: string }).code)
        : "CEREMONY_EXACT_VALUE_NOT_ENFORCED";
    throw new FhvT4aPhaseReceiptError(code, error instanceof Error ? error.message : String(error));
  }
  return receipt;
}

export function digestFile(path: string): string {
  return sha256Hex(readFileSync(path, "utf8"));
}
