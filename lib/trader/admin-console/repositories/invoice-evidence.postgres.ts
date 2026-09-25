import { redactDiagnosticText } from "@/lib/trader/admin-console/diagnostics/redact";
import { sql } from "drizzle-orm";
import type { AdminReadTx } from "./snapshot.postgres";
// Whitelisted ledger columns only. Never read payment credentials or opaque evidence payloads.
export async function readInvoiceEvidence(
  tx: AdminReadTx,
  organizationId: string,
  invoiceId: string,
) {
  const payments =
    await tx.execute(sql`SELECT e.id::text, e.payment_id::text AS "paymentId", e.event_type::text AS type,
    e.settlement_asset AS asset, e.settlement_amount AS amount, e.settlement_network AS network,
    e.settlement_tx_hash AS "txHash", e.confirmations_required AS "confirmationsRequired", e.confirmations_observed AS "confirmationsObserved",
    e.created_at::text AS at
    FROM payment_events e WHERE e.organization_id=${organizationId}::uuid AND e.subject_module='trader' AND e.subject_invoice_id=${invoiceId}
    ORDER BY e.created_at DESC,e.id LIMIT 1001`);
  const settlements =
    await tx.execute(sql`SELECT s.id::text, s.payment_id::text AS "paymentId", s.outcome::text,
    s.exception_reason AS reason, s.asset, s.on_chain_amount AS amount, s.valuation_currency AS currency,
    s.valued_amount AS "valuedAmount", s.valuation_basis AS method, s.created_at::text AS at,
    a.id::text AS "applicationId", a.applied_amount AS "appliedAmount", a.created_at::text AS "appliedAt", r.status::text AS "reconciliationStatus"
    FROM trader_settlements s
    JOIN payments p ON p.payment_id=s.payment_id AND p.organization_id=s.organization_id
    LEFT JOIN trader_settlement_applications a ON a.settlement_id=s.id AND a.organization_id=s.organization_id AND a.invoice_id=${invoiceId}::uuid
    LEFT JOIN trader_settlement_reconciliation_cases r ON r.settlement_id=s.id AND r.organization_id=s.organization_id
    WHERE s.organization_id=${organizationId}::uuid AND p.subject_module='trader' AND p.subject_invoice_id=${invoiceId}
    ORDER BY s.created_at DESC,s.id LIMIT 1001`);
  const corrections =
    await tx.execute(sql`SELECT id::text, correction_type::text AS type, amount, currency, reason, actor_type::text AS "actorType", actor_id AS "actorId", created_at::text AS at
    FROM trader_invoice_corrections WHERE organization_id=${organizationId}::uuid AND invoice_id=${invoiceId}::uuid ORDER BY created_at DESC,id LIMIT 1001`);
  const disputes =
    await tx.execute(sql`SELECT id::text, status::text, reason, opened_by AS "actorId", opened_at::text AS at, resolved_at::text AS "resolvedAt", resolution_reason AS "resolutionReason"
    FROM trader_invoice_disputes WHERE organization_id=${organizationId}::uuid AND invoice_id=${invoiceId}::uuid ORDER BY opened_at DESC,id LIMIT 1001`);
  const history =
    await tx.execute(sql`SELECT id::text, action AS type, actor_type::text AS "actorType", actor_id AS "actorId", created_at::text AS at
    FROM audit_logs WHERE organization_id=${organizationId}::uuid AND entity_id=${invoiceId} AND entity_type='trader.invoice'
    ORDER BY created_at DESC,id LIMIT 1001`);
  const lists = { payments, settlements, corrections, disputes, history };
  return {
    ...Object.fromEntries(
      Object.entries(lists).map(([key, rows]) => [
        key,
        [...rows]
          .slice(0, 1000)
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([field, value]) => [
                field,
                ["reason", "resolutionReason"].includes(field) && typeof value === "string"
                  ? redactDiagnosticText(value)
                  : value,
              ]),
            ),
          ),
      ]),
    ),
    truncated: Object.values(lists).some((rows) => rows.length > 1000),
  } as {
    [K in keyof typeof lists]: Record<string, unknown>[];
  } & { truncated: boolean };
}
