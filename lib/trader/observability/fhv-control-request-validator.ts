import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FHV_OPERATOR_ACTIONS,
  type FhvOperatorAction,
} from "@/lib/trader/observability/fhv-observability.constants";
import type { FhvCampaignControlRequestV1 } from "@/lib/trader/observability/fhv-campaign-control-files";

export type FhvControlRequestErrorCode =
  | "CONTROL_REQUEST_MISSING"
  | "CONTROL_REQUEST_MALFORMED_JSON"
  | "CONTROL_REQUEST_SCHEMA_INVALID"
  | "CONTROL_REQUEST_ACTION_INVALID"
  | "CONTROL_REQUEST_RUN_MISMATCH"
  | "CONTROL_REQUEST_ORG_MISMATCH"
  | "CONTROL_REQUEST_REASON_INVALID"
  | "CONTROL_REQUEST_TIMESTAMP_INVALID"
  | "CONTROL_REQUEST_CONSUMED";

export class FhvControlRequestError extends Error {
  constructor(
    readonly code: FhvControlRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FhvControlRequestError";
  }
}

const MAX_REASON_LENGTH = 512;
const MAX_OPERATOR_ID_LENGTH = 128;

function controlRequestPath(runRoot: string, action: FhvOperatorAction): string {
  return join(runRoot, "control", `${action.toLowerCase()}-request.v1.json`);
}

function validateControlRequestBody(
  raw: unknown,
  expected: { runId: string; organizationId: string; action: FhvOperatorAction },
): FhvCampaignControlRequestV1 {
  if (!raw || typeof raw !== "object") {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_MALFORMED_JSON",
      "Control request is not an object.",
    );
  }
  const body = raw as Record<string, unknown>;
  if (body.schemaVersion !== "fhv-campaign-control-request/v1") {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_SCHEMA_INVALID",
      "Invalid control request schemaVersion.",
    );
  }
  if (
    typeof body.action !== "string" ||
    !FHV_OPERATOR_ACTIONS.includes(body.action as FhvOperatorAction)
  ) {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_ACTION_INVALID",
      "Invalid control request action.",
    );
  }
  if (body.action !== expected.action) {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_ACTION_INVALID",
      "Control request action mismatch.",
    );
  }
  if (typeof body.runId !== "string" || body.runId !== expected.runId) {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_RUN_MISMATCH",
      "Control request runId mismatch.",
    );
  }
  if (typeof body.organizationId !== "string" || body.organizationId !== expected.organizationId) {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_ORG_MISMATCH",
      "Control request organizationId mismatch.",
    );
  }
  if (
    typeof body.operatorId !== "string" ||
    body.operatorId.length === 0 ||
    body.operatorId.length > MAX_OPERATOR_ID_LENGTH
  ) {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_SCHEMA_INVALID",
      "Invalid control request operatorId.",
    );
  }
  if (
    typeof body.reason !== "string" ||
    body.reason.length === 0 ||
    body.reason.length > MAX_REASON_LENGTH
  ) {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_REASON_INVALID",
      "Invalid control request reason.",
    );
  }
  if (typeof body.requestedAtUtc !== "string" || Number.isNaN(Date.parse(body.requestedAtUtc))) {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_TIMESTAMP_INVALID",
      "Invalid control request requestedAtUtc.",
    );
  }
  for (const key of Object.keys(body)) {
    if (
      ![
        "schemaVersion",
        "action",
        "runId",
        "organizationId",
        "operatorId",
        "reason",
        "requestedAtUtc",
        "consumedAtUtc",
        "status",
      ].includes(key)
    ) {
      throw new FhvControlRequestError(
        "CONTROL_REQUEST_SCHEMA_INVALID",
        `Unknown control field: ${key}`,
      );
    }
  }
  return body as FhvCampaignControlRequestV1;
}

export function readFhvCampaignControlRequest(input: {
  runRoot: string;
  action: FhvOperatorAction;
  runId: string;
  organizationId: string;
}): FhvCampaignControlRequestV1 | null {
  const path = controlRequestPath(input.runRoot, input.action);
  if (!existsSync(path)) {
    return null;
  }
  const content = readFileSync(path, "utf8").trim();
  if (!content) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_MALFORMED_JSON",
      "Control request JSON is malformed.",
    );
  }
  const request = validateControlRequestBody(parsed, input);
  const status = (parsed as { status?: string }).status;
  if (status === "consumed") {
    throw new FhvControlRequestError(
      "CONTROL_REQUEST_CONSUMED",
      "Control request already consumed.",
    );
  }
  return request;
}

export function isFhvCampaignControlRequestPending(input: {
  runRoot: string;
  action: FhvOperatorAction;
  runId: string;
  organizationId: string;
}): boolean {
  return resolveFhvControlRequestDisposition(input) === "pending";
}

export type FhvControlRequestDisposition = "missing" | "pending" | "consumed" | "corrupt";

export function resolveFhvControlRequestDisposition(input: {
  runRoot: string;
  action: FhvOperatorAction;
  runId: string;
  organizationId: string;
}): FhvControlRequestDisposition {
  const path = controlRequestPath(input.runRoot, input.action);
  if (!existsSync(path)) {
    return "missing";
  }
  const content = readFileSync(path, "utf8").trim();
  if (!content) {
    return "missing";
  }
  try {
    readFhvCampaignControlRequest(input);
    return "pending";
  } catch (error) {
    if (error instanceof FhvControlRequestError && error.code === "CONTROL_REQUEST_CONSUMED") {
      return "consumed";
    }
    return "corrupt";
  }
}
