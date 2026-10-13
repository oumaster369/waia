"use client";
import {
  ConsolePanel,
  ConsoleTable,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
export type InvoiceEvidence = {
  payments: Record<string, unknown>[];
  settlements: Record<string, unknown>[];
  corrections: Record<string, unknown>[];
  disputes: Record<string, unknown>[];
  history: Record<string, unknown>[];
  truncated: boolean;
};
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "Not saved";
const at = (value: unknown) => (typeof value === "string" ? value : null);
const label = (value: unknown) =>
  (
    ({
      DETECTED: "Payment detected",
      CONFIRMED: "Confirmed",
      APPLIED: "Applied",
      EXCEPTION: "Under reconciliation",
      FAILED: "Error",
      OPEN: "Opened",
      RESOLVED: "Resolved",
      CANCELLED: "Cancelled",
      "trader.invoice.issued": "Invoice issued",
      "trader.invoice.draft_generated": "Draft calculated",
      "trader.invoice.paid": "Invoice paid",
      "trader.invoice.issuance_approved": "Issuance confirmed",
      "trader.invoice.issuance_cancelled": "Confirmation revoked",
    }) as Record<string, string>
  )[text(value)] ?? text(value);
const money = (amount: unknown, currency: unknown) =>
  typeof amount === "string" && typeof currency === "string" ? (
    formatAdminMoney(amount, currency)
  ) : (
    <DataState state="unavailable" reason="PAYMENT_AMOUNT_NOT_RECORDED" />
  );
export function InvoiceEvidencePanel({ evidence }: { evidence: InvoiceEvidence }) {
  return (
    <div className="space-y-4">
      <ConsolePanel
        title="Payments and attestations"
        note="Payment detection does not mean application. Each row is a saved event."
      >
        <ConsoleTable
          caption="Invoice payment events"
          rows={evidence.payments}
          rowKey={(r) => text(r.id)}
          columns={[
            { title: "Event", render: (r) => label(r.type) },
            { title: "Amount", render: (r) => money(r.amount, r.asset) },
            {
              title: "Network and transaction",
              render: (r) => (
                <div className="max-w-56 break-all">
                  {text(r.network)}
                  <br />
                  {text(r.txHash)}
                </div>
              ),
            },
            {
              title: "Confirmations",
              render: (r) => `${text(r.confirmationsObserved)} / ${text(r.confirmationsRequired)}`,
            },
            { title: "Time", render: (r) => <EvidenceTime at={at(r.at)} label="" /> },
          ]}
        />
      </ConsolePanel>
      <ConsolePanel
        title="Application and reconciliation"
        note="Amounts and method come from saved settlement. stablecoin_par applies only to the payment."
      >
        <ConsoleTable
          caption="Invoice payment application"
          rows={evidence.settlements}
          rowKey={(r) => text(r.id)}
          columns={[
            {
              title: "Result",
              render: (r) => (
                <div>
                  {label(r.outcome)}
                  {r.reason ? <p className="text-waia-fg-muted text-xs">{text(r.reason)}</p> : null}
                </div>
              ),
            },
            {
              title: "Payment valuation",
              render: (r) => (
                <div>
                  {money(r.valuedAmount, r.currency)}
                  <p className="text-waia-fg-muted text-xs">{text(r.method)}</p>
                </div>
              ),
            },
            {
              title: "Applied",
              render: (r) => (r.applicationId ? money(r.appliedAmount, r.currency) : "Not applied"),
            },
            {
              title: "Reconciliation",
              render: (r) =>
                r.reconciliationStatus ? label(r.reconciliationStatus) : "Case not opened",
            },
            {
              title: "Time",
              render: (r) => <EvidenceTime at={at(r.appliedAt ?? r.at)} label="" />,
            },
          ]}
        />
      </ConsolePanel>
      <ConsolePanel
        title="Disputes and corrections"
        note="Corrections are shown separately and do not replace the saved invoice calculation."
      >
        <ConsoleTable<Record<string, unknown> & { kind: string }>
          caption="Invoice disputes and corrections"
          rows={[
            ...evidence.disputes.map((r) => ({ ...r, kind: "Dispute" })),
            ...evidence.corrections.map((r) => ({ ...r, kind: "Correction" })),
          ]}
          rowKey={(r) => `${r.kind}:${text(r.id)}`}
          columns={[
            { title: "Type", render: (r) => r.kind },
            { title: "State", render: (r) => label(r.status ?? r.type) },
            { title: "Reason", render: (r) => text(r.reason) },
            {
              title: "Amount",
              render: (r) =>
                r.kind === "Correction" ? money(r.amount, r.currency) : "Not applicable",
            },
            { title: "Initiator", render: (r) => text(r.actorId ?? r.actorType) },
            { title: "Time", render: (r) => <EvidenceTime at={at(r.at)} label="" /> },
          ]}
        />
      </ConsolePanel>
      <ConsolePanel
        title="Document history"
        note="Saved audit records. Revoking issuance confirmation does not cancel the invoice."
      >
        <ConsoleTable
          caption="Invoice audit"
          rows={evidence.history}
          rowKey={(r) => text(r.id)}
          columns={[
            { title: "Event", render: (r) => label(r.type) },
            { title: "Initiator", render: (r) => text(r.actorId ?? r.actorType) },
            { title: "Time", render: (r) => <EvidenceTime at={at(r.at)} label="" /> },
          ]}
        />
      </ConsolePanel>
      {evidence.truncated ? <DataState state="partial" reason="INVOICE_EVIDENCE_LIMIT" /> : null}
    </div>
  );
}
