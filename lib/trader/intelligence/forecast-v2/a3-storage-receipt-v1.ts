import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";

import type { A3PhaseIdentityLayersV1 } from "./a3-storage-contract-v1";
import type { A3ObservedPackageSurfaceProofV1 } from "./a3-observed-package-surface-v1";
import type { A3PostgresMeasurementEnvironmentV1 } from "./a3-postgres-measurement-environment-v1";
import type { A3ExactRationalAggregateMathV1 } from "./a3-storage-rational-arithmetic-v1";
import type {
  ForecastV2FixedV2ClassificationItem,
  ForecastV2RelationSizeBreakdown,
} from "./storage-scale-postgres-v1";

export const A3_PHASE01_RECEIPT_VERSION = "a3-phase-01-receipt/v2" as const;
export const A3_PHASE02_RECEIPT_VERSION = "a3-phase-02-receipt/v2" as const;
export const A3_PHASE03_RECEIPT_VERSION = "a3-phase-03-receipt/v1" as const;
export const A3_AGGREGATE_RECEIPT_VERSION = "a3-aggregate-receipt/v2" as const;

export type A3ReceiptProvenanceV1 = {
  localHead: string;
  worktreeProvenanceDigest: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  logPath: string;
  pid: number;
};

export type A3Phase01ReceiptV1 = {
  schemaVersion: typeof A3_PHASE01_RECEIPT_VERSION;
  a3CanonicalContractDigest: string;
  storageSurfaceDigest: string;
  phaseImplementationDigest: string;
  worktreeProvenanceDigest: string;
  provenance: A3ReceiptProvenanceV1;
  receiptContentDigestHex: string;
  measuredAt: string;
  postgresServerVersion: string;
  postgresMeasurementEnvironment: A3PostgresMeasurementEnvironmentV1;
  appliedMigrationRange: { min: number; max: number; count: number };
  relationInventoryDigestHex: string;
  expectedPackageSurfaceDigestHex: string;
  observedPackageSurfaceDigestHex: string;
  observedPackageContractConforms: boolean;
  observedPackageSurface: A3ObservedPackageSurfaceProofV1;
  b0Bytes: number;
  phase01PackageFixedBytes: number;
  packageFixedRelationBreakdown: readonly ForecastV2RelationSizeBreakdown[];
  b1Bytes: number;
  grossDeltaBytes: number;
  nBundles: number;
  rowCounts: Record<string, number>;
  b0RelationBreakdown: readonly ForecastV2RelationSizeBreakdown[];
  b1RelationBreakdown: readonly ForecastV2RelationSizeBreakdown[];
  /**
   * Structural measurement validity / run completion only.
   * MUST NOT mean final canonical STORAGE_ACCEPTANCE_PASS (needs PHASE-02 package_fixed).
   */
  pass: boolean;
  /** Explicit phase-01 status — never final storage acceptance. */
  phase01Status: "PHASE01_MEASUREMENT_COMPLETE" | "PHASE01_MEASUREMENT_INVALID";
  /** Always false on phase-01 receipts. */
  finalStorageAcceptancePass: false;
  storageAcceptance: "AWAITING_PHASE02_FIXED_CONTRIBUTION";
  failureReasons: string[];
};

export type A3Phase02ReceiptV1 = {
  schemaVersion: typeof A3_PHASE02_RECEIPT_VERSION;
  a3CanonicalContractDigest: string;
  storageSurfaceDigest: string;
  phaseImplementationDigest: string;
  worktreeProvenanceDigest: string;
  provenance: A3ReceiptProvenanceV1;
  receiptContentDigestHex: string;
  measuredAt: string;
  postgresServerVersion: string;
  postgresMeasurementEnvironment: A3PostgresMeasurementEnvironmentV1;
  phase2FreshDatabaseLiteral: true;
  expectedPackageSurfaceDigestHex: string;
  observedPackageSurfaceDigestHex: string;
  observedPackageContractConforms: boolean;
  observedPackageSurface: A3ObservedPackageSurfaceProofV1;
  phase2EmptyBytes: number;
  phase2FullBytes: number;
  phase2PackageFixedContributionBytes: number;
  packageFixedRelationBreakdown: readonly ForecastV2RelationSizeBreakdown[];
  packageRawReplicaPayloadBytes: number;
  phase2RelationBreakdown: readonly ForecastV2RelationSizeBreakdown[];
  enumeratedFixedV2OtherItems: readonly ForecastV2FixedV2ClassificationItem[];
  enumeratedFixedV2OtherBytes: number;
  pass: boolean;
  failureReasons: string[];
};

export type A3Phase03ReceiptV1 = {
  schemaVersion: typeof A3_PHASE03_RECEIPT_VERSION;
  a3CanonicalContractDigest: string;
  phaseImplementationDigest: string;
  worktreeProvenanceDigest: string;
  provenance: A3ReceiptProvenanceV1;
  receiptContentDigestHex: string;
  measuredAt: string;
  n1Bundles: number;
  n2Bundles: number;
  checkpointBytesAtN1: number;
  checkpointBytesAtN2: number;
  checkpointSessionBytes: number;
  maxGrowthBytesPerCycle: number;
  supportedCheckpointEnvelopeBytes: number;
  bundleHistoryInFhvHotCheckpointPath: false;
  bounded: boolean;
  evidence: string;
  pass: boolean;
  failureReasons: string[];
};

export type A3AggregateReceiptV1 = {
  schemaVersion: typeof A3_AGGREGATE_RECEIPT_VERSION;
  a3CanonicalContractDigest: string;
  storageSurfaceDigest: string;
  aggregateImplementationDigest: string;
  worktreeProvenanceDigest: string;
  provenance: A3ReceiptProvenanceV1;
  receiptContentDigestHex: string;
  measuredAt: string;
  expectedPackageSurfaceDigestHex: string;
  observedPackageSurfaceDigestHex: string;
  postgresMeasurementEnvironmentDigest: string;
  phase01PackageFixedBytes: number;
  phase02PackageFixedContributionBytes: number;
  exactRationalMath: A3ExactRationalAggregateMathV1;
  enumeratedFixedV2OtherBytes: number;
  b0Bytes: number;
  b1Bytes: number;
  grossDeltaBytes: number;
  nBundles: number;
  phaseReceiptDigests: {
    phase01: string;
    phase02: string;
    phase03: string;
  };
  phaseImplementationDigests: {
    phase01: string;
    phase02: string;
    phase03: string;
  };
  verdict: "A3_STORAGE_SCALE_PASS" | "A3_STORAGE_SCALE_FAIL";
  pass: boolean;
  failureReasons: string[];
};

function digestReceiptBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function attachReceiptDigest<T extends Record<string, unknown>>(
  receipt: T,
): T & { receiptContentDigestHex: string } {
  const body = { ...receipt } as Record<string, unknown>;
  delete body.receiptContentDigestHex;
  const serialized = JSON.stringify(body);
  return {
    ...body,
    receiptContentDigestHex: digestReceiptBody(serialized),
  } as T & { receiptContentDigestHex: string };
}

export function writeA3ReceiptAtomic<T extends Record<string, unknown>>(
  directory: string,
  filename: string,
  receipt: T,
): T & { receiptContentDigestHex: string } {
  mkdirSync(directory, { recursive: true });
  const withDigest = attachReceiptDigest(receipt);
  const serialized = `${JSON.stringify(withDigest, null, 2)}\n`;
  const tmpPath = join(directory, `${filename}.tmp`);
  const finalPath = join(directory, filename);
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, serialized);
    closeSync(fd);
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  renameSync(tmpPath, finalPath);
  return withDigest;
}

export function readA3ReceiptFile<T>(path: string): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`[a3-receipt] missing receipt at ${path}`);
  }
  const parsed = JSON.parse(raw) as T & { receiptContentDigestHex: string };
  const { receiptContentDigestHex, ...body } = parsed;
  const expected = digestReceiptBody(JSON.stringify(body));
  if (expected !== receiptContentDigestHex) {
    throw new Error(`[a3-receipt] corrupt receipt digest at ${path}`);
  }
  return parsed;
}

export function a3ReceiptPath(directory: string, filename: string): string {
  return join(directory, filename);
}

function assertLoadBearingPhase01Fields(receipt: A3Phase01ReceiptV1): string[] {
  const failures: string[] = [];
  if (!receipt.observedPackageContractConforms) {
    failures.push("phase-01 observed package contract non-conformance");
  }
  if (receipt.phase01PackageFixedBytes <= 0) {
    failures.push("phase-01 package fixed bytes missing");
  }
  if (
    receipt.observedPackageSurfaceDigestHex !==
    receipt.observedPackageSurface.observedPackageSurfaceDigestHex
  ) {
    failures.push("phase-01 observed digest mismatch");
  }
  return failures;
}

export function validateA3Phase01Receipt(
  receipt: A3Phase01ReceiptV1,
  identity: Pick<
    A3PhaseIdentityLayersV1,
    "a3CanonicalContractDigest" | "storageSurfaceDigest" | "phaseImplementationDigests"
  >,
): void {
  if (receipt.schemaVersion !== A3_PHASE01_RECEIPT_VERSION) {
    throw new Error("[a3-receipt] invalid phase-01 schema");
  }
  if (receipt.a3CanonicalContractDigest !== identity.a3CanonicalContractDigest) {
    throw new Error("[a3-receipt] phase-01 canonical contract digest mismatch");
  }
  if (receipt.storageSurfaceDigest !== identity.storageSurfaceDigest) {
    throw new Error("[a3-receipt] phase-01 storage surface digest mismatch");
  }
  if (receipt.phaseImplementationDigest !== identity.phaseImplementationDigests.phase01) {
    throw new Error("[a3-receipt] phase-01 implementation digest mismatch");
  }
  if (!receipt.pass) {
    throw new Error("[a3-receipt] phase-01 receipt not marked measurement-valid");
  }
  if (receipt.finalStorageAcceptancePass !== false) {
    throw new Error("[a3-receipt] phase-01 must not claim final storage acceptance");
  }
  if (receipt.storageAcceptance !== "AWAITING_PHASE02_FIXED_CONTRIBUTION") {
    throw new Error("[a3-receipt] phase-01 must await PHASE-02 package_fixed contribution");
  }
  if (
    receipt.phase01Status !== "PHASE01_MEASUREMENT_COMPLETE" &&
    receipt.phase01Status !== "PHASE01_MEASUREMENT_INVALID"
  ) {
    throw new Error("[a3-receipt] phase-01 status missing");
  }
  if (receipt.pass && receipt.phase01Status !== "PHASE01_MEASUREMENT_COMPLETE") {
    throw new Error("[a3-receipt] phase-01 pass/status mismatch");
  }
  const loadBearing = assertLoadBearingPhase01Fields(receipt);
  if (loadBearing.length > 0) {
    throw new Error(`[a3-receipt] ${loadBearing.join("; ")}`);
  }
}

export function validateA3Phase02Receipt(
  receipt: A3Phase02ReceiptV1,
  identity: Pick<
    A3PhaseIdentityLayersV1,
    "a3CanonicalContractDigest" | "storageSurfaceDigest" | "phaseImplementationDigests"
  >,
): void {
  if (receipt.schemaVersion !== A3_PHASE02_RECEIPT_VERSION) {
    throw new Error("[a3-receipt] invalid phase-02 schema");
  }
  if (receipt.a3CanonicalContractDigest !== identity.a3CanonicalContractDigest) {
    throw new Error("[a3-receipt] phase-02 canonical contract digest mismatch");
  }
  if (receipt.storageSurfaceDigest !== identity.storageSurfaceDigest) {
    throw new Error("[a3-receipt] phase-02 storage surface digest mismatch");
  }
  if (receipt.phaseImplementationDigest !== identity.phaseImplementationDigests.phase02) {
    throw new Error("[a3-receipt] phase-02 implementation digest mismatch");
  }
  if (!receipt.observedPackageContractConforms) {
    throw new Error("[a3-receipt] phase-02 observed package contract non-conformance");
  }
  if (receipt.phase2PackageFixedContributionBytes <= 0) {
    throw new Error("[a3-receipt] phase-02 package fixed contribution missing");
  }
  if (!receipt.pass) {
    throw new Error("[a3-receipt] phase-02 receipt not marked pass");
  }
}

export function validateA3Phase03Receipt(
  receipt: A3Phase03ReceiptV1,
  identity: Pick<
    A3PhaseIdentityLayersV1,
    "a3CanonicalContractDigest" | "phaseImplementationDigests"
  >,
): void {
  if (receipt.schemaVersion !== A3_PHASE03_RECEIPT_VERSION) {
    throw new Error("[a3-receipt] invalid phase-03 schema");
  }
  if (receipt.a3CanonicalContractDigest !== identity.a3CanonicalContractDigest) {
    throw new Error("[a3-receipt] phase-03 canonical contract digest mismatch");
  }
  if (receipt.phaseImplementationDigest !== identity.phaseImplementationDigests.phase03) {
    throw new Error("[a3-receipt] phase-03 implementation digest mismatch");
  }
  if (!receipt.pass || !receipt.bounded) {
    throw new Error("[a3-receipt] phase-03 receipt not marked pass");
  }
}

export function validateStoredPhase01ReceiptAgainstCurrentIdentity(
  receipt: A3Phase01ReceiptV1,
  current: A3PhaseIdentityLayersV1,
): void {
  if (receipt.a3CanonicalContractDigest !== current.a3CanonicalContractDigest) {
    throw new Error("[a3-receipt] stored phase-01 canonical contract incompatible");
  }
  if (receipt.storageSurfaceDigest !== current.storageSurfaceDigest) {
    throw new Error("[a3-receipt] stored phase-01 storage surface incompatible");
  }
}

export function validateStoredPhase02ReceiptAgainstCurrentIdentity(
  receipt: A3Phase02ReceiptV1,
  current: A3PhaseIdentityLayersV1,
): void {
  if (receipt.a3CanonicalContractDigest !== current.a3CanonicalContractDigest) {
    throw new Error("[a3-receipt] stored phase-02 canonical contract incompatible");
  }
  if (receipt.storageSurfaceDigest !== current.storageSurfaceDigest) {
    throw new Error("[a3-receipt] stored phase-02 storage surface incompatible");
  }
}

export function validateStoredPhase03ReceiptAgainstCurrentIdentity(
  receipt: A3Phase03ReceiptV1,
  current: A3PhaseIdentityLayersV1,
): void {
  if (receipt.a3CanonicalContractDigest !== current.a3CanonicalContractDigest) {
    throw new Error("[a3-receipt] stored phase-03 canonical contract incompatible");
  }
}
