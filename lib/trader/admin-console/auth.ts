import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import {
  adminClientError,
  assertAdminPermission,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

export type FleetAdminSession = {
  ok: true;
  userId: string;
  contextOrgId: string;
  runtime: WaiaRuntimeDb;
};

export async function authorizeFleetAdmin(
  deps: AdminRouteHandlerDeps,
  permission = "admin.audit.read",
): Promise<FleetAdminSession | { ok: false; result: AdminRouteHandlerResult }> {
  const userId = await deps.getUserId();
  if (!userId) {
    return { ok: false, result: adminClientError(401, "UNAUTHORIZED", "Sign in required.") };
  }
  const contextOrgId = personalOrganizationIdFromUserId(userId);
  let runtime: WaiaRuntimeDb | undefined;
  try {
    runtime = await deps.getRuntimeDb();
    const check = await assertAdminPermission(runtime, userId, contextOrgId, permission);
    if (!check.allowed) {
      await deps.disposeRuntimeDb(runtime);
      return {
        ok: false,
        result: adminClientError(403, "FORBIDDEN", "Admin permission required."),
      };
    }
    return { ok: true, userId, contextOrgId, runtime };
  } catch (err) {
    if (runtime) await deps.disposeRuntimeDb(runtime);
    throw err;
  }
}

export function assertAdminConsoleSameOrigin(request: Request): AdminRouteHandlerResult | null {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return adminClientError(403, ADMIN_REASON.originRejected, "JSON content type required.");
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return adminClientError(403, ADMIN_REASON.originRejected, "Origin required.");
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return adminClientError(403, ADMIN_REASON.originRejected, "Origin rejected.");
  }
  if (originUrl.origin !== new URL(request.url).origin) {
    return adminClientError(403, ADMIN_REASON.originRejected, "Origin rejected.");
  }
  return null;
}

export function staleRevisionResult(current: unknown): AdminRouteHandlerResult {
  return {
    status: 409,
    outcome: "client_error",
    body: {
      error: {
        code: ADMIN_REASON.staleRevision,
        message: "The record changed. Review the current state and retry.",
      },
      revision: current,
      current,
    },
  };
}
