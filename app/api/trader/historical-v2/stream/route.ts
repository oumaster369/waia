import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { createPerRequestPostgresRuntime, disposePostgresClientSafely } from "@/db/postgres-client";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { serveHistoricalObservableV2 } from "@/lib/trader/historical-simulation-v2/observable-http-v2";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const userId = await getOptionalSessionUserId();
  if (!userId) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  if (!(await hasTraderAccessForUser(userId))) return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const url = new URL(request.url); const runId = url.searchParams.get("run_id")?.trim();
  const accountId = url.searchParams.get("account_id")?.trim();
  if (!runId || !accountId) return Response.json({ error: { code: "SCOPE_REQUIRED" } }, { status: 400 });
  const runtime = createPerRequestPostgresRuntime();
  return serveHistoricalObservableV2({ request, sql: runtime._sql,
    scope: { organizationId: personalOrganizationIdFromUserId(userId), runId, accountId },
    dispose: async () => { await disposePostgresClientSafely(runtime._sql); } });
}

