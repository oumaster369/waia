/**
 * Aggregate DEE-536 host qualification receipt.
 *
 * Mechanical combination of existing WP3B, throughput, and T4 preflight evidence.
 * Does not invent new performance budgets.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  assertFhvThroughputHostQualified,
  FhvThroughputReceiptError,
} from "@/lib/trader/observability/fhv-throughput-receipt";
import {
  assertFhvWp3bHostQualified,
  FhvWp3bReceiptError,
} from "@/lib/trader/observability/fhv-wp3b-receipt";

export const FHV_HOST_QUALIFICATION_RECEIPT_SCHEMA = "fhv-host-qualification-receipt/v1" as const;
export const FHV_HOST_QUALIFIED_CLASSIFICATION = "HOST_QUALIFIED" as const;

export type FhvHostQualificationClassification =
  | typeof FHV_HOST_QUALIFIED_CLASSIFICATION
  | `HOST_QUALIFICATION_BLOCKED_${string}`;

export type FhvHostQualificationReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_HOST_QUALIFICATION_RECEIPT_SCHEMA;
  releaseSha: string;
  wp3bReceiptPath: string;
  throughputReceiptPath: string;
  t4PreflightPath: string;
  wp3bHostname: string | null;
  throughputHostname: string | null;
  classification: FhvHostQualificationClassification;
  blockedReason: string | null;
  receiptDigest: string;
}>;

export class FhvHostQualificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvHostQualificationError";
  }
}

function blocked(reason: string): FhvHostQualificationClassification {
  return `HOST_QUALIFICATION_BLOCKED_${reason}`;
}

function digestBody(body: Omit<FhvHostQualificationReceiptV1, "receiptDigest">): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function aggregateFhvHostQualificationFromIdentities(input: {
  releaseSha: string;
  wp3bReceiptPath: string;
  throughputReceiptPath: string;
  t4PreflightPath: string;
  wp3b: { classification: string; releaseSha?: string; hostname: string };
  throughput: { classification: string; releaseSha: string; hostname: string };
  t4: { status: string; hostname: string };
}): FhvHostQualificationReceiptV1 {
  let classification: FhvHostQualificationClassification = FHV_HOST_QUALIFIED_CLASSIFICATION;
  let blockedReason: string | null = null;
  const fail = (reason: string) => {
    classification = blocked(reason);
    blockedReason = reason;
  };
  if (input.wp3b.classification !== "EXECUTION_SERVER_WP3B_HOST_QUALIFIED") {
    fail("WP3B_NOT_QUALIFIED");
  } else if (input.throughput.classification !== "EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED") {
    fail("THROUGHPUT_NOT_QUALIFIED");
  } else if (input.t4.status !== "PASS") {
    fail("T4_PREFLIGHT_NOT_PASS");
  } else if (
    input.wp3b.releaseSha &&
    input.wp3b.releaseSha !== input.releaseSha.trim().toLowerCase()
  ) {
    fail("WP3B_RELEASE_MISMATCH");
  } else if (input.throughput.releaseSha !== input.releaseSha.trim().toLowerCase()) {
    fail("THROUGHPUT_RELEASE_MISMATCH");
  } else if (
    input.wp3b.hostname !== input.throughput.hostname ||
    input.wp3b.hostname !== input.t4.hostname
  ) {
    fail("CROSS_TUPLE_HOST");
  }
  const body = {
    schemaVersion: FHV_HOST_QUALIFICATION_RECEIPT_SCHEMA,
    releaseSha: input.releaseSha.trim().toLowerCase(),
    wp3bReceiptPath: input.wp3bReceiptPath,
    throughputReceiptPath: input.throughputReceiptPath,
    t4PreflightPath: input.t4PreflightPath,
    wp3bHostname: input.wp3b.hostname,
    throughputHostname: input.throughput.hostname,
    classification,
    blockedReason,
  };
  return { ...body, receiptDigest: digestBody(body) };
}

function readT4Preflight(path: string): { status: string; hostname: string } {
  if (!existsSync(path)) {
    throw new FhvHostQualificationError("T4_PREFLIGHT_MISSING", `missing T4 preflight at ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    status?: string;
    hostname?: string;
  };
  if (typeof parsed.status !== "string" || typeof parsed.hostname !== "string") {
    throw new FhvHostQualificationError(
      "T4_PREFLIGHT_MALFORMED",
      "T4 preflight must include status and hostname",
    );
  }
  return { status: parsed.status, hostname: parsed.hostname };
}

export function aggregateFhvHostQualification(input: {
  releaseSha: string;
  wp3bReceiptPath: string;
  throughputReceiptPath: string;
  t4PreflightPath: string;
}): FhvHostQualificationReceiptV1 {
  const releaseSha = input.releaseSha.trim().toLowerCase();
  try {
    const wp3b = assertFhvWp3bHostQualified({
      receiptPath: input.wp3bReceiptPath,
      expectedReleaseSha: releaseSha,
    });
    const throughput = assertFhvThroughputHostQualified({
      receiptPath: input.throughputReceiptPath,
      expectedReleaseSha: releaseSha,
    });
    const t4 = readT4Preflight(input.t4PreflightPath);
    return aggregateFhvHostQualificationFromIdentities({
      releaseSha,
      wp3bReceiptPath: input.wp3bReceiptPath,
      throughputReceiptPath: input.throughputReceiptPath,
      t4PreflightPath: input.t4PreflightPath,
      wp3b: {
        classification: wp3b.classification,
        releaseSha: wp3b.releaseSha,
        hostname: wp3b.host.hostname,
      },
      throughput: {
        classification: throughput.classification,
        releaseSha: throughput.releaseSha,
        hostname: throughput.host.hostname,
      },
      t4,
    });
  } catch (error) {
    const code =
      error instanceof FhvWp3bReceiptError ||
      error instanceof FhvThroughputReceiptError ||
      error instanceof FhvHostQualificationError
        ? error.code
        : "EVIDENCE_INVALID";
    const body = {
      schemaVersion: FHV_HOST_QUALIFICATION_RECEIPT_SCHEMA,
      releaseSha,
      wp3bReceiptPath: input.wp3bReceiptPath,
      throughputReceiptPath: input.throughputReceiptPath,
      t4PreflightPath: input.t4PreflightPath,
      wp3bHostname: null,
      throughputHostname: null,
      classification: blocked(code),
      blockedReason: code,
    };
    return { ...body, receiptDigest: digestBody(body) };
  }
}
