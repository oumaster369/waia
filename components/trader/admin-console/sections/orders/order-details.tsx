"use client";
import Link from "next/link";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import {
  ConsoleBadge,
  ConsoleDialog,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import {
  ORDER_STATUS_LABELS,
  type OrderTraceStep,
} from "@/lib/trader/admin-console/read-models/order-trace";

type EvidenceRow = Record<string, string | null>;
type OrderDetail = {
  order: {
    id: string;
    symbol: string;
    label: string;
    side: string;
    mode: string;
    quantity: string;
    filledQuantity: string;
    createdAt: string;
    limitPrice: string | null;
    orderType: string | null;
  };
  trace: { steps: OrderTraceStep[]; fillCount: number };
  evidence: EvidenceRow | null;
  reports: EvidenceRow[];
  events: EvidenceRow[];
  fills: EvidenceRow[];
  truncated: boolean;
};
const TITLES: Record<string, string> = {
  execution_attempt: "Попытка исполнения",
  execution_plan: "План исполнения",
  risk_allowance: "Допуск Risk",
  risk_verdict: "Вердикт Risk",
  decision: "Решение",
  forecast: "Прогноз",
  exchange_reports: "Отчёты биржи",
  order_events: "События ордера",
  fills: "Исполнения",
};
const LABELS: Record<string, string> = {
  attempt_state: "Состояние попытки",
  planned_quantity: "Плановое количество",
  plan_price: "Лимитная цена",
  allowance_state: "Состояние допуска",
  exact_qualified_quantity: "Разрешённое количество",
  verdict: "Вердикт Risk",
  approved_qualified_quantity: "Одобренное количество",
  decision_class: "Класс решения",
  universal_terminal_reason_code: "Причина решения",
  strategy_id: "Стратегия",
  strategy_version: "Версия стратегии",
  market_question: "Вопрос прогноза",
};
export function OrderDetails() {
  const context = useAdminReadContext(),
    id = context.params.get("order");
  const read = useAdminRead<OrderDetail>(
    id ? `/api/trader/admin/console/orders/${encodeURIComponent(id)}` : null,
  );
  const data = read.envelope?.data;
  return (
    <ConsoleDialog
      open={!!id}
      onClose={() => context.update({ order: null })}
      title={data?.order ? `Ордер · ${data.order.symbol}` : "Доказательства ордера"}
      description="Сохранённая цепочка решения и исполнения. Принятие ордера биржей и фактическое исполнение показаны отдельно."
      wide
    >
      {read.loading ? (
        <ConsoleLoading />
      ) : read.reason ? (
        <DataState state="unavailable" reason={read.reason} />
      ) : data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ConsoleBadge>{data.order.label}</ConsoleBadge>
            <EvidenceTime at={data.order.createdAt} />
            <span className="text-xs">
              {data.order.mode} · {data.order.side === "buy" ? "Покупка" : "Продажа"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Количество", data.order.quantity],
              ["Исполнено", data.order.filledQuantity],
              ["Тип", data.order.orderType === "market" ? "Рыночный" : "Лимитный"],
            ].map(([label, value]) => (
              <div key={label} className="border-waia-divider rounded-lg border p-4">
                <p className="text-waia-fg-muted text-xs">{label}</p>
                <p className="mt-2 font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {data.truncated ? <DataState state="partial" reason="ORDER_EVIDENCE_CAP" /> : null}
          <section
            aria-label="Цепочка доказательств"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {data.trace.steps.map((step) => (
              <div className="border-waia-divider rounded-lg border p-4" key={step.step}>
                <h3 className="text-sm font-medium">{TITLES[step.step] ?? step.step}</h3>
                {step.state === "ok" ? (
                  <>
                    <p className="text-waia-success mt-2 text-xs">
                      {step.step === "fills" && !data.fills.length
                        ? "Исполнений пока нет"
                        : "Запись подтверждена"}
                    </p>
                    {step.at ? (
                      <div className="mt-2 text-[11px]">
                        <EvidenceTime at={step.at} label="" />
                      </div>
                    ) : null}
                    {step.recordId ? (
                      <details className="text-waia-fg-muted mt-2 text-[10px]">
                        <summary>Идентификатор</summary>
                        <p className="mt-1 break-all">{step.recordId}</p>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <DataState state={step.state} reason={step.reason} />
                )}
              </div>
            ))}
          </section>
          {data.evidence ? (
            <ConsolePanel title="Содержание доказательств">
              <dl className="grid gap-4 p-5 sm:grid-cols-2">
                {Object.entries(LABELS)
                  .filter(([key]) => data.evidence?.[key] != null)
                  .map(([key, label]) => (
                    <div key={key}>
                      <dt className="text-waia-fg-muted text-xs">{label}</dt>
                      <dd className="mt-1 text-sm break-words">{data.evidence![key]}</dd>
                    </div>
                  ))}
              </dl>
              {data.evidence.cycle_envelope_id ? (
                <Link
                  className="mx-5 mb-5 inline-block text-sm underline"
                  href={context.href("/admin/research", { cycle: data.evidence.cycle_envelope_id })}
                >
                  Открыть 23 этапа цикла ↗
                </Link>
              ) : null}
            </ConsolePanel>
          ) : null}
          <ConsolePanel
            title="Исполнения"
            note="Цена — в валюте инструмента; комиссия — в сохранённом активе. Каждая строка соответствует одному fill."
          >
            <ConsoleTable
              rows={data.fills}
              rowKey={(r) => r.id!}
              caption="Исполнения выбранного ордера"
              columns={[
                { title: "Количество", render: (r) => r.quantity },
                { title: "Цена", render: (r) => r.price },
                {
                  title: "Комиссия",
                  render: (r) =>
                    r.fee !== null ? (
                      formatAdminMoney(r.fee, r.fee_asset ?? "")
                    ) : (
                      <DataState state="unavailable" reason="FILL_FEE_MISSING" />
                    ),
                },
                { title: "Время", render: (r) => <EvidenceTime at={r.at} label="" /> },
              ]}
            />
          </ConsolePanel>
          <ConsolePanel title="Отчёты биржи">
            <ConsoleTable
              rows={data.reports}
              rowKey={(r) => r.id!}
              caption="Отчёты выбранного ордера"
              columns={[
                { title: "Тип", render: (r) => r.type },
                { title: "Источник", render: (r) => r.source },
                { title: "Порядок", render: (r) => r.sequence },
                { title: "Наблюдение", render: (r) => <EvidenceTime at={r.at} label="" /> },
              ]}
            />
          </ConsolePanel>
          <ConsolePanel title="История состояния">
            <ConsoleTable
              rows={data.events}
              rowKey={(r) => r.id!}
              caption="События выбранного ордера"
              columns={[
                { title: "Событие", render: (r) => r.type },
                {
                  title: "Состояние после",
                  render: (r) =>
                    ORDER_STATUS_LABELS[r.to_state as keyof typeof ORDER_STATUS_LABELS] ??
                    r.to_state,
                },
                { title: "Время", render: (r) => <EvidenceTime at={r.at} label="" /> },
              ]}
            />
          </ConsolePanel>
        </div>
      ) : null}
    </ConsoleDialog>
  );
}
