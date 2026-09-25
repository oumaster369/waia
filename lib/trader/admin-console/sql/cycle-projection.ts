import { sql } from "drizzle-orm";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { organizationFilter, column } from "@/lib/trader/admin-console/sql/read-scope";

/** Shared by cycle lists and details. Explicit metadata columns, never payloads. */
export function cycleProjection(query: AdminConsoleQuery) {
  return sql`SELECT e.id,e.organization_id,e.run_id,e.cycle_id,e.symbol,e.evaluated_at,e.terminal_reason_code,
    CASE WHEN EXISTS (SELECT 1 FROM trader_historical_simulation_run_start_v2 h WHERE h.organization_id=e.organization_id AND h.run_id=e.run_id) THEN 'history'
      WHEN linked.modes=ARRAY['live']::text[] THEN 'live' WHEN linked.modes=ARRAY['paper']::text[] THEN 'paper' ELSE 'undetermined' END AS mode,
    linked.accounts
    FROM trader_intelligence_cycle_envelope e
    LEFT JOIN LATERAL (SELECT array_agg(DISTINCT CASE WHEN o.historical_run_id IS NOT NULL THEN 'history' ELSE o.execution_mode::text END) AS modes,
      array_agg(DISTINCT c.exchange_account_id) AS accounts
      FROM trader_intelligence_decision_record d JOIN trader_execution_plans_v2 p ON p.organization_id=d.organization_id AND p.decision_id=d.id::text
      JOIN trader_orders o ON o.organization_id=p.organization_id AND o.execution_plan_id=p.id
      LEFT JOIN exchange_credentials c ON c.organization_id=o.organization_id AND c.id=o.credential_id
      WHERE d.organization_id=e.organization_id AND d.cycle_envelope_id=e.id) linked ON true
    WHERE ${organizationFilter(query, "e")}`;
}
export function cycleModeScopeFilter(query: AdminConsoleQuery, alias: string) {
  return sql`(${query.mode}::text='all' OR ${column(alias, "mode")}=${query.mode}::text)
    AND (${query.exchange_account_id ?? null}::text IS NULL OR ${query.exchange_account_id ?? null}::text=ANY(${column(alias, "accounts")}))`;
}
