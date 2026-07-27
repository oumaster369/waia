/**
 * DEE-436 — immutable workstation recovery receipt for residual FHV supervisor units.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_T4A_RESIDUAL_RECOVERY_SCHEMA,
  type FhvT4aSupervisorResidualUnitStateV1,
} from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";

export const FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_SCHEMA =
  "fhv-t4a-residual-recovery-receipt/v1" as const;

export type FhvT4aResidualRecoveryEvidenceV1 = Readonly<{
  units: readonly FhvT4aSupervisorResidualUnitStateV1[];
}>;

export type FhvT4aResidualRecoveryReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_SCHEMA;
  classification: "FHV_T4A_RESIDUAL_RECOVERY_OK";
  failedRunId: string;
  failedTargetSha: string;
  failedReleaseTag: string;
  organizationId: string;
  operatorId: string;
  execHost: string;
  sshUser: string;
  hostBootId: string;
  beforeState: FhvT4aResidualRecoveryEvidenceV1;
  afterState: FhvT4aResidualRecoveryEvidenceV1;
  recoveryPayloadDigest: string;
  completedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4aResidualRecoveryReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aResidualRecoveryReceiptError";
  }
}

function withDigest<T extends { contentDigest: string }>(payload: Omit<T, "contentDigest">): T {
  const contentDigest = computePayloadDigest(payload);
  return { ...payload, contentDigest } as T;
}

export function fhvT4aResidualRecoveryReceiptPath(localStateDir: string): string {
  return join(localStateDir, "fhv-t4a-residual-recovery-receipt.v1.json");
}

export function writeFhvT4aResidualRecoveryReceipt(
  localStateDir: string,
  input: Omit<
    FhvT4aResidualRecoveryReceiptV1,
    "schemaVersion" | "contentDigest" | "completedAtUtc" | "classification"
  >,
): FhvT4aResidualRecoveryReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aResidualRecoveryReceiptPath(localStateDir);
  if (existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_REPLAY",
      "Recovery receipt already exists; same recovery cannot be replayed.",
    );
  }
  const receipt = withDigest<FhvT4aResidualRecoveryReceiptV1>({
    schemaVersion: FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_SCHEMA,
    classification: "FHV_T4A_RESIDUAL_RECOVERY_OK",
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeFileAtomicExclusive(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function readFhvT4aResidualRecoveryReceipt(
  localStateDir: string,
): FhvT4aResidualRecoveryReceiptV1 {
  const path = fhvT4aResidualRecoveryReceiptPath(localStateDir);
  if (!existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_MISSING",
      "Recovery receipt missing.",
    );
  }
  const receipt = JSON.parse(readFileSync(path, "utf8")) as FhvT4aResidualRecoveryReceiptV1;
  const { contentDigest, ...body } = receipt;
  if (computePayloadDigest(body) !== contentDigest) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_DIGEST",
      "Recovery receipt digest mismatch.",
    );
  }
  if (receipt.schemaVersion !== FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_SCHEMA) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_INVALID",
      "schema mismatch.",
    );
  }
  return receipt;
}

export function parseFhvT4aResidualRecoveryPayload(raw: unknown): {
  classification: string;
  failedRunId: string;
  failedTargetSha: string;
  failedReleaseTag: string;
  organizationId: string;
  operatorId: string;
  hostBootId: string;
  beforeState: FhvT4aResidualRecoveryEvidenceV1;
  afterState?: FhvT4aResidualRecoveryEvidenceV1;
} {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_PAYLOAD_INVALID",
      "Recovery payload must be an object.",
    );
  }
  const payload = raw as {
    schemaVersion: string;
    classification: string;
    failedRunId: string;
    failedTargetSha: string;
    failedReleaseTag: string;
    organizationId: string;
    operatorId: string;
    hostBootId: string;
    beforeState: FhvT4aResidualRecoveryEvidenceV1;
    afterState?: FhvT4aResidualRecoveryEvidenceV1;
  };
  if (payload.schemaVersion !== FHV_T4A_RESIDUAL_RECOVERY_SCHEMA) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_SCHEMA_MISMATCH",
      "schemaVersion mismatch.",
    );
  }
  return payload;
}
