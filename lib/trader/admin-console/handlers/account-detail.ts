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
import { readOverviewWithinSnapshot } from "@/lib/trader/admin-console/repositories/overview.postgres";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";
import { accountMode } from "@/lib/trader/admin-console/accounts/account-mode";
const rowsOf = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : []);
export async function handleAdminConsoleAccountDetailGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  accountId: string,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const split = accountId.indexOf(":"),
    venue = accountId.slice(0, split),
    exchangeId = accountId.slice(split + 1);
  if (split < 1 || !exchangeId || accountId.length > 300)
    return adminClientError(400, "BAD_REQUEST", "account id is invalid.");
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.accountDetail,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const now = new Date(),
        scope = adminScopeFromQuery(parsed.query);
      if (scope.kind === "account" && scope.exchangeAccountId !== exchangeId)
        return adminClientError(404, "NOT_FOUND", "account was not found.");
      const snapshot = await readOverviewWithinSnapshot(tx, {
        ...periodBounds(parsed.query, now),
        scope,
        currency: parsed.query.currency,
        mode: parsed.query.mode,
        nowMs: now.getTime(),
        currentPeriod: parsed.query.period !== "custom",
      });
      const finance = snapshot.accounts.find((a) => a.id === accountId);
      if (!finance) return adminClientError(404, "NOT_FOUND", "account was not found.");
      const org = finance.organizationId;
      if (!org)
        return adminSuccess(
          adminEnvelope({
            data: {
              finance,
              identity: null,
              credentials: [],
              risk: [],
              events: [],
              controls: [],
              facets: [],
            },
            financeRevision: snapshot.overview.financeRevision,
            scope,
            mode: snapshot.mode,
            missingSources: ["OWNERSHIP_CONFLICT"],
          }),
          "postgres",
        );
      const credentials = rowsOf(
        await tx.execute(sql`SELECT id::text, status::text, created_at::text, revoked_at::text
      FROM exchange_credentials WHERE organization_id = ${org}::uuid AND venue = ${venue} AND exchange_account_id = ${exchangeId}
      ORDER BY created_at, id`),
      );
      const risk = rowsOf(
        await tx.execute(sql`
      WITH bound_keys AS (
        SELECT DISTINCT p.account_id FROM trader_execution_plans_v2 p
        JOIN trader_orders o ON o.execution_plan_id = p.id AND o.organization_id = p.organization_id
        JOIN exchange_credentials c ON c.id = o.credential_id AND c.organization_id = o.organization_id
        WHERE c.organization_id = ${org}::uuid AND c.venue = ${venue} AND c.exchange_account_id = ${exchangeId}
          AND o.execution_mode = 'live' AND o.historical_run_id IS NULL
        UNION
        SELECT DISTINCT l.account_key FROM trader_position_lots l
        JOIN trader_trade_legs leg ON leg.position_lot_id = l.id AND leg.organization_id = l.organization_id
        JOIN trader_orders o ON o.id = leg.order_id AND o.organization_id = leg.organization_id
        JOIN exchange_credentials c ON c.id = o.credential_id AND c.organization_id = o.organization_id
        WHERE c.organization_id = ${org}::uuid AND c.venue = ${venue} AND c.exchange_account_id = ${exchangeId}
          AND o.execution_mode = 'live' AND o.historical_run_id IS NULL
      ) SELECT r.account_id, r.posture, r.kill_state, r.reconciliation_status, r.quote_asset,
          r.outstanding_reservation_notional::text, r.exposure_limit_notional::text, r.updated_at::text
        FROM trader_risk_account_state_v2 r JOIN bound_keys k ON k.account_id = r.account_id
        WHERE r.organization_id = ${org}::uuid ORDER BY r.account_id LIMIT 101
    `),
      );
      const controls = rowsOf(
        await tx.execute(sql`SELECT id::text, scope_type::text, switch_type::text, enforcement_mode::text, state::text, updated_at::text
      FROM trader_kill_switches WHERE (scope_type = 'platform' OR (scope_type = 'organization' AND organization_id = ${org}::uuid))
      ORDER BY scope_type, id`),
      );
      const authority = rowsOf(
        await tx.execute(sql`SELECT
      (SELECT state::text FROM trader_org_live_enable WHERE organization_id = ${org}::uuid) AS live_enable,
      (SELECT status::text FROM trader_account_status WHERE organization_id = ${org}::uuid AND exchange_account_id = ${exchangeId}) AS account_status,
      EXISTS(SELECT 1 FROM trader_orders o JOIN exchange_credentials c ON c.id = o.credential_id AND c.organization_id = o.organization_id
        WHERE o.organization_id = ${org}::uuid AND c.venue = ${venue} AND c.exchange_account_id = ${exchangeId}
          AND o.execution_mode = 'live' AND o.historical_run_id IS NULL
          AND o.created_at >= ${periodBounds(parsed.query, now).start}::timestamptz
          AND o.created_at < ${periodBounds(parsed.query, now).end}::timestamptz) AS live_activity`),
      )[0];
      const activeControls = controls.filter((c) => c.state !== "INACTIVE");
      const postures = risk.map((r) => String(r.posture));
      const posture = postures.includes("KILLED")
        ? "KILLED"
        : postures.includes("HALT")
          ? "HALT"
          : postures.includes("CLOSE_ONLY")
            ? "CLOSE_ONLY"
            : postures.length && postures.every((p) => p === "NORMAL")
              ? "NORMAL"
              : null;
      const identity = accountMode({
        kind: "exchange",
        liveEnable:
          authority.live_enable === "ENABLED"
            ? "ENABLED"
            : authority.live_enable
              ? "DISABLED"
              : null,
        posture,
        suspended: authority.account_status === "SUSPENDED",
        killSwitchActive:
          risk.some((r) => r.kill_state === "TRIPPED") ||
          activeControls.some((c) => c.enforcement_mode !== "CLOSE_ONLY"),
        liveOrderCount: authority.live_activity === true ? 1 : 0,
        paperOrderCount: 0,
      });
      if (
        identity.tradePermission === "undetermined" &&
        activeControls.some((c) => c.enforcement_mode === "CLOSE_ONLY")
      ) {
        identity.tradePermission = "close_only";
        identity.tradePermissionReason = "CLOSE_ONLY";
      }
      const observationEvents = rowsOf(
        await tx.execute(sql`SELECT o.observation_id::text AS id, o.recorded_at::text AS at,
      'observation' AS kind, o.payload->>'status' AS state FROM trader_account_observations o
      JOIN exchange_credentials c ON c.id = o.credential_id AND c.organization_id = o.organization_id
      WHERE o.organization_id = ${org}::uuid AND o.exchange_account_id = ${exchangeId} AND c.venue = ${venue}
      ORDER BY o.recorded_at DESC, o.observation_id DESC LIMIT 101`),
      );
      const statusEvents = rowsOf(
        await tx.execute(sql`SELECT id::text, created_at::text AS at, 'account_status' AS kind, event_type::text AS state
      FROM trader_account_status_events WHERE organization_id = ${org}::uuid AND exchange_account_id = ${exchangeId}
      ORDER BY seq DESC LIMIT 101`),
      );
      const events = [
        ...observationEvents.slice(0, 100),
        ...statusEvents.slice(0, 100),
        ...credentials.flatMap((c) => [
          { id: `${c.id}:created`, at: c.created_at, kind: "credential", state: "created" },
          ...(c.revoked_at
            ? [{ id: `${c.id}:revoked`, at: c.revoked_at, kind: "credential", state: "revoked" }]
            : []),
        ]),
      ].sort(
        (a, b) =>
          String(b.at).localeCompare(String(a.at)) || String(a.id).localeCompare(String(b.id)),
      );
      const connection = credentials.some((c) => c.status === "active")
        ? finance.observationStatus === "COMPLETE" && !finance.stale
          ? "Наблюдается"
          : "Ключ активен; наблюдение требует проверки"
        : "Нет активного ключа";
      const reconciliation = risk.length
        ? [...new Set(risk.map((r) => String(r.reconciliation_status)))].join(", ")
        : null;
      const facets = [
        { id: "connection", label: "Подключение", value: connection, reason: null },
        {
          id: "freshness",
          label: "Свежесть",
          value: finance.observedAt ? (finance.stale ? "Устарело" : "Актуально") : null,
          reason: finance.observedAt ? null : "OBSERVATION_MISSING",
        },
        {
          id: "completeness",
          label: "Полнота",
          value:
            finance.observationStatus === "COMPLETE"
              ? "Полное наблюдение"
              : finance.observationStatus === "PARTIAL"
                ? "Частичное наблюдение"
                : finance.observationStatus === "ERROR"
                  ? "Ошибка наблюдения"
                  : null,
          reason: finance.observationStatus ? null : "OBSERVATION_MISSING",
        },
        {
          id: "reconciliation",
          label: "Сверка",
          value: reconciliation,
          reason: reconciliation ? null : "RISK_ACCOUNT_BINDING_NOT_PERSISTED",
        },
        {
          id: "tradePermission",
          label: "Разрешение торговли",
          value:
            identity.tradePermission === "halted"
              ? "Остановлено"
              : identity.tradePermission === "close_only"
                ? "Только сокращение"
                : null,
          reason: identity.tradePermissionReason,
        },
      ];
      const truncated =
        observationEvents.length > 100 || statusEvents.length > 100 || risk.length > 100;
      return adminSuccess(
        adminEnvelope({
          data: {
            finance,
            identity,
            facets,
            credentials,
            risk: risk.slice(0, 100),
            controls,
            events,
            truncated,
            liveEnable: authority.live_enable,
          },
          financeRevision: snapshot.overview.financeRevision,
          scope,
          mode: snapshot.mode,
          missingSources: truncated ? ["ACCOUNT_EVIDENCE_CAP"] : [],
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
