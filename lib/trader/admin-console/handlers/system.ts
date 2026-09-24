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
import { ADMIN_JOB_CATALOG } from "@/lib/trader/admin-console/jobs/job-catalog";
import { readAdminRelease } from "@/lib/trader/admin-console/release";
import { holdoutRead } from "@/lib/trader/admin-console/assistant/tools";
import { assistantEnabled } from "@/lib/trader/admin-console/assistant/guard";
import { adminRuntimeFlag } from "@/lib/trader/admin-console/runtime-flags";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";
import { organizationFilter } from "@/lib/trader/admin-console/sql/read-scope";
import type { SystemReadModel } from "@/lib/trader/admin-console/read-models/system";
const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
const nullable = (value: unknown): string | null => (value == null ? null : String(value));

export async function handleAdminConsoleSystemGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const query = parsed.query;
  const tab = query.tab ?? "services";
  const opened = await openAdminConsole(request, deps, { requiredTables: HANDLER_TABLES.system });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const rows = [
        ...(await tx.execute(
          sql`SELECT DISTINCT ON (job_key) job_key, started_at, finished_at, status, error_class FROM trader_admin_job_run ORDER BY job_key, started_at DESC LIMIT 500`,
        )),
      ];
      const now = Date.now();
      const enabled = assistantEnabled({
        WAIA_ADMIN_ASSISTANT_ENABLED: adminRuntimeFlag("WAIA_ADMIN_ASSISTANT_ENABLED"),
      });
      const data: SystemReadModel = {
        release: readAdminRelease(),
        diagnosticScope: "fleet",
        assistant: {
          enabled,
          mode: enabled ? "enabled" : "disabled",
          telemetryReason: "ASSISTANT_TELEMETRY_NOT_OBSERVED",
        },
        jobs: ADMIN_JOB_CATALOG.map((job) => {
          const run = rows.find((row) => row.job_key === job.jobKey);
          const at = iso(run?.started_at);
          const interval =
            job.cron === "* * * * *"
              ? 60000
              : job.cron === "*/10 * * * *"
                ? 600000
                : job.cron
                  ? 3600000
                  : null;
          const stale = Boolean(at && interval && now - Date.parse(at) > 2 * interval);
          return {
            ...job,
            lastRun:
              run && at
                ? {
                    at,
                    finishedAt: iso(run.finished_at),
                    status: String(run.status),
                    errorClass: nullable(run.error_class),
                  }
                : null,
            state: !run ? "unavailable" : stale ? "stale" : "ok",
            reason: !run
              ? job.owner === "execution-host"
                ? "EXECUTION_HOST_DIAGNOSTICS_UNAVAILABLE"
                : job.owner === "human"
                  ? "MANUAL_OPERATION_NOT_SCHEDULED"
                  : "JOB_RUN_NOT_OBSERVED"
              : stale
                ? "JOB_RUN_STALE"
                : null,
          };
        }),
        recentRuns: rows.flatMap((row) => {
          const at = iso(row.started_at);
          return at
            ? [
                {
                  jobKey: String(row.job_key),
                  startedAtMs: Date.parse(at),
                  status: String(row.status),
                },
              ]
            : [];
        }),
        missedMinuteJobs: [],
        researchReasoning: { state: "unavailable", reason: "RESEARCH_REASONING_NOT_IN_CONSOLE" },
        holdout: holdoutRead(),
      };
      data.missedMinuteJobs = data.jobs
        .filter((job) => job.cron === "* * * * *" && job.state === "stale")
        .map((job) => job.jobKey);
      if (tab === "sources") {
        const quotes =
          await tx.execute(sql`SELECT source, max(observed_at) AS observed_at, count(*)::int AS total,
          count(*) FILTER (WHERE observed_at >= now() - interval '180 seconds' AND source_ts >= now() - interval '180 seconds')::int AS fresh
          FROM trader_admin_market_quote_latest GROUP BY source ORDER BY source`);
        const other =
          await tx.execute(sql`SELECT 'alternative.me' AS source, 'fear_greed' AS kind, max(observed_at) AS observed_at, count(*)::int AS total FROM trader_admin_fear_greed
          UNION ALL SELECT source, 'news', max(first_observed_at), count(*)::int FROM trader_admin_news_item GROUP BY source`);
        data.sources = [...quotes].map((row) => ({
          source: String(row.source),
          kind: "quotes",
          observedAt: iso(row.observed_at),
          total: Number(row.total),
          fresh: Number(row.fresh),
          state:
            Number(row.fresh) === Number(row.total)
              ? "ok"
              : Number(row.fresh) > 0
                ? "partial"
                : "stale",
        }));
        for (const row of other) {
          const observedAt = iso(row.observed_at);
          const fresh =
            observedAt &&
            now - Date.parse(observedAt) <=
              (row.kind === "fear_greed" ? 48 * 3600000 : 24 * 3600000);
          data.sources.push({
            source: String(row.source),
            kind: String(row.kind),
            observedAt,
            total: Number(row.total),
            fresh: null,
            state: !observedAt ? "unavailable" : fresh ? "ok" : "stale",
          });
        }
      }
      if (tab === "authority") {
        const org = query.organization_id ?? null;
        const switches = [
          ...(await tx.execute(sql`SELECT id::text, organization_id::text, scope_type, switch_type, enforcement_mode, state, origin, state_version::text, updated_at
          FROM trader_kill_switches WHERE (${org}::uuid IS NULL OR organization_id = ${org}::uuid OR scope_type = 'platform') ORDER BY updated_at DESC LIMIT 201`)),
        ];
        const live = [
          ...(await tx.execute(
            sql`SELECT organization_id::text, state, max_notional_cap, updated_at, cooling_off_ends_at FROM trader_org_live_enable WHERE ${organizationFilter(query)} ORDER BY updated_at DESC LIMIT 201`,
          )),
        ];
        const runtime = [
          ...(await tx.execute(sql`SELECT DISTINCT ON (organization_id, runtime_instance_id) organization_id::text, assessment_id, runtime_instance_id, posture, adjudicated_at_utc
          FROM trader_runtime_authority_assessments_v2 WHERE ${organizationFilter(query)} ORDER BY organization_id, runtime_instance_id, adjudicated_at_utc DESC LIMIT 201`)),
        ];
        // The runtime account_id is not assumed to be an exchange-account binding.
        const risk = query.exchange_account_id
          ? []
          : [
              ...(await tx.execute(sql`SELECT organization_id::text, account_id, posture, reconciliation_status, kill_state,
          exposure_limit_notional::text, outstanding_reservation_notional::text, quote_asset, updated_at, state_version::text
          FROM trader_risk_account_state_v2 WHERE ${organizationFilter(query)} ORDER BY updated_at DESC LIMIT 201`)),
            ];
        data.controls = {
          killSwitches: switches.slice(0, 200).map((row) => ({
            id: String(row.id),
            organizationId: nullable(row.organization_id),
            scope: String(row.scope_type),
            type: String(row.switch_type),
            enforcement: String(row.enforcement_mode),
            state: String(row.state),
            origin: String(row.origin),
            version: String(row.state_version),
            at: iso(row.updated_at),
          })),
          liveEnable: live.slice(0, 200).map((row) => ({
            organizationId: String(row.organization_id),
            state: String(row.state),
            cap: String(row.max_notional_cap),
            currency: "USDT",
            at: iso(row.updated_at),
            coolingOffEndsAt: iso(row.cooling_off_ends_at),
          })),
          runtimeAuthority: runtime.slice(0, 200).map((row) => ({
            organizationId: String(row.organization_id),
            id: String(row.assessment_id),
            instance: String(row.runtime_instance_id),
            posture: String(row.posture),
            at: iso(row.adjudicated_at_utc),
          })),
          risk: risk.slice(0, 200).map((row) => ({
            organizationId: String(row.organization_id),
            accountId: String(row.account_id),
            posture: String(row.posture),
            reconciliation: String(row.reconciliation_status),
            killState: String(row.kill_state),
            limit: String(row.exposure_limit_notional),
            reserved: String(row.outstanding_reservation_notional),
            currency: String(row.quote_asset),
            at: iso(row.updated_at),
            version: String(row.state_version),
          })),
          accountBindingReason: query.exchange_account_id
            ? "RUNTIME_EXCHANGE_ACCOUNT_BINDING_NOT_PERSISTED"
            : null,
          truncated: [switches, live, runtime, risk].some((list) => list.length > 200),
        };
      }
      if (tab === "audit") {
        const bounds = periodBounds(query, new Date(now));
        const audit = query.exchange_account_id
          ? []
          : [
              ...(await tx.execute(sql`SELECT id::text, organization_id::text, actor_type, action, entity_type, entity_id, created_at, count(*) OVER()::text AS total
          FROM audit_logs WHERE ${organizationFilter(query)} AND created_at >= ${bounds.start}::timestamptz AND created_at < ${bounds.end}::timestamptz
          AND (action LIKE 'trader.%' OR action LIKE 'admin_console.%' OR entity_type LIKE 'trader_%') ORDER BY created_at DESC, id LIMIT ${query.limit}`)),
            ];
        data.audit = {
          items: audit.map((row) => ({
            id: String(row.id),
            organizationId: nullable(row.organization_id),
            actorType: String(row.actor_type),
            action: String(row.action),
            entityType: String(row.entity_type),
            entityId: nullable(row.entity_id),
            at: iso(row.created_at),
          })),
          total: query.exchange_account_id ? null : Number(audit[0]?.total ?? 0),
          reason: query.exchange_account_id ? "AUDIT_EXCHANGE_ACCOUNT_BINDING_NOT_PERSISTED" : null,
        };
      }
      return adminSuccess(
        adminEnvelope({ data, scope: adminScopeFromQuery(query), mode: query.mode }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
