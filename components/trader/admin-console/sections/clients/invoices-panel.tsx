"use client";
import * as React from "react";
import { ExportButton } from "@/components/trader/admin-console/primitives/export-button";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { notifyAdminAccessRevoked } from "@/components/trader/admin-console/data/access-events";
import { InvoiceAttestations } from "@/components/trader/admin-console/sections/clients/invoice-attestations";
import {
  ConsoleBadge,
  ConsoleDialog,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  DetailLink,
  EvidenceTime,
  controlClass,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import type { IssuanceAttestation } from "@/lib/trader/billing/invoice-issuance.types";
import type { InvoiceDisplay } from "@/lib/trader/admin-console/billing/invoice-display-status";
import { InvoiceEvidencePanel, type InvoiceEvidence } from "./invoice-evidence";
type InvoiceItem = {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
  performanceFee: string;
  currency: string;
  status: string;
  display: InvoiceDisplay;
  revision: string;
};
type Detail = {
  evidence?: InvoiceEvidence;
  id: string;
  revision: string;
  organizationId: string;
  currency: string;
  status: string;
  display: InvoiceDisplay;
  approvedAt: string | null;
  coolingOffUntil: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  dueAt: string | null;
  stored: {
    periodProfit: string;
    cumulative: string;
    previousHwm: string;
    newProfitAboveHwm: string;
    feeRate: string;
    performanceFee: string;
    billable: boolean;
  };
  chain: { ok: boolean | null; link?: string; reasons?: string[]; mismatches?: string[] };
};
export function InvoicesPanel() {
  const context = useAdminReadContext();
  const list = useAdminRead<{
    items: InvoiceItem[];
    aggregate: { currency: string; amount: string | null; count: number }[];
    total: number;
    truncated: boolean;
  }>(
    `/api/trader/admin/console/invoices${context.params.get("status") ? `?status=${encodeURIComponent(context.params.get("status")!)}` : ""}`,
  );
  const items = list.envelope?.data.items;
  const selected = context.params.get("sel");
  const detail = useAdminRead<Detail>(
    selected ? `/api/trader/admin/console/invoices/${encodeURIComponent(selected)}` : null,
  );
  const current = detail.envelope?.data.stored ? detail.envelope.data : null;
  const invoice = items?.find((item) => item.id === selected) ?? current;
  const [epoch, resetConfirmations] = React.useReducer((n: number) => n + 1, 0);
  const [pending, setPending] = React.useState(false);
  const [readBackRequired, setReadBackRequired] = React.useState(false);
  const inFlight = React.useRef(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [issueConfirmed, setIssueConfirmed] = React.useState(false);
  const identity = `${context.query}:${invoice?.id ?? ""}:${current?.revision ?? ""}:${epoch}`;
  const [issueIdentity, setIssueIdentity] = React.useState<string | null>(null);
  async function command(body: Record<string, unknown>) {
    if (!invoice || !current || pending || inFlight.current || readBackRequired) return;
    inFlight.current = true;
    setPending(true);
    setReadBackRequired(true);
    resetConfirmations();
    setIssueConfirmed(false);
    setMessage(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        context.href(`/api/trader/admin/console/invoices/${invoice.id}/commands`),
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            organization_id: invoice.organizationId,
            expectedRevision: current.revision,
            ...body,
          }),
        },
      );
      if (response.status === 401 || response.status === 403) {
        notifyAdminAccessRevoked();
        return;
      }
      const result = await response.json();
      const verify = await fetch(context.href(`/api/trader/admin/console/invoices/${invoice.id}`), {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (verify.status === 401 || verify.status === 403) {
        notifyAdminAccessRevoked();
        return;
      }
      const fresh = await verify.json();
      if (!verify.ok || fresh.data?.id !== invoice.id || typeof fresh.data.revision !== "string")
        throw new Error("READ_BACK_FAILED");
      detail.reload();
      list.reload();
      setReadBackRequired(false);
      setMessage(
        response.status === 409
          ? "Документ изменился. Проверьте свежий расчёт и отметьте подтверждения заново."
          : response.ok && fresh.data.revision === result.revision
            ? "Команда подтверждена повторным чтением документа."
            : response.ok
              ? "После команды документ изменился ещё раз. Проверьте актуальное состояние."
              : `Команда отклонена: ${result.error?.code ?? "UNKNOWN"}. Сохранённый документ перечитан.`,
      );
    } catch {
      setMessage(
        "Подтверждение не получено. Команда могла примениться. Повтор закрыт до отдельного чтения документа.",
      );
    } finally {
      window.clearTimeout(timeout);
      setPending(false);
      inFlight.current = false;
    }
  }
  const canIssue =
    current?.status === "DRAFT" &&
    Boolean(current.approvedAt && current.coolingOffUntil) &&
    Date.parse(current.coolingOffUntil!) <= Date.parse(detail.envelope?.generatedAt ?? "");
  return (
    <div className="space-y-5">
      {list.loading ? <ConsoleLoading /> : null}
      {list.reason ? <DataState state="unavailable" reason={list.reason} /> : null}
      {list.envelope?.data.aggregate ? (
        <div className="flex flex-wrap gap-3">
          {list.envelope.data.aggregate.map((row) => (
            <div
              key={row.currency}
              className="border-waia-divider bg-waia-field-mid rounded-xl border px-5 py-4"
            >
              <p className="text-waia-fg-muted text-xs">
                Сохранённая комиссия · {row.count} документов
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {row.amount === null ? "—" : formatAdminMoney(row.amount, row.currency)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {items ? (
        <ConsolePanel
          title="Счета на оплату"
          note="Расчёт и черновик автоматические. Выпуск — после подтверждения администратора."
        >
          <ConsoleTable
            rows={items}
            rowKey={(row) => row.id}
            caption="Счета на оплату"
            columns={[
              {
                title: "Документ / биржевой счёт",
                render: (row) => (
                  <div>
                    <DetailLink
                      onClick={() => {
                        context.update({ sel: row.id });
                        resetConfirmations();
                        setCancelReason("");
                        setIssueConfirmed(false);
                        setMessage(null);
                      }}
                    >
                      {row.id}
                    </DetailLink>
                    <p className="text-waia-fg-muted mt-1 text-xs">{row.exchangeAccountId}</p>
                  </div>
                ),
              },
              {
                title: "Статус",
                render: (row) => (
                  <div className="space-y-2">
                    <ConsoleBadge>{row.display.status}</ConsoleBadge>
                    {row.display.payment ? (
                      <p className="text-waia-fg-muted text-xs">{row.display.payment}</p>
                    ) : null}
                    {row.display.flags?.map((flag) => (
                      <p key={flag} className="text-waia-warning text-xs">
                        {flag}
                      </p>
                    ))}
                  </div>
                ),
              },
              {
                title: "Комиссия сервиса",
                align: "right",
                render: (row) => formatAdminMoney(row.performanceFee, row.currency),
              },
            ]}
          />
          {list.envelope?.data.truncated ? (
            <p className="border-waia-divider text-waia-fg-muted border-t p-4 text-xs">
              Показано {items.length} из {list.envelope.data.total}. Экспорт содержит полную выборку
              в пределах опубликованного лимита.
            </p>
          ) : null}
        </ConsolePanel>
      ) : null}
      <ConsoleDialog
        open={Boolean(selected)}
        onClose={() => context.update({ sel: null })}
        dismissible={!pending}
        title="Счёт на оплату"
        description={selected ?? undefined}
        wide
      >
        {detail.loading ? <ConsoleLoading /> : null}
        {detail.reason ? <DataState state="unavailable" reason={detail.reason} /> : null}
        {current ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ConsoleBadge>{current.display.status}</ConsoleBadge>
              <span className="text-xl font-semibold tabular-nums">
                {formatAdminMoney(current.stored.performanceFee, current.currency)}
              </span>
            </div>
            {invoice?.revision !== current.revision ? (
              <p className="text-waia-warning text-xs">
                Документ обновился после списка. Ниже показан свежий сохранённый расчёт; сумма
                списка обновляется отдельно.
              </p>
            ) : null}
            <ConsolePanel title="Сохранённый расчёт">
              <dl className="divide-waia-divider divide-y">
                {[
                  ["Результат отчётного периода", current.stored.periodProfit],
                  ["Накопленный реализованный результат", current.stored.cumulative],
                  ["Предыдущий HWM", current.stored.previousHwm],
                  ["Новая прибыль выше HWM", current.stored.newProfitAboveHwm],
                  ["Комиссия сервиса", current.stored.performanceFee],
                ].map(([label, amount]) => (
                  <div
                    key={label}
                    className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm"
                  >
                    <dt className="text-waia-fg-muted">{label}</dt>
                    <dd className="tabular-nums">{formatAdminMoney(amount, current.currency)}</dd>
                  </div>
                ))}
                <div className="flex justify-between px-5 py-3 text-sm">
                  <dt className="text-waia-fg-muted">Сохранённая ставка (доля)</dt>
                  <dd>{current.stored.feeRate}</dd>
                </div>
              </dl>
            </ConsolePanel>
            {current.chain.ok === true ? (
              <p className="text-waia-success text-xs">Цепочка сохранённого расчёта согласована.</p>
            ) : (
              <div className="border-waia-warning/30 bg-waia-warning/5 text-waia-warning rounded-lg border p-4 text-sm leading-6">
                {current.chain.ok === false
                  ? "Цепочка расчёта не сходится. Значения сохранённого документа не изменены."
                  : "Для полной проверки цепочки не хватает сохранённых предыдущих значений."}
                {current.chain.ok === false && current.chain.link ? (
                  <p>Несовпадающее звено: {current.chain.link}</p>
                ) : null}
                {current.chain.reasons?.map((reason) => (
                  <DataState key={reason} state="unavailable" reason={reason} />
                ))}
              </div>
            )}
            {current.coolingOffUntil ? (
              <p className="text-xs">
                <EvidenceTime at={current.coolingOffUntil} label="Период ожидания до" />
              </p>
            ) : null}
            {current.issuedAt ? (
              <p className="text-xs">
                <EvidenceTime at={current.issuedAt} label="Выпущен" />
              </p>
            ) : null}
            {current.paidAt ? (
              <p className="text-xs">
                <EvidenceTime at={current.paidAt} label="Оплачен" />
              </p>
            ) : null}
            {message ? (
              <p role="status" className="border-waia-rim rounded-lg border p-3 text-sm leading-6">
                {message}
              </p>
            ) : null}
            {readBackRequired && !pending ? (
              <button
                type="button"
                className={controlClass}
                onClick={async () => {
                  const response = await fetch(
                    context.href(`/api/trader/admin/console/invoices/${current.id}`),
                    { credentials: "same-origin", cache: "no-store" },
                  ).catch(() => null);
                  if (response?.status === 401 || response?.status === 403) {
                    notifyAdminAccessRevoked();
                    return;
                  }
                  const body = response?.ok ? await response.json().catch(() => null) : null;
                  if (body?.data?.id !== current.id || typeof body?.data?.revision !== "string") {
                    setMessage(
                      "Документ не удалось перечитать. Повторная отправка остаётся закрытой.",
                    );
                    return;
                  }
                  resetConfirmations();
                  setReadBackRequired(false);
                  detail.reload();
                  list.reload();
                  setMessage("Документ перечитан. Проверьте его перед новой командой.");
                }}
              >
                Перечитать документ
              </button>
            ) : null}
            {current.evidence ? <InvoiceEvidencePanel evidence={current.evidence} /> : null}
            <div className="flex flex-wrap gap-3">
              <ExportButton invoiceId={current.id} format="json" />
              <ExportButton invoiceId={current.id} format="csv" />
            </div>
            {current.status === "DRAFT" && current.stored.billable ? (
              <fieldset
                disabled={pending || readBackRequired || detail.refreshing}
                className="border-waia-divider space-y-5 rounded-xl border p-5"
              >
                <legend className="px-2 text-sm font-semibold">Ручное подтверждение</legend>
                <p className="text-waia-fg-muted text-xs leading-6">
                  Отметьте каждый пункт после проверки. Смена документа или его ревизии сбрасывает
                  все отметки.
                </p>
                <InvoiceAttestations
                  key={identity}
                  onApprove={(attestations: IssuanceAttestation) =>
                    void command({ command: "approve", attestations })
                  }
                />
                {current.approvedAt ? (
                  <>
                    <label className="flex gap-3 text-sm leading-6">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={issueConfirmed && issueIdentity === identity}
                        onChange={(event) => {
                          setIssueConfirmed(event.target.checked);
                          setIssueIdentity(identity);
                        }}
                      />
                      Подтверждаю выпуск проверенного документа
                    </label>
                    <button
                      type="button"
                      className={controlClass}
                      disabled={!canIssue || !issueConfirmed || issueIdentity !== identity}
                      onClick={() => void command({ command: "issue", confirmed: true })}
                    >
                      Выпустить
                    </button>
                    <label className="grid gap-2 text-sm">
                      Причина отмены подтверждения
                      <textarea
                        className={`${controlClass} h-20 py-2`}
                        value={cancelReason}
                        onChange={(event) => setCancelReason(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className={controlClass}
                      disabled={!cancelReason.trim()}
                      onClick={() =>
                        void command({ command: "cancel-pending", reason: cancelReason.trim() })
                      }
                    >
                      Отменить выпуск
                    </button>
                  </>
                ) : null}
              </fieldset>
            ) : null}
            <p className="text-waia-fg-muted text-xs leading-6">
              Закреплённый срок оплаты, частичная оплата и PDF недоступны до отдельной ратификации.
              Обнаружение платежа не равно его зачёту.
            </p>
          </div>
        ) : null}
      </ConsoleDialog>
    </div>
  );
}
