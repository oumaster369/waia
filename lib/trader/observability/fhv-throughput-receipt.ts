import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  FHV_CANONICAL_MAX_RUNTIME_S,
  FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
} from "@/lib/trader/observability/fhv-growth-law";

/**
 * Canonical reader for the Execution Server throughput host-qualification receipt (ADR-0025 AD-6b).
 *
 * The 877 cps / 7200 s terminal and 6480 s pre-launch contracts are unchanged. What changed is where
 * absolute wall speed is authoritative: a GitHub-hosted runner's clock proves software structure, not
 * that the target Execution Server can finish the corpus in time. That absolute proof moves here, as
 * an identity-bound, fail-closed target-host receipt — mirroring the WP-3B checkpoint receipt.
 *
 * Reading must be fail-closed on every axis the writer binds. A receipt that claims QUALIFIED while
 * its own growth-aware projection exceeds 6480 s, or whose digest disagrees, is not evidence.
 */

export const FHV_THROUGHPUT_RECEIPT_SCHEMA = "fhv-throughput-host-qualification/v1" as const;
export const FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION =
  "EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED" as const;
export const FHV_THROUGHPUT_RECEIPT_FILENAME = "fhv-throughput-host-qualification.v1.json" as const;
/** Canonical absolute floor; embedded in and validated against every receipt. */
export const FHV_THROUGHPUT_MIN_CPS = 877;
/** Minimum progress/checkpoint samples a qualifying representative run must record. */
export const FHV_THROUGHPUT_MIN_PROGRESS_SAMPLES = 2;
/** Bounded hot-state structural growth ceiling (bytes/cycle), mirroring WP-7B. */
export const FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE = 160;

export class FhvThroughputReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvThroughputReceiptError";
  }
}

export type FhvThroughputReceiptV1 = Readonly<{
  schemaVersion: string;
  capturedAtUtc: string;
  releaseSha: string;
  host: Readonly<{ hostname: string; platform: string; arch: string; cpuModel: string }>;
  contract: Readonly<{
    minThroughputCps: number;
    canonicalMaxRuntimeS: number;
    prelaunchMaxProjectedRuntimeS: number;
  }>;
  evidence: Readonly<{
    representativeSegmentExecuted: boolean;
    progressSamples: number;
    checkpointSamples: number;
    growthBytesPerCycle: number;
    hotPathDecayVerdict: "FLAT" | "DECAYING" | "INSUFFICIENT_SAMPLES";
    growthAwareProjectionAvailable: boolean;
    growthAwareProjectedRuntimeS: number;
  }>;
  classification: string;
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
}): FhvThroughputReceiptV1 {
  if (!existsSync(input.receiptPath)) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_MISSING",
      `Throughput host qualification receipt missing at ${input.receiptPath}; run pnpm trader:fhv:throughput-host-qualification on the target host`,
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
  const receipt = parsed as Partial<FhvThroughputReceiptV1> & Record<string, unknown>;

  if (receipt.schemaVersion !== FHV_THROUGHPUT_RECEIPT_SCHEMA) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_SCHEMA_UNSUPPORTED",
      `Throughput receipt schema ${String(receipt.schemaVersion)} != ${FHV_THROUGHPUT_RECEIPT_SCHEMA}`,
    );
  }

  // Self-digest covers every field except itself, so an edited receipt cannot stay self-consistent.
  const { receiptDigest, ...body } = receipt as FhvThroughputReceiptV1 & Record<string, unknown>;
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
  if (!receipt.host?.hostname?.trim()) {
    fail(
      "FHV_THROUGHPUT_RECEIPT_HOST_IDENTITY_MISSING",
      "Throughput receipt has no host identity binding",
    );
  }

  // The canonical constants are validated, not merely echoed, so a receipt cannot smuggle a weaker
  // contract through a schema-consistent file.
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
    (evidence.progressSamples ?? 0) < FHV_THROUGHPUT_MIN_PROGRESS_SAMPLES ||
    (evidence.checkpointSamples ?? 0) < FHV_THROUGHPUT_MIN_PROGRESS_SAMPLES
  ) {
    fail(
      "FHV_THROUGHPUT_INSUFFICIENT_EVIDENCE",
      `Throughput receipt has progressSamples=${String(evidence.progressSamples)} checkpointSamples=${String(evidence.checkpointSamples)}, need >= ${FHV_THROUGHPUT_MIN_PROGRESS_SAMPLES}`,
    );
  }
  if ((evidence.growthBytesPerCycle ?? Infinity) > FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE) {
    fail(
      "FHV_THROUGHPUT_GROWTH_CEILING_EXCEEDED",
      `Throughput receipt growthBytesPerCycle ${String(evidence.growthBytesPerCycle)} > ${FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE} (bounded hot-state ceiling)`,
    );
  }
  if (evidence.hotPathDecayVerdict !== "FLAT") {
    fail(
      "FHV_THROUGHPUT_HOT_PATH_DECAYING",
      `Throughput receipt hot-path decay verdict ${String(evidence.hotPathDecayVerdict)} != FLAT`,
    );
  }
  if (!evidence.growthAwareProjectionAvailable) {
    fail(
      "FHV_THROUGHPUT_PROJECTION_UNAVAILABLE",
      "Throughput receipt has no growth-aware projection",
    );
  }
  // Fail closed on any single breach, never an average that could hide it.
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

  return receipt as FhvThroughputReceiptV1;
}
