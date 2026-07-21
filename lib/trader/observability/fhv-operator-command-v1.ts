import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  FHV_COMMAND_MAX_TTL_MS,
  FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
  type FhvOperatorAction,
} from "@/lib/trader/observability/fhv-observability.constants";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export type FhvOperatorCommandV1 = Readonly<{
  schemaVersion: typeof FHV_OPERATOR_COMMAND_SCHEMA_VERSION;
  commandId: string;
  campaignRunId: string;
  organizationId: string;
  operatorId: string;
  action: FhvOperatorAction;
  reason: string;
  issuedAtUtc: string;
  expiresAtUtc: string;
  nonce: string;
  idempotencyKey: string;
  expectedCampaignState: Readonly<{ phase: string; checkpointSeq?: number }>;
  confirmationPhraseClass: "NONE" | "PAUSE" | "RESUME" | "STOP" | "EMERGENCY" | "DIAGNOSTIC";
  signature: string;
  signatureAlgorithm: "HMAC-SHA256";
}>;

export type FhvCommandVerificationErrorCode =
  | "FHV_COMMAND_EXPIRED"
  | "FHV_COMMAND_SIGNATURE_INVALID"
  | "FHV_COMMAND_RUN_MISMATCH"
  | "FHV_COMMAND_ORG_MISMATCH"
  | "FHV_COMMAND_STALE_STATE"
  | "FHV_COMMAND_SECRET_VIOLATION"
  | "FHV_COMMAND_REPLAY"
  | "FHV_COMMAND_SCHEMA_INVALID";

export class FhvCommandVerificationError extends Error {
  readonly code: FhvCommandVerificationErrorCode;

  constructor(code: FhvCommandVerificationErrorCode, message: string) {
    super(message);
    this.name = "FhvCommandVerificationError";
    this.code = code;
  }
}

const SECRET_PATTERNS = [
  /postgresql:\/\//i,
  /DATABASE_URL/i,
  /api[_-]?key\s*[:=]/i,
  /secret\s*[:=]/i,
  /password\s*[:=]/i,
] as const;

export function scanFhvCommandSecretViolation(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildFhvCommandSignaturePayload(
  command: Omit<FhvOperatorCommandV1, "signature">,
): string {
  return canonicalizeSemanticJsonString(command);
}

export function signFhvOperatorCommandV1(
  command: Omit<FhvOperatorCommandV1, "signature" | "signatureAlgorithm">,
  secret: string,
): FhvOperatorCommandV1 {
  const payload = buildFhvCommandSignaturePayload({
    ...command,
    signatureAlgorithm: "HMAC-SHA256",
    signature: "",
  } as FhvOperatorCommandV1);
  const signature = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return { ...command, signatureAlgorithm: "HMAC-SHA256", signature };
}

export function verifyFhvOperatorCommandV1(input: {
  command: FhvOperatorCommandV1;
  secret: string;
  expectedRunId: string;
  expectedOrganizationId: string;
  currentPhase: string;
  currentCheckpointSeq?: number;
  seenNonces: ReadonlySet<string>;
  seenIdempotencyKeys: ReadonlySet<string>;
  nowMs?: number;
}): void {
  const nowMs = input.nowMs ?? Date.now();
  if (input.command.schemaVersion !== FHV_OPERATOR_COMMAND_SCHEMA_VERSION) {
    throw new FhvCommandVerificationError("FHV_COMMAND_SCHEMA_INVALID", "Invalid command schema");
  }
  if (Date.parse(input.command.expiresAtUtc) < nowMs) {
    throw new FhvCommandVerificationError("FHV_COMMAND_EXPIRED", "Command expired");
  }
  if (
    Date.parse(input.command.expiresAtUtc) - Date.parse(input.command.issuedAtUtc) >
    FHV_COMMAND_MAX_TTL_MS
  ) {
    throw new FhvCommandVerificationError("FHV_COMMAND_EXPIRED", "Command TTL exceeded");
  }
  if (scanFhvCommandSecretViolation(input.command.reason)) {
    throw new FhvCommandVerificationError(
      "FHV_COMMAND_SECRET_VIOLATION",
      "Reason contains secrets",
    );
  }
  if (input.command.campaignRunId !== input.expectedRunId) {
    throw new FhvCommandVerificationError("FHV_COMMAND_RUN_MISMATCH", "Run ID mismatch");
  }
  if (input.command.organizationId !== input.expectedOrganizationId) {
    throw new FhvCommandVerificationError("FHV_COMMAND_ORG_MISMATCH", "Organization mismatch");
  }
  if (input.seenNonces.has(input.command.nonce)) {
    throw new FhvCommandVerificationError("FHV_COMMAND_REPLAY", "Nonce replay");
  }
  const { signature: _ignored, signatureAlgorithm: _ignoredAlg, ...unsignedBody } = input.command;
  const expectedSig = signFhvOperatorCommandV1(unsignedBody, input.secret).signature;
  const a = Buffer.from(expectedSig, "utf8");
  const b = Buffer.from(input.command.signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new FhvCommandVerificationError("FHV_COMMAND_SIGNATURE_INVALID", "Invalid signature");
  }
  if (
    input.command.expectedCampaignState.phase !== input.currentPhase ||
    (input.command.expectedCampaignState.checkpointSeq !== undefined &&
      input.command.expectedCampaignState.checkpointSeq !== input.currentCheckpointSeq)
  ) {
    throw new FhvCommandVerificationError("FHV_COMMAND_STALE_STATE", "Stale expected state");
  }
  if (input.seenIdempotencyKeys.has(input.command.idempotencyKey)) {
    throw new FhvCommandVerificationError("FHV_COMMAND_REPLAY", "Idempotency replay");
  }
}

export function createFhvCommandNonce(): string {
  return randomBytes(16).toString("hex");
}
