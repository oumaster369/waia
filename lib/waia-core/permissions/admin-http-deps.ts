import "server-only";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalAdminSessionUserId } from "@/lib/auth/session-user";
import { bridgeRequestDatabaseEnv } from "@/lib/trader/cron/worker-cron-env";
import type { AdminRouteHandlerDeps } from "@/lib/waia-core/permissions/admin-http";

export function createProductionAdminRouteDeps(): AdminRouteHandlerDeps {
  return {
    getUserId: getOptionalAdminSessionUserId,
    getRuntimeDb: async () => {
      await bridgeRequestDatabaseEnv();
      return getWaiaRuntimeDb();
    },
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}
