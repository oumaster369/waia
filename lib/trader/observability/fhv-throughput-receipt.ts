import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  FHV_CANONICAL_MAX_RUNTIME_S,
  FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
} from "@/lib/trader/observability/fhv-growth-law";
import type { FhvBoundednessClassification } from "@/lib/trader/observability/fhv-bounded-hot-state";
import type { FhvThroughputQualifierSamplerContract } from "@/lib/trader/observability/fhv-throughput-sampler";
import {
  assertCanonicalFhvThroughputSamplerContract,
  FhvThroughputSamplerContractError,
  FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES,
  FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS,
  FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES,
} from "@/lib/trader/observability/fhv-throughput-sampler";

/**
 * Canonical reader for the Execution Server throughput host-qualification receipt (ADR-0025 AD-6b).
 *
 * The 877 cps / 7200 s terminal and 6480 s pre-launch contracts are unchanged. Absolute wall speed
 * is authoritative only on the target host. Reading is fail-closed on every axis the writer binds.
 * Environment variables never enter this function. Unbound v1 receipts cannot qualify a new launch.
 */

export const FHV_THROUGHPUT_RECEIPT_SCHEMA = "fhv-throughput-host-qualification/v2" as const;
export const FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION =
  "EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED" as const;
export const FHV_THROUGHPUT_NOT_QUALIFIED_CLASSIFICATION =
  "EXECUTION_SERVER_FHV_THROUGHPUT_NOT_QUALIFIED" as const;
export const FHV_THROUGHPUT_EVIDENCE_INVALID_CLASSIFICATION =
  "EXECUTION_SERVER_FHV_THROUGHPUT_EVIDENCE_INVALID" as const;
export const FHV_THROUGHPUT_RECEIPT_FILENAME = "fhv-throughput-host-qualification.v2.json" as const;
export const FHV_THROUGHPUT_RECEIPT_LEGACY_V1_FILENAME =
  "fhv-throughput-host-qualification.v1.json" as const;
/** Canonical absolute floor; embedded in and validated against every receipt. */
export const FHV_THROUGHPUT_MIN_CPS = 877;

export class FhvThroughputReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvThroughputReceiptError";
  }
}

export type FhvThroughputReceiptV2 = Readonly<{
  schemaVersion: typeof FHV_THROUGHPUT_RECEIPT_SCHEMA;
  capturedAtUtc: string;
  releaseSha: string;
  host: Readonly<{
    hostname: string;
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCount?: number;
    nodeVersion?: string;
  }>;
  contract: Readonly<{
    minThroughputCps: number;
    canonicalMaxRuntimeS: number;
    prelaunchMaxProjectedRuntimeS: number;
  }>;
  samplerContract: FhvThroughputQualifierSamplerContract;
  evidence: Readonly<{
    representativeSegmentExecuted: boolean;
    progressSamples: number;
    checkpointSamples: number;
    boundednessClassification: FhvBoundednessClassification;
    diagnosticGrowthBytesPerCycle: number;
    hotPathDecayVerdict: "FLAT" | "DECAYING" | "INSUFFICIENT_SAMPLES";
    growthAwareProjectionAvailable: boolean;
    growthAwareProjectedRuntimeS: number;
    progressBytesSha256: string;
    growthLawReportDigest: string;
    checkoutHeadSha: string;
    producerHeadSha: string;
    producerBindingDigest: string;
  }>;
  classification:
    | typeof FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION
    | typeof FHV_THROUGHPUT_NOT_QUALIFIED_CLASSIFICATION
    | typeof FHV_THROUGHPUT_EVIDENCE_INVALID_CLASSIFICATION;
  receiptDigest: string;
}>;

function fail(code: string, message: string): never {
  throw new FhvThroughputReceiptError(code, message);
}

/**
 * Read and fully validate a throughput host-qualification receipt, or throw.
 *
 * Every check corresponds to a way a host could produce a file that superficially looks like a pass
 * while failing the actual contract. Environment variables never enter this function.
 */
export function assertFhvThroughputHostQualified(input: {
  receiptPath: string;
  /** When supplied, the receipt must have been produced by this release. */
  expectedReleaseSha?: string;
}): FhvThroughputReceiptV2 {
  if (!existsSync(input.receiptPath)) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_MISSING",
      `Throughput host qualification receipt missing at ${input.receiptPath}; run pnpm trader:fhv:throughput-host-qualification on the target host`,
    );
  }
  if (input.receiptPath.endsWith(FHV_THROUGHPUT_RECEIPT_LEGACY_V1_FILENAME)) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_SCHEMA_UNSUPPORTED",
      `legacy ${FHV_THROUGHPUT_RECEIPT_LEGACY_V1_FILENAME} cannot qualify a new official launch`,
    );
  }

  const raw = readFileSync(input.receiptPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_MALFORMED",
      `Throughput receipt at ${input.receiptPath} is not valid JSON: ${String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_MALFORMED",
      `Throughput receipt at ${input.receiptPath} is not an object`,
    );
  }
  const receipt = parsed as Partial<FhvThroughputReceiptV2> & Record<string, unknown>;

  if (receipt.schemaVersion !== FHV_THROUGHPUT_RECEIPT_SCHEMA) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_SCHEMA_UNSUPPORTED",
      `Throughput receipt schema ${String(receipt.schemaVersion)} != ${FHV_THROUGHPUT_RECEIPT_SCHEMA}`,
    );
  }

  const { receiptDigest, ...body } = receipt as FhvThroughputReceiptV2 & Record<string, unknown>;
  if (typeof receiptDigest !== "string" || receiptDigest.length !== 64) {
    fail("FHV_THROUGHPUT_RECEIPT_DIGEST_MISSING", "Throughput receipt has no valid receiptDigest");
  }
  const recomputed = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  if (recomputed !== receiptDigest) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_DIGEST_MISMATCH",
      `Throughput receipt digest mismatch: recomputed ${recomputed} != recorded ${receiptDigest}`,
    );
  }

  if (input.expectedReleaseSha && receipt.releaseSha !== input.expectedReleaseSha) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_RELEASE_MISMATCH",
      `Throughput receipt releaseSha ${String(receipt.releaseSha)} != launch release ${input.expectedReleaseSha}`,
    );
  }
  if (receipt.evidence?.checkoutHeadSha !== receipt.releaseSha) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_CHECKOUT_RELEASE_MISMATCH",
      `Throughput receipt checkoutHeadSha ${String(receipt.evidence?.checkoutHeadSha)} != releaseSha ${String(receipt.releaseSha)}`,
    );
  }
  if (receipt.evidence?.producerHeadSha !== receipt.releaseSha) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_PRODUCER_RELEASE_MISMATCH",
      `Throughput receipt producerHeadSha ${String(receipt.evidence?.producerHeadSha)} != releaseSha ${String(receipt.releaseSha)}`,
    );
  }
  if (
    typeof receipt.evidence?.producerBindingDigest !== "string" ||
    receipt.evidence.producerBindingDigest.length !== 64
  ) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_PRODUCER_BINDING_MISSING",
      "Throughput receipt is missing producerBindingDigest",
    );
  }
  if (!receipt.host?.hostname?.trim()) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_HOST_IDENTITY_MISSING",
      "Throughput receipt has no host identity binding",
    );
  }

  if (
    receipt.contract?.minThroughputCps !== FHV_THROUGHPUT_MIN_CPS ||
    receipt.contract?.canonicalMaxRuntimeS !== FHV_CANONICAL_MAX_RUNTIME_S ||
    receipt.contract?.prelaunchMaxProjectedRuntimeS !== FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S
  ) {
    fail(
      "FHV_THROUGHPUT_CONTRACT_MISMATCH",
      `Throughput receipt contract ${JSON.stringify(receipt.contract)} does not match canonical 877/7200/6480`,
    );
  }

  try {
    assertCanonicalFhvThroughputSamplerContract(receipt.samplerContract);
  } catch (error) {
    if (error instanceof FhvThroughputSamplerContractError) {
      fail(error.code, error.message);
    }
    throw error;
  }

  const evidence = receipt.evidence;
  if (!evidence) {
    fail("FHV_THROUGHPUT_EVIDENCE_MISSING", "Throughput receipt has no evidence block");
  }
  if (!evidence.representativeSegmentExecuted) {
    fail(
      "FHV_THROUGHPUT_SEGMENT_NOT_EXECUTED",
      "Throughput receipt does not prove a representative segment actually executed",
    );
  }
  if (
    (evidence.progressSamples ?? 0) < FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES ||
    (evidence.checkpointSamples ?? 0) < FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES
  ) {
    fail(
      "FHV_THROUGHPUT_INSUFFICIENT_EVIDENCE",
      `Throughput receipt has progressSamples=${String(evidence.progressSamples)} checkpointSamples=${String(evidence.checkpointSamples)}`,
    );
  }
  if (evidence.boundednessClassification !== "BOUNDED") {
    fail(
      "FHV_THROUGHPUT_BOUNDEDNESS_NOT_BOUNDED",
      `Throughput receipt boundedness ${String(evidence.boundednessClassification)} != BOUNDED`,
    );
  }
  if (evidence.hotPathDecayVerdict !== "FLAT") {
    fail(
      "FHV_THROUGHPUT_HOT_PATH_DECAYING",
      `Throughput receipt hot-path decay verdict ${String(evidence.hotPathDecayVerdict)} != FLAT`,
    );
  }
  if (
    typeof evidence.progressBytesSha256 !== "string" ||
    evidence.progressBytesSha256.length !== 64 ||
    typeof evidence.growthLawReportDigest !== "string" ||
    evidence.growthLawReportDigest.length !== 64
  ) {
    fail(
      "FHV_THROUGHPUT_EVIDENCE_DIGEST_MISSING",
      "Throughput receipt is missing progress or growth-law report digests",
    );
  }
  if (!evidence.growthAwareProjectionAvailable) {
    fail(
      "FHV_THROUGHPUT_PROJECTION_UNAVAILABLE",
      "Throughput receipt has no growth-aware projection",
    );
  }
  if (
    !Number.isFinite(evidence.growthAwareProjectedRuntimeS) ||
    evidence.growthAwareProjectedRuntimeS > FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S
  ) {
    fail(
      "FHV_THROUGHPUT_PROJECTION_EXCEEDS_6480S",
      `Throughput receipt growth-aware projected runtime ${String(evidence.growthAwareProjectedRuntimeS)} s > ${FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S} s`,
    );
  }

  if (receipt.classification !== FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION) {
    fail(
      "FHV_THROUGHPUT_NOT_QUALIFIED",
      `Throughput receipt classification ${String(receipt.classification)} != ${FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION}`,
    );
  }

  return receipt as FhvThroughputReceiptV2;
}

export {
  FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES,
  FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS,
  FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES,
};
