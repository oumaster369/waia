import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { authorizeFleetAdmin, assertAdminConsoleSameOrigin } from "@/lib/trader/admin-console/auth";
import { probeAdminConsoleSchema } from "@/lib/trader/admin-console/schema-probe";
import { requirePostgres, schemaNotAppliedResult } from "@/lib/trader/admin-console/postgres-guard";
import type {
  AdminRouteHandlerDeps,
  AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";

export type OpenAdminConsole =
  | {
      ok: true;
      userId: string;
      contextOrgId: string;
      runtime: Extract<WaiaRuntimeDb, { kind: "postgres" }>;
    }
  | { ok: false; result: AdminRouteHandlerResult };

export type OpenAdminConsoleOptions =
  | { mutate?: boolean; requireSchema: false }
  | { mutate?: boolean; requiredTables: readonly string[] };

export async function openAdminConsole(
  request: Request,
  deps: AdminRouteHandlerDeps,
  options?: OpenAdminConsoleOptions,
): Promise<OpenAdminConsole> {
  if (options?.mutate) {
    const origin = assertAdminConsoleSameOrigin(request);
    if (origin) return { ok: false, result: origin };
  }
  const auth = await authorizeFleetAdmin(
    deps,
    options?.mutate ? "admin.trader.operations.mutate" : "admin.audit.read",
  );
  if (!auth.ok) return auth;
  const sqlite = requirePostgres(auth.runtime);
  if (sqlite) {
    await deps.disposeRuntimeDb(auth.runtime);
    return { ok: false, result: sqlite };
  }
  if (auth.runtime.kind !== "postgres") {
    await deps.disposeRuntimeDb(auth.runtime);
    return { ok: false, result: schemaNotAppliedResult() };
  }
  if (!(options && "requireSchema" in options && options.requireSchema === false)) {
    const tables = options && "requiredTables" in options ? options.requiredTables : null;
    if (!tables) {
      await deps.disposeRuntimeDb(auth.runtime);
      return { ok: false, result: schemaNotAppliedResult() };
    }
    const present = await probeAdminConsoleSchema(auth.runtime, tables);
    if (!present) {
      await deps.disposeRuntimeDb(auth.runtime);
      return { ok: false, result: schemaNotAppliedResult() };
    }
  }
  return {
    ok: true,
    userId: auth.userId,
    contextOrgId: auth.contextOrgId,
    runtime: auth.runtime,
  };
}
