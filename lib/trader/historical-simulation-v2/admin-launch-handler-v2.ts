import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") require("server-only");

import { createPerRequestPostgresRuntime, disposePostgresClientSafely } from
  "@/db/postgres-client";
import { validateFhvAdminCsrf } from "@/lib/trader/fhv-admin-csrf";
import { requireFhvCsrfSecret } from "@/lib/trader/observability/fhv-runtime-secrets";
import { adminClientError, authorizeAdminRoute, parseOrganizationId,
  type AdminRouteHandlerDeps, type AdminRouteHandlerResult } from
  "@/lib/trader/admin-route-shared";
import { queueAuthenticatedHistoricalSimulationLaunchV2,
  type HistoricalSimulationRunLifecyclePortV2 } from "./launch-orchestrator-v2";
import { createHistoricalSimulationRunLifecyclePostgresV2 } from
  "./run-lifecycle-postgres-v2";

type LaunchBody = Readonly<{
  account_id: string;
  run_id: string;
  partition: "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
}>;
type ResumeBody = LaunchBody & Readonly<{ action: "RESUME_FROM_CHECKPOINT";
  paused_lifecycle_digest_hex: string; release_sha: string }>;

export type HistoricalSimulationAdminLaunchHandlerDepsV2 = AdminRouteHandlerDeps & Readonly<{
  env?: NodeJS.ProcessEnv;
  openLifecycle?(): Readonly<{
    lifecycle: HistoricalSimulationRunLifecyclePortV2;
    dispose(): Promise<void>;
  }>;
}>;

function parseBody(value: unknown): LaunchBody | ResumeBody {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const launchKeys = ["account_id", "run_id", "partition", "symbol"].sort();
  const resumeKeys = [...launchKeys, "action", "paused_lifecycle_digest_hex", "release_sha"].sort();
  const keys = Object.keys(body).sort();
  const initialLaunch = JSON.stringify(keys) === JSON.stringify(launchKeys);
  const resume = JSON.stringify(keys) === JSON.stringify(resumeKeys) &&
    body.action === "RESUME_FROM_CHECKPOINT" &&
    typeof body.paused_lifecycle_digest_hex === "string" &&
    /^[0-9a-f]{64}$/.test(body.paused_lifecycle_digest_hex) &&
    typeof body.release_sha === "string" && /^[0-9a-f]{40}$/.test(body.release_sha);
  if ((!initialLaunch && !resume) ||
      typeof body.account_id !== "string" || body.account_id.trim() !== body.account_id ||
      body.account_id.length === 0 || typeof body.run_id !== "string" ||
      body.run_id.trim() !== body.run_id || body.run_id.length === 0 ||
      body.partition !== "WALK_FORWARD" ||
      !["BTCUSDT", "ETHUSDT"].includes(String(body.symbol))) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REQUEST_INVALID");
  }
  return body as LaunchBody | ResumeBody;
}

function isResumeBody(body: LaunchBody | ResumeBody): body is ResumeBody {
  return "action" in body && body.action === "RESUME_FROM_CHECKPOINT";
}

function productionLifecycle() {
  const runtime = createPerRequestPostgresRuntime();
  return Object.freeze({
    lifecycle: createHistoricalSimulationRunLifecyclePostgresV2(runtime._sql),
    dispose: async () => { await disposePostgresClientSafely(runtime._sql); },
  });
}

/** Admin-only and CSRF-bound. The body cannot create total-cycle or release authority. */
export async function handleHistoricalSimulationAdminLaunchPostV2(
  request: Request,
  deps: HistoricalSimulationAdminLaunchHandlerDepsV2,
): Promise<AdminRouteHandlerResult> {
  const organizationId = parseOrganizationId(new URL(request.url));
  if (typeof organizationId !== "string") return organizationId;
  let authRuntime;
  let opened: ReturnType<typeof productionLifecycle> | undefined;
  try {
    const auth = await authorizeAdminRoute(deps, organizationId, "admin.trader.operations.mutate");
    authRuntime = auth.runtime;
    if (!auth.ok) return auth.result;
    if (!validateFhvAdminCsrf(request, requireFhvCsrfSecret(deps.env ?? process.env),
      organizationId, auth.userId)) {
      return adminClientError(403, "CSRF_INVALID", "CSRF validation failed.");
    }
    let body: LaunchBody | ResumeBody;
    try { body = parseBody(await request.json()); }
    catch { return adminClientError(400, "LAUNCH_REQUEST_INVALID", "Exact historical launch identity required."); }
    const continuationAuthority = isResumeBody(body) ? {
      action: body.action, releaseSha: body.release_sha,
      pausedLifecycleDigestHex: body.paused_lifecycle_digest_hex,
    } as const : undefined;
    opened = deps.openLifecycle?.() ?? productionLifecycle();
    const lifecycle = await queueAuthenticatedHistoricalSimulationLaunchV2({
      organizationId,
      accountId: body.account_id,
      runId: body.run_id,
      partition: body.partition,
      symbol: body.symbol,
      authenticatedOperatorId: auth.userId,
      ...(continuationAuthority ? { continuationAuthority } : {}),
    }, opened.lifecycle);
    return { status: 202, outcome: "success", waiaDbBackend: auth.runtime.kind,
      body: { schemaVersion: continuationAuthority
        ? "waia.trader.historical_simulation_resume_response.v2"
        : "waia.trader.historical_simulation_launch_response.v2",
        lifecycle } };
  } catch {
    return adminClientError(400, "HISTORICAL_SIMULATION_LAUNCH_REFUSED",
      "Historical launch refused by the qualified runtime authority.");
  } finally {
    await opened?.dispose();
    await deps.disposeRuntimeDb(authRuntime);
  }
}
