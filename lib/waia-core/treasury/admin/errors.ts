import {
  IllegalTreasuryTransitionError,
  TreasuryNotFoundError,
  TreasuryOrgScopeError,
  TreasuryValidationError,
} from "@/lib/waia-core/treasury/errors";
import {
  adminClientError,
  type AdminRouteHandlerResult,
} from "@/lib/waia-core/permissions/admin-http";

const CONFLICT_REASON_CODES = new Set([
  "WATCHER_VERIFY_NO_LINKS",
  "WATCHER_VERIFY_UNCONFIRMED",
  "WATCHER_VERIFY_INSUFFICIENT_CONFIRMATIONS",
  "INCEPTION_NOT_ACTIVE",
  "INCEPTION_ACTIVE_EXISTS",
  "IDEAL_BUDGET_ACTIVE_PUBLIC_EXISTS",
  "TERMINAL_STATUS",
  "FULFILLMENT_NOT_VERIFIED",
  "FULFILLMENT_KIND",
  "CANCEL_REASON_REQUIRED",
  "EVIDENCE_OBJECT_EXISTS",
]);

export function mapTreasuryHttpError(err: unknown): AdminRouteHandlerResult {
  if (err instanceof TreasuryNotFoundError) {
    return adminClientError(404, err.code, `${err.entityType} not found`);
  }
  if (err instanceof IllegalTreasuryTransitionError) {
    return adminClientError(409, err.code, "Illegal treasury state transition");
  }
  if (err instanceof TreasuryOrgScopeError) {
    return adminClientError(400, err.code, "organization_id is required");
  }
  if (err instanceof TreasuryValidationError) {
    if (err.reasonCode === "TREASURY_BREATH_READ_MODEL_NOT_READY") {
      return {
        status: 503,
        body: { error: { code: err.reasonCode, message: "Breath read model is not ready." } },
        outcome: "client_error",
        errorClass: err.name,
      };
    }
    if (err.reasonCode === "EVIDENCE_STORAGE_NOT_CONFIGURED") {
      return adminClientError(503, err.reasonCode, "Evidence object storage is not configured");
    }
    if (err.reasonCode === "EVIDENCE_CONTENT_UNAVAILABLE") {
      return adminClientError(503, err.reasonCode, "Evidence object content is unavailable");
    }
    if (err.reasonCode === "EVIDENCE_INTEGRITY_MISMATCH") {
      return adminClientError(503, err.reasonCode, "Evidence object integrity check failed");
    }
    if (err.reasonCode === "EVIDENCE_TOO_LARGE") {
      return adminClientError(413, err.reasonCode, "Evidence upload exceeds the safety size limit");
    }
    const status = CONFLICT_REASON_CODES.has(err.reasonCode) ? 409 : 400;
    return adminClientError(status, err.reasonCode, "Treasury request rejected");
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
    outcome: "internal_error",
    errorClass: err instanceof Error ? err.name : "Error",
  };
}

export function treasuryBackendUnavailable(): AdminRouteHandlerResult {
  return {
    status: 503,
    body: {
      error: {
        code: "TREASURY_BACKEND_UNAVAILABLE",
        message: "Treasury admin persistence requires Postgres.",
      },
    },
    outcome: "config_error",
    errorClass: "TreasuryBackendUnavailable",
  };
}
