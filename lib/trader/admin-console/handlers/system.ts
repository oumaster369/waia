import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { ADMIN_JOB_CATALOG, missedJobRuns } from "@/lib/trader/admin-console/jobs/job-catalog";
import { readAdminRelease } from "@/lib/trader/admin-console/release";
import { holdoutRead } from "@/lib/trader/admin-console/assistant/tools";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";

const MINUTE_MS = 60_000;

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

export async function handleAdminConsoleSystemGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.system,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT job_key, started_at, status
        FROM trader_admin_job_run
        ORDER BY started_at DESC
        LIMIT 200
      `),
      );
      const nowMs = Date.now();
      const minuteKeys = new Set(
        ADMIN_JOB_CATALOG.filter((job) => job.cron === "* * * * *").map((job) => job.jobKey),
      );
      const runs = rows.flatMap((row) => {
        const startedAt =
          row.started_at instanceof Date
            ? row.started_at.getTime()
            : Date.parse(String(row.started_at));
        if (!Number.isFinite(startedAt)) return [];
        return [
          { jobKey: String(row.job_key), startedAtMs: startedAt, status: String(row.status) },
        ];
      });
      return adminSuccess(
        adminEnvelope({
          data: {
            release: readAdminRelease(),
            jobs: ADMIN_JOB_CATALOG,
            recentRuns: runs.slice(0, 50),
            missedMinuteJobs: missedJobRuns(
              runs.filter((run) => minuteKeys.has(run.jobKey)),
              nowMs,
              MINUTE_MS,
            ),
            researchReasoning: {
              state: "unavailable",
              reason: "RESEARCH_REASONING_NOT_IN_CONSOLE",
            },
            holdout: holdoutRead(),
          },
          scope: adminScopeFromQuery(parsed.query),
          mode: parsed.query.mode,
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
