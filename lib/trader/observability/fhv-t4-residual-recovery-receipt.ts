/**
 * DEE-436 — immutable workstation recovery receipts (preview, confirm attempt, final, failure).
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_T4A_RESIDUAL_RECOVERY_SCHEMA,
  type FhvT4aSupervisorResidualUnitStateV1,
} from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";
import type { FhvT4aResidualUnitIdentityClassification } from "@/lib/trader/observability/fhv-t4-residual-unit-identity";
import { fhvT4aResidualRecoveryBeforeStateDigest } from "@/lib/trader/observability/fhv-t4-residual-unit-identity";

export const FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_RECEIPT_SCHEMA =
  "fhv-t4a-residual-recovery-preview-receipt/v1" as const;
export const FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_ATTEMPT_SCHEMA =
  "fhv-t4a-residual-recovery-confirm-attempt/v1" as const;
export const FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_COMPLETION_SCHEMA =
  "fhv-t4a-residual-recovery-confirm-completion/v1" as const;
export const FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_SCHEMA =
  "fhv-t4a-residual-recovery-receipt/v1" as const;
export const FHV_T4A_RESIDUAL_RECOVERY_FAILURE_RECEIPT_SCHEMA =
  "fhv-t4a-residual-recovery-failure-receipt/v1" as const;

export type FhvT4aResidualRecoveryEvidenceV1 = Readonly<{
  units: readonly FhvT4aSupervisorResidualUnitStateV1[];
}>;

export type FhvT4aResidualRecoveryPreviewReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_RECEIPT_SCHEMA;
  classification: "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK";
  recoveryId: string;
  recoveryImplementationSha: string;
  recoveryImplementationTag: string;
  recoveryImplementationScriptDigest: string;
  failedRunId: string;
  failedTargetSha: string;
  failedReleaseTag: string;
  organizationId: string;
  operatorId: string;
  execHost: string;
  sshUser: string;
  expectedHostname: string;
  expectedMachineIdSha256: string;
  hostBootId: string;
  beforeState: FhvT4aResidualRecoveryEvidenceV1;
  unitIdentityClassification: FhvT4aResidualUnitIdentityClassification;
  beforeStateDigest: string;
  mutatingCommandCount: 0;
  completedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4aResidualRecoveryConfirmAttemptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_ATTEMPT_SCHEMA;
  recoveryId: string;
  previewReceiptDigest: string;
  failedRunId: string;
  status: "in_progress";
  startedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4aResidualRecoveryConfirmCompletionV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_COMPLETION_SCHEMA;
  recoveryId: string;
  confirmAttemptDigest: string;
  status: "completed" | "failed";
  completedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4aResidualRecoveryReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_SCHEMA;
  classification: "FHV_T4A_RESIDUAL_RECOVERY_OK";
  recoveryId: string;
  previewReceiptDigest: string;
  confirmAttemptDigest: string;
  confirmCompletionDigest: string;
  recoveryImplementationSha: string;
  recoveryImplementationTag: string;
  failedRunId: string;
  failedTargetSha: string;
  failedReleaseTag: string;
  organizationId: string;
  operatorId: string;
  execHost: string;
  sshUser: string;
  hostBootId: string;
  unitIdentityClassification: FhvT4aResidualUnitIdentityClassification;
  beforeState: FhvT4aResidualRecoveryEvidenceV1;
  afterState: FhvT4aResidualRecoveryEvidenceV1;
  beforeStateDigest: string;
  afterStateDigest: string;
  recoveryPayloadDigest: string;
  remoteExitStatus: 0;
  completedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4aResidualRecoveryFailureReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_RESIDUAL_RECOVERY_FAILURE_RECEIPT_SCHEMA;
  classification: "FHV_T4A_RESIDUAL_RECOVERY_FAILED";
  recoveryId: string;
  previewReceiptDigest: string;
  confirmAttemptDigest: string;
  confirmCompletionDigest: string;
  failedRunId: string;
  failedTargetSha: string;
  failedReleaseTag: string;
  hostBootId: string;
  beforeState: FhvT4aResidualRecoveryEvidenceV1;
  afterState?: FhvT4aResidualRecoveryEvidenceV1;
  beforeStateDigest: string;
  afterStateDigest?: string;
  remoteExitStatus: number;
  remoteStdoutDigest: string;
  remoteStderrDigest: string;
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

function validateDigest<T extends { contentDigest: string }>(receipt: T, code: string): T {
  const { contentDigest, ...body } = receipt;
  if (computePayloadDigest(body) !== contentDigest) {
    throw new FhvT4aResidualRecoveryReceiptError(code, "Receipt digest mismatch.");
  }
  return receipt;
}

export function fhvT4aResidualRecoveryPreviewReceiptPath(localStateDir: string): string {
  return join(localStateDir, "fhv-t4a-residual-recovery-preview-receipt.v1.json");
}

export function fhvT4aResidualRecoveryConfirmAttemptPath(localStateDir: string): string {
  return join(localStateDir, "fhv-t4a-residual-recovery-confirm-attempt.v1.json");
}

export function fhvT4aResidualRecoveryConfirmCompletionPath(localStateDir: string): string {
  return join(localStateDir, "fhv-t4a-residual-recovery-confirm-completion.v1.json");
}

export function fhvT4aResidualRecoveryReceiptPath(localStateDir: string): string {
  return join(localStateDir, "fhv-t4a-residual-recovery-receipt.v1.json");
}

export function fhvT4aResidualRecoveryFailureReceiptPath(localStateDir: string): string {
  return join(localStateDir, "fhv-t4a-residual-recovery-failure-receipt.v1.json");
}

export function writeFhvT4aResidualRecoveryPreviewReceipt(
  localStateDir: string,
  input: Omit<
    FhvT4aResidualRecoveryPreviewReceiptV1,
    "schemaVersion" | "contentDigest" | "completedAtUtc" | "classification" | "mutatingCommandCount"
  >,
): FhvT4aResidualRecoveryPreviewReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aResidualRecoveryPreviewReceiptPath(localStateDir);
  if (existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_RECEIPT_REPLAY",
      "Preview receipt already exists for this recovery namespace.",
    );
  }
  const receipt = withDigest<FhvT4aResidualRecoveryPreviewReceiptV1>({
    schemaVersion: FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_RECEIPT_SCHEMA,
    classification: "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK",
    mutatingCommandCount: 0,
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeFileAtomicExclusive(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function readFhvT4aResidualRecoveryPreviewReceipt(
  localStateDir: string,
): FhvT4aResidualRecoveryPreviewReceiptV1 {
  const path = fhvT4aResidualRecoveryPreviewReceiptPath(localStateDir);
  if (!existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_RECEIPT_MISSING",
      "Preview receipt missing.",
    );
  }
  const receipt = validateDigest(
    JSON.parse(readFileSync(path, "utf8")) as FhvT4aResidualRecoveryPreviewReceiptV1,
    "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_RECEIPT_DIGEST",
  );
  if (receipt.schemaVersion !== FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_RECEIPT_SCHEMA) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_RECEIPT_INVALID",
      "Preview receipt schema mismatch.",
    );
  }
  return receipt;
}

export function writeFhvT4aResidualRecoveryConfirmAttempt(
  localStateDir: string,
  input: Omit<
    FhvT4aResidualRecoveryConfirmAttemptV1,
    "schemaVersion" | "contentDigest" | "startedAtUtc" | "status"
  >,
): FhvT4aResidualRecoveryConfirmAttemptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aResidualRecoveryConfirmAttemptPath(localStateDir);
  if (existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_REPLAY",
      "Confirm attempt already exists; replay refused before remote mutation.",
    );
  }
  const attempt = withDigest<FhvT4aResidualRecoveryConfirmAttemptV1>({
    schemaVersion: FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_ATTEMPT_SCHEMA,
    status: "in_progress",
    ...input,
    startedAtUtc: new Date().toISOString(),
  });
  writeFileAtomicExclusive(path, `${JSON.stringify(attempt, null, 2)}\n`);
  return attempt;
}

export function readFhvT4aResidualRecoveryConfirmAttempt(
  localStateDir: string,
): FhvT4aResidualRecoveryConfirmAttemptV1 {
  const path = fhvT4aResidualRecoveryConfirmAttemptPath(localStateDir);
  if (!existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_ATTEMPT_MISSING",
      "Confirm attempt missing.",
    );
  }
  const attempt = validateDigest(
    JSON.parse(readFileSync(path, "utf8")) as FhvT4aResidualRecoveryConfirmAttemptV1,
    "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_ATTEMPT_DIGEST",
  );
  if (attempt.status !== "in_progress") {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_ATTEMPT_MUTATED",
      "Pre-mutation confirm attempt must remain in_progress.",
    );
  }
  return attempt;
}

export function writeFhvT4aResidualRecoveryConfirmCompletion(
  localStateDir: string,
  input: Omit<
    FhvT4aResidualRecoveryConfirmCompletionV1,
    "schemaVersion" | "contentDigest" | "completedAtUtc"
  >,
): FhvT4aResidualRecoveryConfirmCompletionV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aResidualRecoveryConfirmCompletionPath(localStateDir);
  if (existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_COMPLETION_REPLAY",
      "Confirm completion marker already exists.",
    );
  }
  readFhvT4aResidualRecoveryConfirmAttempt(localStateDir);
  const completion = withDigest<FhvT4aResidualRecoveryConfirmCompletionV1>({
    schemaVersion: FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_COMPLETION_SCHEMA,
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeFileAtomicExclusive(path, `${JSON.stringify(completion, null, 2)}\n`);
  return completion;
}

export function readFhvT4aResidualRecoveryConfirmCompletion(
  localStateDir: string,
): FhvT4aResidualRecoveryConfirmCompletionV1 {
  const path = fhvT4aResidualRecoveryConfirmCompletionPath(localStateDir);
  if (!existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_COMPLETION_MISSING",
      "Confirm completion marker missing.",
    );
  }
  return validateDigest(
    JSON.parse(readFileSync(path, "utf8")) as FhvT4aResidualRecoveryConfirmCompletionV1,
    "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_COMPLETION_DIGEST",
  );
}

export function assertFhvT4aResidualRecoveryReplaySafe(localStateDir: string): void {
  if (existsSync(fhvT4aResidualRecoveryReceiptPath(localStateDir))) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_REPLAY",
      "Final recovery receipt already exists.",
    );
  }
  if (existsSync(fhvT4aResidualRecoveryFailureReceiptPath(localStateDir))) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_FAILURE_RECEIPT_REPLAY",
      "Failure recovery receipt already exists.",
    );
  }
  if (existsSync(fhvT4aResidualRecoveryConfirmCompletionPath(localStateDir))) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_COMPLETION_REPLAY",
      "Confirm completion marker already exists.",
    );
  }
  if (existsSync(fhvT4aResidualRecoveryConfirmAttemptPath(localStateDir))) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_CONFIRM_REPLAY",
      "Confirm attempt already exists.",
    );
  }
}

export function writeFhvT4aResidualRecoveryReceipt(
  localStateDir: string,
  input: Omit<
    FhvT4aResidualRecoveryReceiptV1,
    "schemaVersion" | "contentDigest" | "completedAtUtc" | "classification" | "remoteExitStatus"
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
    remoteExitStatus: 0,
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
  const receipt = validateDigest(
    JSON.parse(readFileSync(path, "utf8")) as FhvT4aResidualRecoveryReceiptV1,
    "FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_DIGEST",
  );
  if (receipt.schemaVersion !== FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_SCHEMA) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_RECEIPT_INVALID",
      "schema mismatch.",
    );
  }
  return receipt;
}

export function writeFhvT4aResidualRecoveryFailureReceipt(
  localStateDir: string,
  input: Omit<
    FhvT4aResidualRecoveryFailureReceiptV1,
    "schemaVersion" | "contentDigest" | "completedAtUtc" | "classification"
  >,
): FhvT4aResidualRecoveryFailureReceiptV1 {
  mkdirSync(localStateDir, { recursive: true });
  const path = fhvT4aResidualRecoveryFailureReceiptPath(localStateDir);
  if (existsSync(path)) {
    throw new FhvT4aResidualRecoveryReceiptError(
      "FHV_T4A_RESIDUAL_RECOVERY_FAILURE_RECEIPT_REPLAY",
      "Failure receipt already exists.",
    );
  }
  const receipt = withDigest<FhvT4aResidualRecoveryFailureReceiptV1>({
    schemaVersion: FHV_T4A_RESIDUAL_RECOVERY_FAILURE_RECEIPT_SCHEMA,
    classification: "FHV_T4A_RESIDUAL_RECOVERY_FAILED",
    ...input,
    completedAtUtc: new Date().toISOString(),
  });
  writeFileAtomicExclusive(path, `${JSON.stringify(receipt, null, 2)}\n`);
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
  unitIdentityClassification?: FhvT4aResidualUnitIdentityClassification;
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
    unitIdentityClassification?: FhvT4aResidualUnitIdentityClassification;
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

export { fhvT4aResidualRecoveryBeforeStateDigest };
