import { validateFhvCampaignRunId } from "@/lib/trader/fhv-campaign-run-id";
import { validateConfirmationPhrase } from "@/lib/trader/observability/fhv-command-confirmation";
import {
  FHV_OPERATOR_ACTIONS,
  type FhvOperatorAction,
} from "@/lib/trader/observability/fhv-observability.constants";

export const FHV_COMMAND_REASON_MIN_LENGTH = 3;
export const FHV_COMMAND_REASON_MAX_LENGTH = 2000;
export const FHV_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const FHV_COMMAND_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export class FhvAdminCommandRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FhvAdminCommandRequestError";
    this.code = code;
  }
}

export type ParsedFhvAdminCommandRequest = Readonly<{
  organizationId: string;
  campaignRunId: string;
  action: FhvOperatorAction;
  reason: string;
  expectedPhase: string;
  expectedCheckpointSeq?: number;
  idempotencyKey?: string;
  confirmationPhraseClass: ReturnType<typeof validateConfirmationPhrase>;
}>;

const ALLOWED_BODY_KEYS = new Set([
  "organization_id",
  "campaign_run_id",
  "action",
  "reason",
  "expected_phase",
  "expected_checkpoint_seq",
  "idempotency_key",
  "confirmation_phrase",
]);

function assertAllowedKeys(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      throw new FhvAdminCommandRequestError("UNKNOWN_FIELD", `Unknown field: ${key}`);
    }
  }
}

function parseAction(raw: unknown): FhvOperatorAction {
  if (typeof raw !== "string") {
    throw new FhvAdminCommandRequestError("ACTION_INVALID", "action is required.");
  }
  if (!FHV_OPERATOR_ACTIONS.includes(raw as FhvOperatorAction)) {
    throw new FhvAdminCommandRequestError("ACTION_NOT_ALLOWED", `Action not allowed: ${raw}`);
  }
  return raw as FhvOperatorAction;
}

function parseReason(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new FhvAdminCommandRequestError("REASON_INVALID", "reason is required.");
  }
  const trimmed = raw.trim();
  if (trimmed.length < FHV_COMMAND_REASON_MIN_LENGTH) {
    throw new FhvAdminCommandRequestError("REASON_TOO_SHORT", "reason is too short.");
  }
  if (trimmed.length > FHV_COMMAND_REASON_MAX_LENGTH) {
    throw new FhvAdminCommandRequestError("REASON_TOO_LONG", "reason is too long.");
  }
  return trimmed;
}

function parseOptionalId(raw: unknown, label: string): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new FhvAdminCommandRequestError(`${label}_INVALID`, `${label} must be a string.`);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (
    !FHV_COMMAND_ID_PATTERN.test(trimmed) ||
    trimmed.length > FHV_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw new FhvAdminCommandRequestError(`${label}_INVALID`, `${label} format is invalid.`);
  }
  return trimmed;
}

export function parseFhvAdminCommandRequest(input: {
  organizationId: string;
  urlCampaignRunId?: string | null;
  rawBody: unknown;
}): ParsedFhvAdminCommandRequest {
  if (input.rawBody == null || typeof input.rawBody !== "object" || Array.isArray(input.rawBody)) {
    throw new FhvAdminCommandRequestError("INVALID_BODY", "JSON body required.");
  }
  const body = input.rawBody as Record<string, unknown>;
  assertAllowedKeys(body);

  if (body.organization_id !== undefined && body.organization_id !== input.organizationId) {
    throw new FhvAdminCommandRequestError("ORGANIZATION_MISMATCH", "organization_id mismatch.");
  }

  const campaignRunId = validateFhvCampaignRunId(
    typeof body.campaign_run_id === "string" && body.campaign_run_id.trim()
      ? body.campaign_run_id
      : (input.urlCampaignRunId ?? ""),
  );

  const action = parseAction(body.action);
  const reason = parseReason(body.reason);
  const expectedPhase =
    typeof body.expected_phase === "string" && body.expected_phase.trim()
      ? body.expected_phase.trim()
      : "validation";

  let expectedCheckpointSeq: number | undefined;
  if (body.expected_checkpoint_seq !== undefined && body.expected_checkpoint_seq !== null) {
    if (
      typeof body.expected_checkpoint_seq !== "number" ||
      !Number.isInteger(body.expected_checkpoint_seq)
    ) {
      throw new FhvAdminCommandRequestError(
        "CHECKPOINT_SEQ_INVALID",
        "expected_checkpoint_seq must be an integer.",
      );
    }
    expectedCheckpointSeq = body.expected_checkpoint_seq;
  }

  const idempotencyKey = parseOptionalId(body.idempotency_key, "IDEMPOTENCY_KEY");
  const confirmationPhrase =
    typeof body.confirmation_phrase === "string" ? body.confirmation_phrase : "";
  const confirmationPhraseClass = validateConfirmationPhrase({
    campaignRunId,
    action,
    confirmationPhrase,
  });

  return {
    organizationId: input.organizationId,
    campaignRunId,
    action,
    reason,
    expectedPhase,
    expectedCheckpointSeq,
    idempotencyKey,
    confirmationPhraseClass,
  };
}
