/**
 * DEE-436 — workstation-side T4A phase receipts (immutable, ordered).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";

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
  legacyContainerName: string;
  legacyContainerImage: string;
  bootstrapBlobDigests: Readonly<Record<string, string>>;
  bindingDigest: string;
  preauthRemoteWriteCount: number;
  completedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4aPostBeforeReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_POST_BEFORE_RECEIPT_SCHEMA;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  runDir: string;
  continuityBeforePath: string;
  continuityBeforeDigest: string;
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
  continuityAfterPath: string;
  continuityAfterDigest: string;
  ceremonyClassifications: Readonly<Record<string, string>>;
  stepProofDigests: Readonly<Record<string, string>>;
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

export function fhvT4aBindingDigest(input: Readonly<Record<string, string>>): string {
  return sha256Hex(JSON.stringify(input, Object.keys(input).sort()));
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

export function fhvT4aPhaseReceiptPath(localStateDir: string, name: string): string {
  return join(localStateDir, name);
}

export function writeFhvT4aLocalReleaseReceipt(
  localStateDir: string,
  input: Omit<FhvT4aLocalReleaseReceiptV1, "schemaVersion" | "contentDigest" | "completedAtUtc">,
): FhvT4aLocalReleaseReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-local-release-receipt.v1.json");
  assertReceiptNotExists(path, "PHASE_RECEIPT_OVERWRITE_ALLOWED");
  const receipt = withDigest<FhvT4aLocalReleaseReceiptV1>({
    schemaVersion: FHV_T4A_LOCAL_RELEASE_RECEIPT_SCHEMA,
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeFileSync(path, `${JSON.stringify(receipt)}\n`);
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
  const receipt = JSON.parse(readFileSync(path, "utf8")) as FhvT4aLocalReleaseReceiptV1;
  if (receipt.schemaVersion !== FHV_T4A_LOCAL_RELEASE_RECEIPT_SCHEMA) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_LOCAL_RELEASE_RECEIPT_INVALID", "schema mismatch.");
  }
  const { contentDigest, ...body } = receipt;
  if (computePayloadDigest(body) !== contentDigest) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_LOCAL_RELEASE_RECEIPT_DIGEST", "digest mismatch.");
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
  assertReceiptNotExists(path, "PHASE_RECEIPT_OVERWRITE_ALLOWED");
  const receipt = withDigest<FhvT4aPreauthReceiptV1>({
    schemaVersion: FHV_T4A_PREAUTH_RECEIPT_SCHEMA,
    ...input,
    legacyContainerName: FHV_T4A_LEGACY_CONTAINER_NAME,
    legacyContainerImage: FHV_T4A_LEGACY_CONTAINER_IMAGE,
    completedAtUtc: new Date().toISOString(),
  });
  writeFileSync(path, `${JSON.stringify(receipt)}\n`);
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
  const receipt = JSON.parse(readFileSync(path, "utf8")) as FhvT4aPreauthReceiptV1;
  if (receipt.schemaVersion !== FHV_T4A_PREAUTH_RECEIPT_SCHEMA) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_PREAUTH_RECEIPT_INVALID", "schema mismatch.");
  }
  const { contentDigest, ...body } = receipt;
  if (computePayloadDigest(body) !== contentDigest) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_PREAUTH_RECEIPT_DIGEST", "digest mismatch.");
  }
  if (receipt.preauthRemoteWriteCount !== 0) {
    throw new FhvT4aPhaseReceiptError(
      "FHV_T4A_PREAUTH_REMOTE_WRITES",
      `PRE_AUTH remote write count must be 0, got ${receipt.preauthRemoteWriteCount}.`,
    );
  }
  if (expectedBindingDigest && receipt.bindingDigest !== expectedBindingDigest) {
    throw new FhvT4aPhaseReceiptError(
      "PHASE_RECEIPT_FULL_BINDING_GAP",
      "PRE_AUTH receipt binding digest mismatch.",
    );
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
  assertReceiptNotExists(path, "PHASE_RECEIPT_OVERWRITE_ALLOWED");
  const receipt = withDigest<FhvT4aPostBeforeReceiptV1>({
    schemaVersion: FHV_T4A_POST_BEFORE_RECEIPT_SCHEMA,
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeFileSync(path, `${JSON.stringify(receipt)}\n`);
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
  const receipt = JSON.parse(readFileSync(path, "utf8")) as FhvT4aPostBeforeReceiptV1;
  const { contentDigest, ...body } = receipt;
  if (computePayloadDigest(body) !== contentDigest) {
    throw new FhvT4aPhaseReceiptError("FHV_T4A_POST_BEFORE_RECEIPT_DIGEST", "digest mismatch.");
  }
  return receipt;
}

export function writeFhvT4aPostFinalizeReceipt(
  localStateDir: string,
  input: Omit<FhvT4aPostFinalizeReceiptV1, "schemaVersion" | "contentDigest" | "completedAtUtc">,
): FhvT4aPostFinalizeReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aPhaseReceiptPath(localStateDir, "fhv-t4a-post-finalize-receipt.v1.json");
  assertReceiptNotExists(path, "PHASE_RECEIPT_OVERWRITE_ALLOWED");
  const receipt = withDigest<FhvT4aPostFinalizeReceiptV1>({
    schemaVersion: FHV_T4A_POST_FINALIZE_RECEIPT_SCHEMA,
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeFileSync(path, `${JSON.stringify(receipt)}\n`);
  return receipt;
}

export function digestFile(path: string): string {
  return sha256Hex(readFileSync(path, "utf8"));
}
