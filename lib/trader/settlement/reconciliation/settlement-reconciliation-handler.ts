import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { WaiaRuntimeRouteOutcome } from "@/lib/observability/waia-runtime-route-telemetry";
import {
  isWaiaConfigError,
  safeTelemetryErrorClass,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { createPostgresReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader-postgres";
import { createSqliteReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader-sqlite";
import { createReconciliationService } from "@/lib/trader/settlement/reconciliation/reconciliation-service";
import type {
  ReconciliationCaseDetail,
  ReconciliationCaseListQuery,
  ReconciliationCaseListResult,
  ReconciliationCaseStatus,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type SettlementReconciliationHandlerResult = {
  status: number;
  body:
    | ApiErrorEnvelope
    | ReconciliationCaseListResult
    | ReconciliationCaseDetail
    | { case: ReconciliationCaseDetail };
  outcome: WaiaRuntimeRouteOutcome;
  errorClass?: string;
  waiaDbBackend?: "sqlite" | "postgres";
};

export type SettlementReconciliationHandlerDeps = {
  getUserId: () => Promise<string | null>;
  hasTraderAccess: (userId: string) => Promise<boolean>;
  getRuntimeDb: () => Promise<WaiaRuntimeDb>;
  disposeRuntimeDb: (runtime: WaiaRuntimeDb | undefined) => Promise<unknown>;
};

function errorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

function clientError(
  status: number,
  code: string,
  message: string,
): SettlementReconciliationHandlerResult {
  return {
    status,
    body: errorEnvelope(code, message),
    outcome: "client_error",
  };
}

function parseListQuery(url: URL): ReconciliationCaseListQuery {
  const status = url.searchParams.get("status");
  const allowedStatuses = new Set<ReconciliationCaseStatus>([
    "OPEN",
    "ASSIGNED",
    "UNDER_REVIEW",
    "DECISION_PENDING",
    "RESOLVED",
    "CANCELLED",
    "ESCALATED",
  ]);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  return {
    status:
      status && allowedStatuses.has(status as ReconciliationCaseStatus)
        ? (status as ReconciliationCaseStatus)
        : undefined,
    exceptionReason: url.searchParams.get("exception_reason") ?? undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  };
}

async function authorizeTrader(
  deps: SettlementReconciliationHandlerDeps,
): Promise<
  | { ok: true; userId: string; orgId: string }
  | { ok: false; result: SettlementReconciliationHandlerResult }
> {
  const userId = await deps.getUserId();
  if (!userId) {
    return { ok: false, result: clientError(401, "UNAUTHORIZED", "Sign in required.") };
  }
  const hasAccess = await deps.hasTraderAccess(userId);
  if (!hasAccess) {
    return { ok: false, result: clientError(403, "FORBIDDEN", "Trader access required.") };
  }
  return { ok: true, userId, orgId: personalOrganizationIdFromUserId(userId) };
}

export async function handleSettlementReconciliationCasesList(
  request: Request,
  deps: SettlementReconciliationHandlerDeps,
): Promise<SettlementReconciliationHandlerResult> {
  let runtime: WaiaRuntimeDb | undefined;
  try {
    const auth = await authorizeTrader(deps);
    if (!auth.ok) {
      return auth.result;
    }

    runtime = await deps.getRuntimeDb();
    const reader =
      runtime.kind === "sqlite"
        ? createSqliteReconciliationReader(runtime.db)
        : createPostgresReconciliationReader(runtime.db);
    const service = createReconciliationService(reader);
    const context = requireOrgContext(auth.orgId);
    const result = await service.listCases(context, parseListQuery(new URL(request.url)));

    return {
      status: 200,
      body: result,
      outcome: "success",
      waiaDbBackend: runtime.kind,
    };
  } catch (err) {
    return {
      status: 500,
      body: errorEnvelope("INTERNAL_ERROR", "Something went wrong."),
      outcome: !runtime && isWaiaConfigError(err) ? "config_error" : "internal_error",
      errorClass: safeTelemetryErrorClass(err),
      waiaDbBackend: runtime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

export async function handleSettlementReconciliationCaseDetail(
  caseId: string,
  deps: SettlementReconciliationHandlerDeps,
): Promise<SettlementReconciliationHandlerResult> {
  let runtime: WaiaRuntimeDb | undefined;
  try {
    const auth = await authorizeTrader(deps);
    if (!auth.ok) {
      return auth.result;
    }

    runtime = await deps.getRuntimeDb();
    const reader =
      runtime.kind === "sqlite"
        ? createSqliteReconciliationReader(runtime.db)
        : createPostgresReconciliationReader(runtime.db);
    const service = createReconciliationService(reader);
    const context = requireOrgContext(auth.orgId);
    const detail = await service.getCaseDetail(context, caseId);
    if (!detail) {
      return clientError(404, "NOT_FOUND", "Reconciliation case not found.");
    }

    return {
      status: 200,
      body: { case: detail },
      outcome: "success",
      waiaDbBackend: runtime.kind,
    };
  } catch (err) {
    return {
      status: 500,
      body: errorEnvelope("INTERNAL_ERROR", "Something went wrong."),
      outcome: !runtime && isWaiaConfigError(err) ? "config_error" : "internal_error",
      errorClass: safeTelemetryErrorClass(err),
      waiaDbBackend: runtime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

export function createProductionSettlementReconciliationHandlerDeps(): SettlementReconciliationHandlerDeps {
  return {
    getUserId: getOptionalSessionUserId,
    hasTraderAccess: hasTraderAccessForUser,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}
