import { createRequire } from "node:module";
import { sql } from "drizzle-orm";

import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";
import { parseInvoicePaymentGracePeriodMs } from "@/lib/trader/settlement/account-status-policy";
import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { dedupeAccounts, type AccountCredential } from "@/lib/trader/admin-console/accounts/dedupe";
import {
  buildAttention,
  consecutiveFailedJobStreak,
  splitStaleAccounts,
} from "@/lib/trader/admin-console/attention";
import { invoiceDueAt } from "@/lib/trader/admin-console/billing/invoice-display-status";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") require("server-only");

const LIST_CAP = 200;

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function ids(rows: Record<string, unknown>[], key = "id"): string[] {
  return rows.flatMap((row) => {
    const value = row[key];
    return typeof value === "string" && value.length > 0 ? [value] : [];
  });
}

function capped(rows: Record<string, unknown>[]): { ids: string[]; capped: boolean } {
  return { ids: ids(rows.slice(0, LIST_CAP)), capped: rows.length > LIST_CAP };
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

export async function handleAdminConsoleAttentionGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  const organizationId = parsed.query.organization_id ?? null;
  const nowMs = Date.now();
  try {
    const snapshot = await withAdminReadSnapshot(opened.runtime.db, async (tx) => {
      const missing: string[] = [];
      const take = async (query: Promise<unknown>, key = "id") => {
        const rows = rowsOf(await query);
        const page = capped(rows.map((row) => ({ ...row, id: row[key] })));
        if (page.capped) missing.push("ATTENTION_LIST_CAPPED");
        return page.ids;
      };
      const reconciliationRequiredOrderIds = await take(tx.execute(sql`
        SELECT id::text AS id
        FROM trader_orders
        WHERE state = 'RECONCILIATION_REQUIRED'
          AND historical_run_id IS NULL
          AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
        LIMIT ${LIST_CAP + 1}
      `));
      const sentWithoutReportOrderIds = await take(tx.execute(sql`
        SELECT o.id::text AS id
        FROM trader_orders o
        WHERE o.state = 'SENT_TO_EXCHANGE'
          AND o.historical_run_id IS NULL
          AND o.updated_at < now() - interval '5 minutes'
          AND (
            o.execution_attempt_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM trader_execution_reports_v2 r
              WHERE r.organization_id = o.organization_id
                AND r.execution_attempt_id = o.execution_attempt_id
            )
          )
          AND (${organizationId}::uuid IS NULL OR o.organization_id = ${organizationId}::uuid)
        LIMIT ${LIST_CAP + 1}
      `));
      const halted = rowsOf(
        await tx.execute(sql`
          SELECT organization_id::text AS id
          FROM (
            SELECT DISTINCT ON (organization_id) organization_id, posture
            FROM trader_runtime_authority_assessments_v2
            WHERE (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
            ORDER BY organization_id, created_at DESC
          ) latest
          WHERE posture = 'HALT'
          LIMIT 1
        `),
      );
      const killed = rowsOf(
        await tx.execute(sql`
          SELECT account_id AS id
          FROM trader_risk_account_state_v2
          WHERE posture = 'KILLED'
            AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
          LIMIT 1
        `),
      );
      const lotsMissingGuardian = await take(tx.execute(sql`
        SELECT l.id::text AS id
        FROM trader_position_lots l
        LEFT JOIN LATERAL (
          SELECT DISTINCT ON (a.lot_id) a.created_at
          FROM trader_guardian_assessments_v2 a
          WHERE a.lot_id = l.id
            AND a.organization_id = l.organization_id
          ORDER BY a.lot_id, a.created_at DESC
        ) g ON true
        WHERE l.state = 'OPEN'
          AND (
            g.created_at IS NULL
            OR g.created_at < now() - interval '15 minutes'
          )
          AND (${organizationId}::uuid IS NULL OR l.organization_id = ${organizationId}::uuid)
        LIMIT ${LIST_CAP + 1}
      `));
      const divergentAccountIds = await take(
        tx.execute(sql`
          SELECT account_id AS id
          FROM trader_risk_account_state_v2
          WHERE reconciliation_status = 'DIVERGENT'
            AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
          LIMIT ${LIST_CAP + 1}
        `),
      );
      const openReconciliationCaseIds = await take(tx.execute(sql`
        SELECT id::text AS id
        FROM trader_settlement_reconciliation_cases
        WHERE status NOT IN ('RESOLVED', 'CANCELLED')
          AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
        LIMIT ${LIST_CAP + 1}
      `));
      const observationRows = rowsOf(
        await tx.execute(sql`
          SELECT s.exchange_account_id,
                 s.consecutive_failures,
                 o.recorded_at,
                 (
                   EXISTS (
                     SELECT 1
                     FROM trader_orders ord
                     JOIN exchange_credentials c
                       ON c.id = ord.credential_id
                      AND c.organization_id = ord.organization_id
                     WHERE c.organization_id = s.organization_id
                       AND c.exchange_account_id = s.exchange_account_id
                       AND ord.historical_run_id IS NULL
                       AND ord.state IN (
                         'CREATED','RISK_APPROVED','SENT_TO_EXCHANGE','ACCEPTED',
                         'PARTIALLY_FILLED','CANCEL_REQUESTED','RECONCILIATION_REQUIRED'
                       )
                   )
                   OR EXISTS (
                     SELECT 1
                     FROM trader_position_lots l
                     JOIN trader_trade_legs leg
                       ON leg.position_lot_id = l.id
                      AND leg.organization_id = l.organization_id
                     JOIN trader_orders ord
                       ON ord.id = leg.order_id
                      AND ord.organization_id = leg.organization_id
                     JOIN exchange_credentials c
                       ON c.id = ord.credential_id
                      AND c.organization_id = ord.organization_id
                     WHERE l.state = 'OPEN'
                       AND c.organization_id = s.organization_id
                       AND c.exchange_account_id = s.exchange_account_id
                   )
                 ) AS active
          FROM trader_account_collection_state s
          LEFT JOIN trader_account_observations o
            ON o.organization_id = s.organization_id
           AND o.credential_id = s.credential_id
           AND o.exchange_account_id = s.exchange_account_id
           AND o.observation_id = s.last_observation_id
          WHERE (${organizationId}::uuid IS NULL OR s.organization_id = ${organizationId}::uuid)
          LIMIT ${LIST_CAP + 1}
        `),
      );
      if (observationRows.length > LIST_CAP) missing.push("ATTENTION_LIST_CAPPED");
      const stale = splitStaleAccounts(
        observationRows.slice(0, LIST_CAP).flatMap((row) => {
          const exchangeAccountId =
            typeof row.exchange_account_id === "string" ? row.exchange_account_id : null;
          if (!exchangeAccountId) return [];
          const recordedAt = iso(row.recorded_at);
          const age = recordedAt === null ? Number.POSITIVE_INFINITY : nowMs - Date.parse(recordedAt);
          const failures = Number(row.consecutive_failures ?? 0);
          return [
            {
              exchangeAccountId,
              stale:
                !Number.isFinite(age) ||
                age > ACCOUNT_OBSERVATION_STALE_AFTER_MS ||
                failures > 0,
              active: flag(row.active),
            },
          ];
        }),
      );
      const jobRows = rowsOf(
        await tx.execute(sql`
          SELECT job_key, started_at, status
          FROM trader_admin_job_run
          ORDER BY started_at DESC
          LIMIT 200
        `),
      );
      const failedJobStreak = consecutiveFailedJobStreak(
        jobRows.flatMap((row) => {
          const startedAt =
            row.started_at instanceof Date
              ? row.started_at.getTime()
              : Date.parse(String(row.started_at));
          if (!Number.isFinite(startedAt) || typeof row.job_key !== "string") return [];
          return [{ jobKey: row.job_key, startedAtMs: startedAt, status: String(row.status) }];
        }),
      );
      const incidents = rowsOf(
        await tx.execute(sql`
          SELECT id::text AS id
          FROM trader_admin_incident
          WHERE lower(severity) IN ('fatal', 'error')
            AND status <> 'resolved'
            AND last_seen_at >= now() - interval '1 hour'
          LIMIT ${LIST_CAP + 1}
        `),
      );
      const credentialRows = rowsOf(
        await tx.execute(sql`
          SELECT c.id::text AS credential_id,
                 c.organization_id::text AS organization_id,
                 c.venue,
                 c.exchange_account_id,
                 c.created_at
          FROM exchange_credentials c
          WHERE (${organizationId}::uuid IS NULL OR c.organization_id = ${organizationId}::uuid)
        `),
      );
      const credentials: AccountCredential[] = credentialRows.flatMap((row) => {
        if (
          typeof row.credential_id !== "string" ||
          typeof row.organization_id !== "string" ||
          typeof row.venue !== "string" ||
          typeof row.exchange_account_id !== "string"
        ) {
          return [];
        }
        const createdAt = iso(row.created_at);
        if (!createdAt) return [];
        return [
          {
            credentialId: row.credential_id,
            organizationId: row.organization_id,
            venue: row.venue,
            exchangeAccountId: row.exchange_account_id,
            ownerEmail: null,
            createdAt,
          },
        ];
      });
      const ownershipConflicts = dedupeAccounts(credentials)
        .filter((account) => account.conflict)
        .map((account) => `${account.venue}:${account.exchangeAccountId}`);
      const graceMs = parseInvoicePaymentGracePeriodMs(process.env);
      const nowIso = new Date(nowMs).toISOString();
      const invoiceRows = rowsOf(
        await tx.execute(sql`
          SELECT id::text AS id, issued_at
          FROM trader_invoices
          WHERE status = 'ISSUED'
            AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
          LIMIT ${LIST_CAP + 1}
        `),
      );
      if (invoiceRows.length > LIST_CAP) missing.push("ATTENTION_LIST_CAPPED");
      const overdueInvoiceIds = invoiceRows.slice(0, LIST_CAP).flatMap((row) => {
        const issuedAt = iso(row.issued_at);
        const dueAt = invoiceDueAt(issuedAt, graceMs);
        if (!dueAt || Date.parse(nowIso) <= Date.parse(dueAt)) return [];
        return typeof row.id === "string" ? [row.id] : [];
      });
      const settlementExceptions = await take(tx.execute(sql`
        SELECT id::text AS id
        FROM trader_settlements
        WHERE outcome = 'EXCEPTION'
          AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
        LIMIT ${LIST_CAP + 1}
      `));
      const blockedPeriodIds = await take(tx.execute(sql`
        SELECT id::text AS id
        FROM trader_reporting_periods
        WHERE status = 'OPEN'
          AND period_end IS NOT NULL
          AND period_end < now() - interval '24 hours'
          AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
        LIMIT ${LIST_CAP + 1}
      `));
      const promotionProposalIds = await take(tx.execute(sql`
        SELECT id::text AS id
        FROM trader_human_promotion_proposal_v2
        WHERE disposition = 'pending'
          AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
        LIMIT ${LIST_CAP + 1}
      `));
      return {
        missing,
        items: buildAttention({
          reconciliationRequiredOrderIds,
          sentWithoutReportOrderIds,
          runtimeHalted: halted.length > 0,
          killed: killed.length > 0,
          lotsMissingGuardian,
          divergentAccountIds,
          openReconciliationCaseIds,
          staleActiveAccountIds: stale.active,
          failedJobStreak,
          recentFatalIncidents: incidents.length > LIST_CAP ? LIST_CAP : incidents.length,
          ownershipConflicts,
          overdueInvoiceIds,
          settlementExceptions,
          blockedPeriodIds,
          staleQuietAccountIds: stale.quiet,
          promotionProposalIds,
          noTradeCount: 0,
        }),
      };
    });
    return adminSuccess(
      adminEnvelope({
        data: { items: snapshot.value.items },
        scope: adminScopeFromQuery(parsed.query),
        mode: parsed.query.mode,
        cursor: snapshot.cursor,
        missingSources: [...new Set(snapshot.value.missing)],
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
