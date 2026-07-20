import "server-only";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";

export function createProductionAdminRouteDeps(): AdminRouteHandlerDeps {
  return {
    getUserId: getOptionalSessionUserId,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}
