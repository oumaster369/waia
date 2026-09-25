import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";

import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { assembleCycleTrace } from "@/lib/trader/admin-console/research/cycle-trace";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import {
  cycleProjection,
  cycleModeScopeFilter,
} from "@/lib/trader/admin-console/sql/cycle-projection";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function handleAdminConsoleCycleTraceGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  envelopeId: string,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(envelopeId)) {
    return adminClientError(400, "BAD_REQUEST", "cycle id is invalid.");
  }
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.cycleTrace,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT e.id::text AS id,
               e.organization_id::text AS organization_id,
               e.run_id,
               e.cycle_id,
               e.symbol,
               e.evaluated_at,
               e.terminal_reason_code,
               (
                 SELECT h.id::text
                 FROM trader_intelligence_hypothesis_record h
                 WHERE h.cycle_envelope_id = e.id
                   AND h.organization_id = e.organization_id
                 ORDER BY h.evaluated_at DESC, h.id
                 LIMIT 1
               ) AS hypothesis_id,
               (
                 SELECT f.id::text
                 FROM trader_intelligence_forecast_record f
                 WHERE f.cycle_envelope_id = e.id
                   AND f.organization_id = e.organization_id
                 ORDER BY f.evaluated_at DESC, f.id
                 LIMIT 1
               ) AS forecast_id,
               (
                 SELECT d.id::text
                 FROM trader_intelligence_decision_record d
                 WHERE d.cycle_envelope_id = e.id
                   AND d.organization_id = e.organization_id
                 ORDER BY d.evaluated_at DESC, d.id
                 LIMIT 1
               ) AS decision_id
        FROM (${cycleProjection(parsed.query)}) e
        WHERE e.id = ${envelopeId}::uuid
          AND ${cycleModeScopeFilter(parsed.query, "e")}
        LIMIT 1
      `),
      );
      const row = rows[0];
      if (!row) return adminClientError(404, "NOT_FOUND", "cycle was not found.");
      const decisionId = text(row.decision_id);
      const organizationId = String(row.organization_id);
      let riskVerdictId: string | null = null;
      let executionPlanId: string | null = null;
      let orderId: string | null = null;
      let fillId: string | null = null;
      if (decisionId) {
        const linked = rowsOf(
          await tx.execute(sql`
          SELECT (
                   SELECT v.id::text
                   FROM trader_risk_verdicts_v2 v
                   WHERE v.organization_id = ${organizationId}::uuid
                     AND v.decision_id = ${decisionId}
                   ORDER BY v.id
                   LIMIT 1
                 ) AS risk_verdict_id,
                 (
                   SELECT p.id::text
                   FROM trader_execution_plans_v2 p
                   WHERE p.organization_id = ${organizationId}::uuid
                     AND p.decision_id = ${decisionId}
                   ORDER BY p.id
                   LIMIT 1
                 ) AS execution_plan_id
        `),
        );
        riskVerdictId = text(linked[0]?.risk_verdict_id);
        executionPlanId = text(linked[0]?.execution_plan_id);
      }
      if (executionPlanId) {
        const orders = rowsOf(
          await tx.execute(sql`
          SELECT o.id::text AS order_id,
                 (
                   SELECT f.id::text
                   FROM trader_fills f
                   WHERE f.organization_id = o.organization_id
                     AND f.order_id = o.id
                   ORDER BY f.executed_at DESC, f.id
                   LIMIT 1
                 ) AS fill_id
          FROM trader_orders o
          WHERE o.organization_id = ${organizationId}::uuid
            AND o.execution_plan_id = ${executionPlanId}::uuid
          ORDER BY o.created_at DESC, o.id
          LIMIT 1
        `),
        );
        orderId = text(orders[0]?.order_id);
        fillId = text(orders[0]?.fill_id);
      }
      return adminSuccess(
        adminEnvelope({
          data: {
            envelope: {
              id: String(row.id),
              organizationId,
              runId: String(row.run_id),
              cycleId: String(row.cycle_id),
              symbol: String(row.symbol),
              evaluatedAt: iso(row.evaluated_at),
              terminalReasonCode: String(row.terminal_reason_code),
            },
            stages: assembleCycleTrace({
              hypothesisId: text(row.hypothesis_id),
              forecastId: text(row.forecast_id),
              decisionId,
              riskVerdictId,
              executionPlanId,
              orderId,
              fillId,
            }),
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
