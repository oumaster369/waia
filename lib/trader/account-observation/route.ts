import "server-only";
import postgres, { type Sql } from "postgres";
import { getOptionalAdminSessionUserId } from "@/lib/auth/session-user";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb, type WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { assertOrgMembershipPostgres } from "@/lib/waia-core/scope/org-context";
import { hasModuleEntitlementPostgres } from "@/lib/waia-core/entitlements/authoritative";
import { assertAdminPermission } from "@/lib/waia-core/permissions/admin-http";
import { createPostgresObservationReader } from "./postgres-reader";
import { handleAccountObservationGet, type ObservationReadDependencies } from "./read-handler";

/** Dormant unless an explicit dedicated SELECT-only connection is configured.
 * No exchange calls, provisioning, collection startup, secret decryption or DB fallback.
 * Existing WAIA access storage is used only for membership/entitlement/permission reads.
 */
export function createAccountObservationRouteDependencies() {
  let access: Promise<WaiaRuntimeDb> | undefined;
  let sql: Sql | undefined;
  let disposed = false;
  const assertOpen = (signal: AbortSignal) => {
    if (disposed || signal.aborted) throw new Error("ACCOUNT_OBSERVATION_UNAVAILABLE");
  };
  const runtime = async (signal: AbortSignal) => {
    assertOpen(signal);
    access ??= getWaiaRuntimeDb();
    const db = await access;
    assertOpen(signal);
    if (db.kind !== "postgres") throw new Error("ACCOUNT_OBSERVATION_POSTGRES_REQUIRED");
    return db;
  };
  const reader = (signal: AbortSignal) => {
    assertOpen(signal);
    if (!sql) {
      const url = process.env.WAIA_ACCOUNT_OBSERVATION_DATABASE_URL?.trim();
      if (!url) throw new Error("ACCOUNT_OBSERVATION_NOT_CONFIGURED");
      sql = postgres(url, { max: 1, prepare: false, connect_timeout: 3, idle_timeout: 5,
        max_lifetime: 60, connection: { statement_timeout: 3000 } });
    }
    return createPostgresObservationReader(sql);
  };
  const deps: ObservationReadDependencies = {
    async getUserId(signal) { assertOpen(signal); return getOptionalAdminSessionUserId(); },
    async hasTraderAccess(_userId, organizationId, signal) {
      return hasModuleEntitlementPostgres((await runtime(signal)).db, { organizationId, entitlementKey: "trader" });
    },
    async hasOrgMembership(userId, organizationId, signal) {
      const db = await runtime(signal);
      try { await assertOrgMembershipPostgres(db.db, { userId, organizationId }); return true; }
      catch { return false; }
    },
    async hasOperatorAccess(userId, organizationId, signal) {
      return (await assertAdminPermission(await runtime(signal), userId, organizationId, "admin.audit.read")).allowed;
    },
    async resolveActiveBinding(scope, _userId, signal) { return reader(signal).resolveActiveBinding(scope); },
    async readLatest(binding, signal) { return reader(signal).readLatest(binding); },
  };
  return { deps, async dispose() {
    disposed = true;
    await Promise.allSettled([
      sql?.end({ timeout: 1 }),
      access?.then(db => disposeWaiaRuntimeDb(db)),
    ]);
  } };
}

export async function accountObservationRoute(request: Request, surface: "tenant" | "admin",
  mode: "observation" | "binding" = "observation") {
  const context = createAccountObservationRouteDependencies();
  try { return await handleAccountObservationGet(request, surface, context.deps, mode); }
  finally { await context.dispose(); }
}
