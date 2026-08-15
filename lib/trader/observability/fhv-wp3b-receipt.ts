import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  FHV_CHECKPOINT_BUDGET_MS_PER_10K,
  FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES,
} from "@/lib/trader/observability/fhv-checkpoint-cost-model";

/**
 * Canonical reader for the Execution Server WP-3B host-qualification receipt (ADR-0025 AD-6a).
 *
 * The receipt is the only evidence that a host can actually meet the 1-GiB / ≤ 400 ms checkpoint
 * contract, so reading it must be fail-closed on every axis the writer binds — not just the
 * classification string. A receipt that says QUALIFIED while its own digest disagrees, or whose
 * measurements exceed the budget, is not evidence.
 */

export const FHV_WP3B_RECEIPT_SCHEMA = "fhv-wp3b-host-qualification/v2" as const;
export const FHV_WP3B_QUALIFIED_CLASSIFICATION = "EXECUTION_SERVER_WP3B_HOST_QUALIFIED" as const;
export const FHV_WP3B_REQUIRED_MEASURED_ITERATIONS = 3;

/** checkpointEveryCycles(10000) / MIN_THROUGHPUT_CPS(877) in milliseconds. */
export const FHV_WP3B_GATE2_LIVENESS_MS = Math.ceil((10_000 / 877) * 1000);

export type FhvWp3bGateAxisV1 = Readonly<{
  status: "PASS" | "FAIL";
  measuredMs: readonly number[];
  budgetMs: number;
}>;

export class FhvWp3bReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvWp3bReceiptError";
  }
}

export type FhvWp3bReceiptV1 = Readonly<{
  schemaVersion: string;
  capturedAtUtc: string;
  releaseSha?: string;
  host: Readonly<{ hostname: string; platform: string; sha256BytesPerSecond: number }>;
  cloneCapability: Readonly<{ supported: boolean; status: string; mechanism: string }>;
  identityProofs: Readonly<{
    digestsMatch: boolean;
    mutationIsolated: boolean;
    cloneClaimTruthful: boolean;
  }>;
  contract: Readonly<{ qualificationDepthBytes: number; budgetMs: number }>;
  fixtureBytes: number;
  measurements: Readonly<{
    measuredMs: readonly number[];
    everyIterationWithinBudget: boolean;
    durabilityInsideTimer: boolean;
    negativeTestDetectsBreach: boolean;
  }>;
  gate1BlockingCapture: FhvWp3bGateAxisV1;
  gate2DestinationVerification: FhvWp3bGateAxisV1;
  classification: string;
  receiptDigest: string;
}>;

function fail(code: string, message: string): never {
  throw new FhvWp3bReceiptError(code, message);
}

/**
 * Read and fully validate a receipt, or throw.
 *
 * Every check below corresponds to a way a host could fail the contract while still producing a
 * file that superficially looks like a pass.
 */
export function assertFhvWp3bHostQualified(input: {
  receiptPath: string;
  /** When supplied, the receipt must have been produced by this release. */
  expectedReleaseSha?: string;
}): FhvWp3bReceiptV1 {
  if (!existsSync(input.receiptPath)) {
    fail(
      "FHV_WP3B_RECEIPT_MISSING",
      `WP-3B host qualification receipt missing at ${input.receiptPath}; run pnpm trader:fhv:wp3b-host-qualification on the target host`,
    );
  }

  const raw = readFileSync(input.receiptPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(
      "FHV_WP3B_RECEIPT_MALFORMED",
      `WP-3B receipt at ${input.receiptPath} is not valid JSON: ${String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    fail("FHV_WP3B_RECEIPT_MALFORMED", `WP-3B receipt at ${input.receiptPath} is not an object`);
  }
  const receipt = parsed as Partial<FhvWp3bReceiptV1> & Record<string, unknown>;

  if (receipt.schemaVersion !== FHV_WP3B_RECEIPT_SCHEMA) {
    fail(
      "FHV_WP3B_RECEIPT_SCHEMA_UNSUPPORTED",
      `WP-3B receipt schema ${String(receipt.schemaVersion)} != ${FHV_WP3B_RECEIPT_SCHEMA}`,
    );
  }

  // The digest covers every field except itself, so an edited receipt cannot stay self-consistent.
  const { receiptDigest, ...body } = receipt as FhvWp3bReceiptV1 & Record<string, unknown>;
  if (typeof receiptDigest !== "string" || receiptDigest.length !== 64) {
    fail("FHV_WP3B_RECEIPT_DIGEST_MISSING", "WP-3B receipt has no valid receiptDigest");
  }
  const recomputed = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  if (recomputed !== receiptDigest) {
    fail(
      "FHV_WP3B_RECEIPT_DIGEST_MISMATCH",
      `WP-3B receipt digest mismatch: recomputed ${recomputed} != recorded ${receiptDigest}`,
    );
  }

  if (input.expectedReleaseSha && receipt.releaseSha !== input.expectedReleaseSha) {
    fail(
      "FHV_WP3B_RECEIPT_RELEASE_MISMATCH",
      `WP-3B receipt releaseSha ${String(receipt.releaseSha)} != launch release ${input.expectedReleaseSha}`,
    );
  }

  const clone = receipt.cloneCapability;
  if (!clone?.supported || clone.status !== "NATIVE_CLONE_SUCCEEDED") {
    fail(
      "FHV_WP3B_NATIVE_CLONE_NOT_PROVEN",
      `WP-3B receipt does not prove native clone: status=${String(clone?.status)}`,
    );
  }
  const proofs = receipt.identityProofs;
  if (!proofs?.cloneClaimTruthful) {
    fail("FHV_WP3B_CLONE_CLAIM_UNTRUTHFUL", "WP-3B receipt clone claim is not truthful");
  }
  if (!proofs.digestsMatch || !proofs.mutationIsolated) {
    fail(
      "FHV_WP3B_IDENTITY_PROOF_FAILED",
      `WP-3B receipt identity proofs failed: digestsMatch=${proofs.digestsMatch} mutationIsolated=${proofs.mutationIsolated}`,
    );
  }

  if ((receipt.fixtureBytes ?? 0) < FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES) {
    fail(
      "FHV_WP3B_QUALIFICATION_DEPTH_TOO_SHALLOW",
      `WP-3B receipt fixtureBytes ${String(receipt.fixtureBytes)} < ${FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES}`,
    );
  }
  if (receipt.contract?.budgetMs !== FHV_CHECKPOINT_BUDGET_MS_PER_10K) {
    fail(
      "FHV_WP3B_BUDGET_MISMATCH",
      `WP-3B receipt budgetMs ${String(receipt.contract?.budgetMs)} != ${FHV_CHECKPOINT_BUDGET_MS_PER_10K}`,
    );
  }

  const measurements = receipt.measurements;
  const measured = measurements?.measuredMs ?? [];
  if (measured.length < FHV_WP3B_REQUIRED_MEASURED_ITERATIONS) {
    fail(
      "FHV_WP3B_INSUFFICIENT_ITERATIONS",
      `WP-3B receipt has ${measured.length} measured iterations, need ${FHV_WP3B_REQUIRED_MEASURED_ITERATIONS}`,
    );
  }
  // Every iteration, not an average: one breach is a breach.
  const breach = measured.find((value) => value > FHV_CHECKPOINT_BUDGET_MS_PER_10K);
  if (breach != null || !measurements?.everyIterationWithinBudget) {
    fail(
      "FHV_WP3B_CHECKPOINT_BUDGET_EXCEEDED",
      `WP-3B receipt has a measured checkpoint of ${String(breach)} ms above ${FHV_CHECKPOINT_BUDGET_MS_PER_10K} ms`,
    );
  }
  if (!measurements.durabilityInsideTimer) {
    fail(
      "FHV_WP3B_DURABILITY_OUTSIDE_TIMER",
      "WP-3B receipt did not keep durability work inside the measured interval",
    );
  }
  if (!measurements.negativeTestDetectsBreach) {
    fail(
      "FHV_WP3B_NEGATIVE_TEST_INVALID",
      "WP-3B receipt negative test did not prove the gate can turn RED",
    );
  }

  const gate1 = receipt.gate1BlockingCapture;
  const gate2 = receipt.gate2DestinationVerification;
  if (!gate1 || gate1.status !== "PASS") {
    fail(
      "FHV_WP3B_GATE1_FAILED",
      `WP-3B GATE 1 blocking capture is not PASS: ${String(gate1?.status)}`,
    );
  }
  if (gate1.budgetMs !== FHV_CHECKPOINT_BUDGET_MS_PER_10K) {
    fail("FHV_WP3B_BUDGET_MISMATCH", "WP-3B GATE 1 budget is not 400 ms");
  }
  if (!gate2 || gate2.status !== "PASS") {
    fail(
      "FHV_WP3B_GATE2_FAILED",
      `WP-3B GATE 2 destination verification is not PASS: ${String(gate2?.status)}`,
    );
  }
  if (gate2.budgetMs !== FHV_WP3B_GATE2_LIVENESS_MS) {
    fail(
      "FHV_WP3B_GATE2_LIVENESS_MISMATCH",
      `WP-3B GATE 2 liveness ${String(gate2.budgetMs)} != ${FHV_WP3B_GATE2_LIVENESS_MS}`,
    );
  }

  if (receipt.classification !== FHV_WP3B_QUALIFIED_CLASSIFICATION) {
    fail(
      "FHV_WP3B_HOST_NOT_QUALIFIED",
      `WP-3B receipt classification ${String(receipt.classification)} != ${FHV_WP3B_QUALIFIED_CLASSIFICATION}`,
    );
  }

  return receipt as FhvWp3bReceiptV1;
}
