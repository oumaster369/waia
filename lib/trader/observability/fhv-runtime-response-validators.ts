import {
  FHV_COMMAND_RESULT_MAX_BYTES,
  FHV_DETAIL_PAGE_SCHEMA_VERSION,
  FHV_DETAIL_RESPONSE_MAX_BYTES,
  FHV_OPERATOR_STATUS_MAX_BYTES,
  FHV_OPERATOR_STATUS_SCHEMA_VERSION,
} from "@/lib/trader/observability/fhv-observability.constants";
import type { FhvCommandResultV1 } from "@/lib/trader/observability/fhv-command-ledger";
import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";

export class FhvRuntimeResponseValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FhvRuntimeResponseValidationError";
    this.code = code;
  }
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new FhvRuntimeResponseValidationError("INVALID_JSON", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== "string") {
    throw new FhvRuntimeResponseValidationError("INVALID_FIELD", `${label} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new FhvRuntimeResponseValidationError("FIELD_TOO_LONG", `${label} exceeds max length.`);
  }
  return value;
}

function assertArray(value: unknown, label: string, maxLength: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new FhvRuntimeResponseValidationError("INVALID_FIELD", `${label} must be an array.`);
  }
  if (value.length > maxLength) {
    throw new FhvRuntimeResponseValidationError("ARRAY_TOO_LONG", `${label} exceeds max length.`);
  }
  return value;
}

export function parseBoundedJsonResponse(input: {
  text: string;
  maxBytes: number;
  contentType?: string | null;
}): unknown {
  if (input.contentType && !input.contentType.includes("application/json")) {
    throw new FhvRuntimeResponseValidationError(
      "CONTENT_TYPE_INVALID",
      "Expected application/json.",
    );
  }
  if (Buffer.byteLength(input.text, "utf8") > input.maxBytes) {
    throw new FhvRuntimeResponseValidationError("RESPONSE_TOO_LARGE", "Response exceeds size cap.");
  }
  try {
    return JSON.parse(input.text) as unknown;
  } catch {
    throw new FhvRuntimeResponseValidationError("MALFORMED_JSON", "Malformed JSON response.");
  }
}

export function validateFhvOperatorStatusV1Response(input: {
  payload: unknown;
  organizationId: string;
  campaignRunId: string;
}): FhvOperatorStatusV1 {
  const root = assertObject(input.payload, "status");
  if (root.schemaVersion !== FHV_OPERATOR_STATUS_SCHEMA_VERSION) {
    throw new FhvRuntimeResponseValidationError(
      "SCHEMA_VERSION_MISMATCH",
      "Invalid status schema.",
    );
  }
  const campaign = assertObject(root.campaign, "status.campaign");
  const campaignOrg = assertString(campaign.organizationId, "status.campaign.organizationId", 64);
  const campaignRun = assertString(campaign.runId, "status.campaign.runId", 128);
  if (campaignOrg !== input.organizationId) {
    throw new FhvRuntimeResponseValidationError(
      "ORG_BINDING_FAILED",
      "Status organization mismatch.",
    );
  }
  if (campaignRun !== input.campaignRunId) {
    throw new FhvRuntimeResponseValidationError("RUN_BINDING_FAILED", "Status run mismatch.");
  }
  assertArray(root.recentAlerts, "status.recentAlerts", 20);
  const serialized = JSON.stringify(root);
  if (Buffer.byteLength(serialized, "utf8") > FHV_OPERATOR_STATUS_MAX_BYTES) {
    throw new FhvRuntimeResponseValidationError("RESPONSE_TOO_LARGE", "Status exceeds size cap.");
  }
  return root as unknown as FhvOperatorStatusV1;
}

export function validateFhvDetailPageV1Response(input: { payload: unknown }): {
  items: readonly unknown[];
  nextCursor: string | null;
} {
  const root = assertObject(input.payload, "detail");
  if (root.schemaVersion !== undefined && root.schemaVersion !== FHV_DETAIL_PAGE_SCHEMA_VERSION) {
    throw new FhvRuntimeResponseValidationError(
      "SCHEMA_VERSION_MISMATCH",
      "Invalid detail schema.",
    );
  }
  const items = assertArray(root.items, "detail.items", 200);
  const nextCursor =
    root.nextCursor === null || root.nextCursor === undefined
      ? null
      : assertString(root.nextCursor, "detail.nextCursor", 256);
  const serialized = JSON.stringify(root);
  if (Buffer.byteLength(serialized, "utf8") > FHV_DETAIL_RESPONSE_MAX_BYTES) {
    throw new FhvRuntimeResponseValidationError("RESPONSE_TOO_LARGE", "Detail exceeds size cap.");
  }
  return { items, nextCursor };
}

export function validateFhvCommandResultV1Response(input: {
  payload: unknown;
}): FhvCommandResultV1 {
  const root = assertObject(input.payload, "commandResult");
  if (root.schemaVersion !== "fhv-command-result/v1") {
    throw new FhvRuntimeResponseValidationError(
      "SCHEMA_VERSION_MISMATCH",
      "Invalid command result schema.",
    );
  }
  assertString(root.commandId, "commandResult.commandId", 128);
  assertString(root.idempotencyKey, "commandResult.idempotencyKey", 128);
  assertString(root.status, "commandResult.status", 32);
  assertString(root.message, "commandResult.message", 512);
  assertString(root.completedAtUtc, "commandResult.completedAtUtc", 64);
  const serialized = JSON.stringify(root);
  if (Buffer.byteLength(serialized, "utf8") > FHV_COMMAND_RESULT_MAX_BYTES) {
    throw new FhvRuntimeResponseValidationError(
      "RESPONSE_TOO_LARGE",
      "Command result exceeds size cap.",
    );
  }
  return root as unknown as FhvCommandResultV1;
}

export const FHV_RESPONSE_BYTE_CAPS = {
  status: FHV_OPERATOR_STATUS_MAX_BYTES,
  detail: FHV_DETAIL_RESPONSE_MAX_BYTES,
  commandResult: FHV_COMMAND_RESULT_MAX_BYTES,
} as const;
