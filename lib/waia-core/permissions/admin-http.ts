import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaRuntimeRouteOutcome } from "@/lib/observability/waia-runtime-route-telemetry";
import {
  resolvePermissionPostgres,
  resolvePermissionSqlite,
} from "@/lib/waia-core/permissions/resolve";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type AdminRouteHandlerResult = {
  status: number;
  body: ApiErrorEnvelope | Record<string, unknown> | unknown[];
  outcome: WaiaRuntimeRouteOutcome;
  errorClass?: string;
  waiaDbBackend?: "sqlite" | "postgres";
  responseHeaders?: Record<string, string>;
};

export type AdminRouteHandlerDeps = {
  getUserId: () => Promise<string | null>;
  getRuntimeDb: () => Promise<WaiaRuntimeDb>;
  disposeRuntimeDb: (runtime: WaiaRuntimeDb | undefined) => Promise<unknown>;
};

export function adminErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

export function adminClientError(
  status: number,
  code: string,
  message: string,
): AdminRouteHandlerResult {
  return {
    status,
    body: adminErrorEnvelope(code, message),
    outcome: "client_error",
  };
}

export function adminSuccess(
  body: Record<string, unknown> | unknown[],
  waiaDbBackend?: "sqlite" | "postgres",
): AdminRouteHandlerResult {
  return {
    status: 200,
    body,
    outcome: "success",
    waiaDbBackend,
  };
}

export function parseOrganizationId(url: URL): string | AdminRouteHandlerResult {
  const organizationId = url.searchParams.get("organization_id")?.trim();
  if (!organizationId) {
    return adminClientError(
      400,
      "ORGANIZATION_ID_REQUIRED",
      "organization_id query param required.",
    );
  }
  try {
    requireOrgContext(organizationId);
    return organizationId;
  } catch {
    return adminClientError(400, "ORGANIZATION_ID_INVALID", "organization_id is invalid.");
  }
}

export function parseOrganizationIdFromUnknown(value: unknown): string | AdminRouteHandlerResult {
  if (typeof value !== "string" || value.trim() === "") {
    return adminClientError(400, "ORGANIZATION_ID_REQUIRED", "organization_id is required.");
  }
  try {
    return requireOrgContext(value).organizationId;
  } catch {
    return adminClientError(400, "ORGANIZATION_ID_INVALID", "organization_id is invalid.");
  }
}

export async function assertAdminPermission(
  runtime: WaiaRuntimeDb,
  userId: string,
  organizationId: string,
  permission: string,
): Promise<{ allowed: boolean }> {
  if (runtime.kind === "sqlite") {
    return resolvePermissionSqlite(runtime.db, { userId, organizationId, permission });
  }
  return resolvePermissionPostgres(runtime.db, { userId, organizationId, permission });
}

export async function authorizeAdminRoute(
  deps: AdminRouteHandlerDeps,
  organizationId: string,
  permission = "admin.audit.read",
): Promise<
  | { ok: true; userId: string; runtime: WaiaRuntimeDb }
  | { ok: false; result: AdminRouteHandlerResult; runtime?: WaiaRuntimeDb }
> {
  const userId = await deps.getUserId();
  if (!userId) {
    return { ok: false, result: adminClientError(401, "UNAUTHORIZED", "Sign in required.") };
  }

  let runtime: WaiaRuntimeDb | undefined;
  try {
    runtime = await deps.getRuntimeDb();
    const check = await assertAdminPermission(runtime, userId, organizationId, permission);
    if (!check.allowed) {
      return {
        ok: false,
        runtime,
        result: adminClientError(403, "FORBIDDEN", "Admin permission required."),
      };
    }
    return { ok: true, userId, runtime };
  } catch (err) {
    if (runtime) {
      await deps.disposeRuntimeDb(runtime);
    }
    throw err;
  }
}

export function adminActor(userId: string): { actorType: "admin"; actorId: string } {
  return { actorType: "admin", actorId: userId };
}

export function mapServiceError(err: unknown): AdminRouteHandlerResult {
  if (err instanceof Error) {
    return adminClientError(400, err.name, err.message);
  }
  return adminClientError(400, "BAD_REQUEST", "Request failed.");
}
