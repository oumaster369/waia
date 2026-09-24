import "server-only";

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb, type WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalAdminSessionUserId } from "@/lib/auth/session-user";
import type { AdminRouteHandlerDeps } from "@/lib/waia-core/permissions/admin-http";

function localAdminConsolePostgres(): WaiaRuntimeDb | null {
  if (process.env.WAIA_ADMIN_CONSOLE_DB?.trim() !== "postgres") return null;
  const url = process.env.DATABASE_URL_POSTGRES?.trim() ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("WAIA_ADMIN_CONSOLE_DB refuses an invalid DATABASE_URL_POSTGRES.");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("WAIA_ADMIN_CONSOLE_DB=postgres refuses a non-local database.");
  }
  return createPerRequestPostgresRuntime();
}

export function createProductionAdminRouteDeps(): AdminRouteHandlerDeps {
  return {
    getUserId: getOptionalAdminSessionUserId,
    getRuntimeDb: async () => localAdminConsolePostgres() ?? getWaiaRuntimeDb(),
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}
