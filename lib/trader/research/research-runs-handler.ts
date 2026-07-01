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
import {
  listBacktestRunsPostgres,
  type BacktestRunView,
} from "@/lib/trader/research/backtest-run-repository-postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type BacktestRunDto = {
  id: string;
  datasetId: string;
  strategyId: string;
  strategyVersion: string;
  costModelVersion: string;
  split: BacktestRunView["split"];
  status: BacktestRunView["status"];
  startedAt: string | null;
  completedAt: string | null;
  evidenceDigest: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type ResearchRunsListResponse = {
  runs: BacktestRunDto[];
  backend: "postgres" | "unavailable";
};

export type ResearchRunsHandlerResult = {
  status: number;
  body: ApiErrorEnvelope | ResearchRunsListResponse;
  outcome: WaiaRuntimeRouteOutcome;
  errorClass?: string;
  waiaDbBackend?: "sqlite" | "postgres";
};

export type ResearchRunsHandlerDeps = {
  getUserId: () => Promise<string | null>;
  hasTraderAccess: (userId: string) => Promise<boolean>;
  getRuntimeDb: () => Promise<WaiaRuntimeDb>;
  disposeRuntimeDb: (runtime: WaiaRuntimeDb | undefined) => Promise<unknown>;
};

function errorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

function clientError(status: number, code: string, message: string): ResearchRunsHandlerResult {
  return {
    status,
    body: errorEnvelope(code, message),
    outcome: "client_error",
  };
}

function isHandlerErrorResult(value: unknown): value is ResearchRunsHandlerResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "body" in value &&
    "outcome" in value
  );
}

function toDto(run: BacktestRunView): BacktestRunDto {
  return {
    id: run.id,
    datasetId: run.datasetId,
    strategyId: run.strategyId,
    strategyVersion: run.strategyVersion,
    costModelVersion: run.costModelVersion,
    split: run.split,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    evidenceDigest: run.evidenceDigest,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
  };
}

async function requireAuthenticatedTrader(
  deps: ResearchRunsHandlerDeps,
): Promise<{ userId: string } | ResearchRunsHandlerResult> {
  const userId = await deps.getUserId();
  if (!userId) {
    return clientError(401, "UNAUTHORIZED", "Session required.");
  }

  const hasAccess = await deps.hasTraderAccess(userId);
  if (!hasAccess) {
    return clientError(403, "FORBIDDEN", "Trader entitlement required.");
  }

  return { userId };
}

function parseListQuery(searchParams: URLSearchParams): { strategyId?: string; limit?: number } {
  const strategyId = searchParams.get("strategyId")?.trim() || undefined;
  const limitRaw = searchParams.get("limit");
  if (limitRaw === null || limitRaw.trim() === "") {
    return { strategyId, limit: 50 };
  }
  const parsed = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { strategyId, limit: 50 };
  }
  return { strategyId, limit: Math.min(parsed, 100) };
}

export async function handleResearchRunsGet(
  request: Request,
  deps: ResearchRunsHandlerDeps,
): Promise<ResearchRunsHandlerResult> {
  const auth = await requireAuthenticatedTrader(deps);
  if (isHandlerErrorResult(auth)) {
    return auth;
  }

  const organizationId = personalOrganizationIdFromUserId(auth.userId);
  const context = requireOrgContext(organizationId);
  context.userId = auth.userId;

  const query = parseListQuery(new URL(request.url).searchParams);

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  try {
    const runtime = await deps.getRuntimeDb();
    resolvedRuntime = runtime;

    if (runtime.kind !== "postgres") {
      return {
        status: 200,
        body: { runs: [], backend: "unavailable" },
        outcome: "success",
        waiaDbBackend: runtime.kind,
      };
    }

    const runs = await listBacktestRunsPostgres(runtime.db, context, {
      strategyId: query.strategyId,
      limit: query.limit,
    });

    return {
      status: 200,
      body: {
        runs: runs.map(toDto),
        backend: "postgres",
      },
      outcome: "success",
      waiaDbBackend: "postgres",
    };
  } catch (err) {
    if (isWaiaConfigError(err)) {
      return clientError(503, "SERVICE_UNAVAILABLE", "Database unavailable.");
    }
    return {
      status: 500,
      body: errorEnvelope("INTERNAL_ERROR", "Something went wrong."),
      outcome: "internal_error",
      errorClass: safeTelemetryErrorClass(err),
      waiaDbBackend: resolvedRuntime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(resolvedRuntime);
  }
}

export function createProductionResearchRunsDeps(): ResearchRunsHandlerDeps {
  return {
    getUserId: getOptionalSessionUserId,
    hasTraderAccess: hasTraderAccessForUser,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}
