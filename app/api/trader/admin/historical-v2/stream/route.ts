import { createPerRequestPostgresRuntime, disposePostgresClientSafely } from "@/db/postgres-client";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { authorizeAdminRoute, parseOrganizationId } from "@/lib/trader/admin-route-shared";
import { serveHistoricalObservableV2 } from "@/lib/trader/historical-simulation-v2/observable-http-v2";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url); const parsed = parseOrganizationId(url);
  if (typeof parsed !== "string") return Response.json(parsed.body, { status: parsed.status });
  const runId = url.searchParams.get("run_id")?.trim();
  if (!runId) return Response.json({ error: { code: "RUN_ID_REQUIRED" } }, { status: 400 });
  const deps = createProductionAdminRouteDeps(); let authRuntime;
  try {
    const auth = await authorizeAdminRoute(deps, parsed, "admin.audit.read");
    if (!auth.ok) return Response.json(auth.result.body, { status: auth.result.status });
    authRuntime = auth.runtime;
  } finally { await deps.disposeRuntimeDb(authRuntime); }
  const runtime = createPerRequestPostgresRuntime();
  return serveHistoricalObservableV2({ request, sql: runtime._sql,
    scope: { organizationId: parsed, runId },
    dispose: async () => { await disposePostgresClientSafely(runtime._sql); } });
}

