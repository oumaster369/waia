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
  typeof value === "string" || typeof value === "number" ? String(value) : "Не сохранено";
const at = (value: unknown) => (typeof value === "string" ? value : null);
const label = (value: unknown) =>
  (
    ({
      DETECTED: "Платёж обнаружен",
      CONFIRMED: "Подтверждён",
      APPLIED: "Зачтён",
      EXCEPTION: "На сверке",
      FAILED: "Ошибка",
      OPEN: "Открыт",
      RESOLVED: "Решён",
      CANCELLED: "Отменён",
      "trader.invoice.issued": "Счёт выпущен",
      "trader.invoice.draft_generated": "Черновик рассчитан",
      "trader.invoice.paid": "Счёт оплачен",
      "trader.invoice.issuance_approved": "Выпуск подтверждён",
      "trader.invoice.issuance_cancelled": "Подтверждение отменено",
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
        title="Платежи и подтверждения"
        note="Обнаружение платежа не означает зачёт. Каждая строка — сохранённое событие."
      >
        <ConsoleTable
          caption="События платежей счёта"
          rows={evidence.payments}
          rowKey={(r) => text(r.id)}
          columns={[
            { title: "Событие", render: (r) => label(r.type) },
            { title: "Сумма", render: (r) => money(r.amount, r.asset) },
            {
              title: "Сеть и транзакция",
              render: (r) => (
                <div className="max-w-56 break-all">
                  {text(r.network)}
                  <br />
                  {text(r.txHash)}
                </div>
              ),
            },
            {
              title: "Подтверждения",
              render: (r) => `${text(r.confirmationsObserved)} / ${text(r.confirmationsRequired)}`,
            },
            { title: "Время", render: (r) => <EvidenceTime at={at(r.at)} label="" /> },
          ]}
        />
      </ConsolePanel>
      <ConsolePanel
        title="Зачёт и сверка"
        note="Суммы и метод — из сохранённого settlement. stablecoin_par применяется только к платежу."
      >
        <ConsoleTable
          caption="Зачёт платежей счёта"
          rows={evidence.settlements}
          rowKey={(r) => text(r.id)}
          columns={[
            {
              title: "Результат",
              render: (r) => (
                <div>
                  {label(r.outcome)}
                  {r.reason ? <p className="text-waia-fg-muted text-xs">{text(r.reason)}</p> : null}
                </div>
              ),
            },
            {
              title: "Оценка платежа",
              render: (r) => (
                <div>
                  {money(r.valuedAmount, r.currency)}
                  <p className="text-waia-fg-muted text-xs">{text(r.method)}</p>
                </div>
              ),
            },
            {
              title: "Зачтено",
              render: (r) => (r.applicationId ? money(r.appliedAmount, r.currency) : "Не зачтено"),
            },
            {
              title: "Сверка",
              render: (r) =>
                r.reconciliationStatus ? label(r.reconciliationStatus) : "Кейс не открыт",
            },
            {
              title: "Время",
              render: (r) => <EvidenceTime at={at(r.appliedAt ?? r.at)} label="" />,
            },
          ]}
        />
      </ConsolePanel>
      <ConsolePanel
        title="Споры и корректировки"
        note="Корректировки показаны отдельно и не заменяют сохранённый расчёт счёта."
      >
        <ConsoleTable<Record<string, unknown> & { kind: string }>
          caption="Споры и корректировки счёта"
          rows={[
            ...evidence.disputes.map((r) => ({ ...r, kind: "Спор" })),
            ...evidence.corrections.map((r) => ({ ...r, kind: "Корректировка" })),
          ]}
          rowKey={(r) => `${r.kind}:${text(r.id)}`}
          columns={[
            { title: "Тип", render: (r) => r.kind },
            { title: "Состояние", render: (r) => label(r.status ?? r.type) },
            { title: "Причина", render: (r) => text(r.reason) },
            {
              title: "Сумма",
              render: (r) =>
                r.kind === "Корректировка" ? money(r.amount, r.currency) : "Не применимо",
            },
            { title: "Инициатор", render: (r) => text(r.actorId ?? r.actorType) },
            { title: "Время", render: (r) => <EvidenceTime at={at(r.at)} label="" /> },
          ]}
        />
      </ConsolePanel>
      <ConsolePanel
        title="История документа"
        note="Сохранённые записи аудита. Отмена подтверждения выпуска не является отменой счёта."
      >
        <ConsoleTable
          caption="Аудит счёта"
          rows={evidence.history}
          rowKey={(r) => text(r.id)}
          columns={[
            { title: "Событие", render: (r) => label(r.type) },
            { title: "Инициатор", render: (r) => text(r.actorId ?? r.actorType) },
            { title: "Время", render: (r) => <EvidenceTime at={at(r.at)} label="" /> },
          ]}
        />
      </ConsolePanel>
      {evidence.truncated ? <DataState state="partial" reason="INVOICE_EVIDENCE_LIMIT" /> : null}
    </div>
  );
}
