import "server-only";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalAdminSessionUserId } from "@/lib/auth/session-user";
import type { AdminRouteHandlerDeps } from "@/lib/waia-core/permissions/admin-http";

export function createProductionAdminRouteDeps(): AdminRouteHandlerDeps {
  return {
    getUserId: getOptionalAdminSessionUserId,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}
