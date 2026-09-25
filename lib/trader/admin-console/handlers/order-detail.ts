import { sql } from "drizzle-orm";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { orderScopeFilter } from "@/lib/trader/admin-console/sql/order-scope-filter";
import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";
import { presentConsoleOrder } from "@/lib/trader/admin-console/read-models/order";
import { buildOrderTrace } from "@/lib/trader/admin-console/read-models/order-trace";

const rowsOf = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null =>
  typeof value === "string" ? value : value instanceof Date ? value.toISOString() : null;
export async function handleAdminConsoleOrderDetailGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  orderId: string,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId))
    return adminClientError(400, "BAD_REQUEST", "order id is invalid.");
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.orderDetail,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const order = rowsOf(
        await tx.execute(sql`
        SELECT id::text, organization_id::text, execution_mode, historical_run_id, symbol, side,
               state, quantity, filled_quantity, client_order_id, exchange_order_id, created_at::text,
               execution_attempt_id::text, execution_plan_id::text, price AS limit_price, type AS order_type
        FROM trader_orders WHERE id = ${orderId}::uuid
          AND ${orderScopeFilter(parsed.query, "trader_orders")}
          AND ${orderVisibleInMode(parsed.query.mode, false)} LIMIT 1
      `),
      )[0];
      if (!order) return adminClientError(404, "NOT_FOUND", "order was not found.");
      const org = String(order.organization_id),
        attemptId = text(order.execution_attempt_id);
      // Explicit metadata projection: never read request payloads, venue raw observations or holdout data.
      const binding = attemptId
        ? rowsOf(
            await tx.execute(sql`
        SELECT a.id::text AS attempt_id, a.bound_at::text AS attempt_at, a.lifecycle_state AS attempt_state,
          p.id::text AS plan_id, p.sealed_at::text AS plan_at, p.planned_quantity, p.limit_price AS plan_price,
          p.risk_allowance_id::text, p.risk_verdict_id::text, p.decision_id, p.forecast_id,
          al.id::text AS allowance_id, al.issued_at::text AS allowance_at, al.lifecycle_state AS allowance_state,
          al.exact_qualified_quantity, al.valid_until::text,
          v.id::text AS verdict_id, v.issued_at::text AS verdict_at, v.verdict, v.approved_qualified_quantity,
          d.id::text AS decision_record_id, d.issued_at::text AS decision_at, d.decision_class,
          d.universal_terminal_reason_code, d.strategy_id, d.strategy_version, d.cycle_envelope_id::text,
          f.id::text AS forecast_record_id, f.issued_at::text AS forecast_at,
          f.market_question, f.target_window_start_at::text, f.target_window_end_at::text
        FROM trader_execution_attempts_v2 a
        LEFT JOIN trader_execution_plans_v2 p ON p.id = a.execution_plan_id
          AND p.organization_id = a.organization_id AND p.account_id = a.account_id
          AND p.id::text = ${text(order.execution_plan_id)} AND p.content_digest = a.execution_plan_content_digest
        LEFT JOIN trader_risk_allowances_v2 al ON al.id = p.risk_allowance_id
          AND al.organization_id = p.organization_id AND al.account_id = p.account_id
        LEFT JOIN trader_risk_verdicts_v2 v ON v.id = p.risk_verdict_id
          AND v.organization_id = p.organization_id AND v.account_id = p.account_id
        LEFT JOIN trader_intelligence_decision_record d ON d.id::text = p.decision_id
          AND d.organization_id = p.organization_id AND d.content_digest = p.decision_content_digest
        LEFT JOIN trader_intelligence_forecast_record f ON f.id::text = p.forecast_id
          AND f.organization_id = p.organization_id AND f.content_digest = p.forecast_content_digest
        WHERE a.id = ${attemptId}::uuid AND a.organization_id = ${org}::uuid AND a.order_id = ${orderId}::uuid
        LIMIT 1
      `),
          )[0]
        : undefined;
      const reports = binding
        ? rowsOf(
            await tx.execute(sql`
        SELECT r.id::text, r.observed_at::text AS at, r.report_type AS type, r.source,
          r.report_sequence::text AS sequence, r.venue_order_id
        FROM trader_execution_reports_v2 r
        WHERE r.organization_id = ${org}::uuid AND r.execution_attempt_id = ${attemptId}::uuid
        ORDER BY r.report_sequence, r.id LIMIT 501
      `),
          )
        : [];
      const events = rowsOf(
        await tx.execute(sql`
        SELECT id::text, occurred_at::text AS at, event_type AS type, from_state, to_state, seq
        FROM trader_order_events WHERE organization_id = ${org}::uuid AND order_id = ${orderId}::uuid
        ORDER BY seq, id LIMIT 501
      `),
      );
      const fills = rowsOf(
        await tx.execute(sql`
        SELECT id::text, executed_at::text AS at, price, quantity, fee, fee_asset
        FROM trader_fills WHERE organization_id = ${org}::uuid AND order_id = ${orderId}::uuid
        ORDER BY executed_at, id LIMIT 501
      `),
      );
      const record = (prefix: string) =>
        binding?.[`${prefix}_id`] && binding?.[`${prefix}_at`]
          ? { id: String(binding[`${prefix}_id`]), at: String(binding[`${prefix}_at`]) }
          : null;
      const attempt = record("attempt"),
        plan = record("plan");
      const trace = buildOrderTrace({
        orderId,
        executionAttemptId: attemptId,
        attempt: attempt ? { ...attempt, executionPlanId: String(binding?.plan_id ?? "") } : null,
        plan: plan
          ? {
              ...plan,
              riskAllowanceId: text(binding?.risk_allowance_id),
              riskVerdictId: text(binding?.risk_verdict_id),
              decisionId: text(binding?.decision_id),
              forecastId: text(binding?.forecast_id),
            }
          : null,
        allowance: record("allowance"),
        verdict: record("verdict"),
        decision: binding?.decision_record_id
          ? { id: String(binding.decision_record_id), at: String(binding.decision_at) }
          : null,
        forecast: binding?.forecast_record_id
          ? { id: String(binding.forecast_record_id), at: String(binding.forecast_at) }
          : null,
        reports: reports.map((r) => ({ id: String(r.id), at: String(r.at) })),
        events: events.map((r) => ({ id: String(r.id), at: String(r.at) })),
        fills: fills.map((r) => ({ id: String(r.id), at: String(r.at) })),
      });
      const truncated = reports.length > 500 || events.length > 500 || fills.length > 500;
      return adminSuccess(
        adminEnvelope({
          data: {
            order: {
              ...presentConsoleOrder(order),
              limitPrice: text(order.limit_price),
              orderType: text(order.order_type),
            },
            trace,
            evidence: binding ?? null,
            reports: reports.slice(0, 500),
            events: events.slice(0, 500),
            fills: fills.slice(0, 500),
            truncated,
          },
          missingSources: truncated ? ["ORDER_EVIDENCE_CAP"] : [],
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
