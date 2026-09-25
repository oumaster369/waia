"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import {
  ConsolePanel,
  ConsoleEmpty,
  ConsoleLoading,
  EvidenceTime,
  ConsoleTable,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { AdminTimeSeriesChart } from "@/components/trader/admin-console/primitives/time-series-chart";
import type { OverviewSeriesPoint } from "@/lib/trader/admin-console/money/period-series";
import type { PeriodResult } from "@/lib/trader/admin-console/money/period-result";
import type { AttentionItem } from "@/lib/trader/admin-console/attention";

export type OverviewData = {
  accounts?: {
    id: string;
    organizationId: string | null;
    exchangeAccountId: string;
    venue: string;
    equity: string | null;
    traderPnl: string | null;
    currency: string;
    reason: string | null;
    included: boolean;
    observedAt: string | null;
  }[];
  period?: {
    series: OverviewSeriesPoint[];
    seriesCurrency: string;
    grain: string;
    seriesReason?: string | null;
    seriesFx?: { observedAt: string } | null;
    breakdown: {
      realized: string | null;
      unrealizedChange: string | null;
      openFees: string | null;
      closeFees: string | null;
      tradingFees: string | null;
      included: number;
      total: number;
      currency: string;
    };
    serviceFees: { currency: string; status: string; count: number; amount: string }[];
    accounts: { account: string; result: PeriodResult }[];
  } | null;
};
const linkClass =
  "text-waia-accent-cool text-xs font-medium hover:underline focus-visible:outline-2";
function Action({ path, children }: { path: string; children: ReactNode }) {
  const { href } = useAdminReadContext();
  return (
    <Link className={linkClass} href={href(path)}>
      {children}
    </Link>
  );
}
function ReadList<T>({
  path,
  title,
  note,
  action,
  children,
}: {
  path: string;
  title: string;
  note?: string;
  action?: ReactNode;
  children: (items: T[]) => ReactNode;
}) {
  const read = useAdminRead<{ items?: T[]; truncated?: boolean }>(path);
  return (
    <ConsolePanel title={title} note={note} action={action}>
      {read.loading ? (
        <div className="p-5">
          <ConsoleLoading />
        </div>
      ) : read.reason ? (
        <div className="p-5">
          <DataState state="unavailable" reason={read.reason} />
        </div>
      ) : read.envelope?.data.items?.length ? (
        children(read.envelope.data.items)
      ) : (
        <ConsoleEmpty />
      )}
      {read.envelope?.data.truncated ? (
        <p className="text-waia-fg-muted px-5 pb-4 text-xs">
          Показаны последние записи. Полный список — в разделе.
        </p>
      ) : null}
    </ConsolePanel>
  );
}
const attentionLabels: Record<string, string> = {
  UNKNOWN_ORDER_OUTCOME: "Неизвестен итог отправки ордера",
  POSTURE_KILLED: "Активна аварийная остановка",
  RUNTIME_HALT: "Runtime остановлен",
  GUARDIAN_STALE: "Нужна свежая оценка позиции",
  MONEY_DIVERGENCE: "Требуется сверка средств",
  STALE_ACTIVE_OBSERVATION: "Устарело наблюдение активного счёта",
  SERVICE_FAILURE: "Сбой сервиса или повторные ошибки задания",
  OWNERSHIP_CONFLICT: "Счёт заявлен в двух организациях",
  BILLING_ATTENTION: "Нужна проверка счёта на оплату",
  PERIOD_BLOCKED: "Отчётный период требует внимания",
  STALE_QUIET_OBSERVATION: "Давно не обновлялся счёт",
  PROMOTION_REVIEW: "Есть предложение стратегии на рассмотрение",
};
export function AttentionPanel() {
  return (
    <ReadList<AttentionItem>
      path="/api/trader/admin/console/attention"
      title="Требует внимания"
      note="Одна запись на причину. Обоснованный отказ от сделки не является инцидентом"
      action={<Action path="/admin/errors">Инциденты →</Action>}
    >
      {(items) => (
        <ul className="divide-waia-divider divide-y">
          {items.map((item) => (
            <li key={item.reason} className="flex items-start gap-3 px-5 py-4">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.severity === "critical" ? "bg-waia-danger" : item.severity === "high" ? "bg-waia-warning" : "bg-waia-accent-cool"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{attentionLabels[item.reason] ?? item.reason}</p>
                <p className="text-waia-fg-muted mt-1 text-xs">
                  {item.entityIds.length
                    ? `Записей: ${item.entityIds.length}`
                    : "Проверка состояния системы"}
                </p>
              </div>
              <Action path={item.href}>Открыть →</Action>
            </li>
          ))}
        </ul>
      )}
    </ReadList>
  );
}

export function OverviewFinancialDetails({ data }: { data: OverviewData }) {
  const period = data.period;
  return (
    <>
      {period ? (
        <details className="border-waia-divider bg-waia-field-mid rounded-xl border p-5">
          <summary className="cursor-pointer text-sm font-medium">
            Из чего складывается результат Трейдера
          </summary>
          <div className="mt-5 space-y-5">
            <p className="text-waia-fg-muted text-xs leading-6">
              Операционный результат до комиссии сервиса 30%. Это не база для выпуска счёта. Охват:{" "}
              {period.breakdown.included}/{period.breakdown.total}.
            </p>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["realized", "Реализованный результат"],
                  ["unrealizedChange", "Изменение нереализованного"],
                  ["tradingFees", "Торговые комиссии"],
                  ["openFees", "Комиссии открытия"],
                  ["closeFees", "Комиссии закрытия"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="border-waia-divider rounded-lg border p-4">
                  <dt className="text-waia-fg-muted text-xs">{label}</dt>
                  <dd className="mt-2 text-base tabular-nums">
                    {period.breakdown[key] === null ? (
                      <DataState state="unavailable" reason="PNL_PERIOD_EVIDENCE_MISSING" />
                    ) : (
                      formatAdminMoney(period.breakdown[key]!, period.breakdown.currency)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-waia-fg-muted text-xs">
              Комиссии уже учтены в реализованном результате: открытие вычтено отдельно, закрытие
              входит в сохранённый результат исполнения.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["DRAFT", "Начислено в черновиках"],
                  ["ISSUED", "Выставлено"],
                  ["PAID", "Оплачено"],
                ] as const
              ).map(([status, label]) => (
                <div key={status} className="border-waia-divider rounded-lg border p-4">
                  <p className="text-waia-fg-muted text-xs">Комиссия сервиса · {label}</p>
                  {period.serviceFees
                    .filter((f) => f.status === status)
                    .map((f) => (
                      <p className="mt-2 tabular-nums" key={f.currency}>
                        {formatAdminMoney(f.amount, f.currency)}{" "}
                        <span className="text-waia-fg-muted text-xs">· {f.count} сч.</span>
                      </p>
                    ))}
                  {!period.serviceFees.some((f) => f.status === status) ? (
                    <p className="text-waia-fg-muted mt-2 text-xs">
                      Нет сохранённых счетов этого статуса
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <DataState state="unavailable" reason="EXTERNAL_FLOWS_NOT_OBSERVED" />
            <ul className="space-y-2">
              {period.accounts
                .filter((a) => a.result.reasons.length)
                .map((a) => (
                  <li key={a.account} className="border-waia-divider border-t pt-2 text-xs">
                    <span className="text-waia-fg-muted">
                      Счёт {a.account.split(":").at(-1)?.slice(-10)}
                    </span>
                    {a.result.reasons.map((reason) => (
                      <DataState key={reason} state={a.result.state} reason={reason} />
                    ))}
                  </li>
                ))}
            </ul>
          </div>
        </details>
      ) : null}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <AdminTimeSeriesChart
          points={period?.series}
          currency={period?.seriesCurrency}
          grain={period?.grain}
          reason={period?.seriesReason}
          fxAt={period?.seriesFx?.observedAt}
        />
        <AttentionPanel />
      </div>
    </>
  );
}
export function AccountsPreview({ data }: { data: OverviewData }) {
  const { href } = useAdminReadContext();
  const accounts = [...(data.accounts ?? [])]
    .sort((a, b) => Number(a.included) - Number(b.included) || a.id.localeCompare(b.id))
    .slice(0, 8);
  return (
    <ConsolePanel
      title="Биржевые счета"
      note="Сначала счета с ограничениями оценки"
      action={<Action path="/admin/accounts">Все счета →</Action>}
    >
      <ConsoleTable
        caption="Биржевые счета обзора"
        rows={accounts}
        rowKey={(a) => a.id}
        columns={[
          {
            title: "Счёт",
            render: (a) => (
              <Link
                className="hover:text-waia-accent-cool font-medium"
                href={href("/admin/accounts", {
                  sel: a.id,
                  organization_id: a.organizationId,
                  exchange_account_id: a.exchangeAccountId,
                })}
              >
                {a.venue.toUpperCase()} · {a.exchangeAccountId.slice(-10)}
              </Link>
            ),
          },
          {
            title: "Капитал",
            render: (a) =>
              a.equity === null ? (
                <DataState state="unavailable" reason={a.reason} />
              ) : (
                <span className="tabular-nums">{formatAdminMoney(a.equity, a.currency)}</span>
              ),
          },
          {
            title: "Результат",
            render: (a) =>
              a.traderPnl === null ? (
                <DataState state="unavailable" reason="PNL_PERIOD_EVIDENCE_MISSING" />
              ) : (
                <span className="tabular-nums">{formatAdminMoney(a.traderPnl, a.currency)}</span>
              ),
          },
          {
            title: "Оценка",
            render: (a) =>
              a.reason ? (
                <DataState state={a.included ? "partial" : "unavailable"} reason={a.reason} />
              ) : (
                <EvidenceTime at={a.observedAt} />
              ),
          },
        ]}
      />
    </ConsolePanel>
  );
}
type News = {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  url: string | null;
  publishedAt: string | null;
  observedAt: string;
};
export function NewsPanel({ full = false }: { full?: boolean }) {
  return (
    <ReadList<News>
      path={`/api/trader/admin/console/news?limit=${full ? 50 : 7}`}
      title="Рынок и новости"
      note="Общие рыночные источники. Время публикации и получения показаны отдельно"
      action={full ? undefined : <Action path="/admin?tab=market">Все новости →</Action>}
    >
      {(items) => (
        <div className={full ? "grid gap-px md:grid-cols-2" : "divide-waia-divider divide-y"}>
          {items.map((item) => (
            <article key={item.id} className="min-w-0 p-5">
              <div className="text-waia-fg-muted mb-2 flex flex-wrap justify-between gap-2 text-[11px]">
                <span>{item.source}</span>
                <EvidenceTime at={item.publishedAt} label="Опубликовано" />
              </div>
              <h3 className="text-sm leading-6 font-medium">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-waia-accent-cool"
                  >
                    {item.title} ↗
                  </a>
                ) : (
                  item.title
                )}
              </h3>
              {full && item.summary ? (
                <p className="text-waia-fg-muted mt-3 text-sm leading-6">{item.summary}</p>
              ) : null}
              <p className="mt-3 text-[10px]">
                <EvidenceTime at={item.observedAt} label="Получено" />
              </p>
            </article>
          ))}
        </div>
      )}
    </ReadList>
  );
}
type Fill = {
  id: string;
  organizationId: string;
  orderId: string;
  symbol: string;
  price: string;
  quantity: string;
  fee: string;
  feeAsset: string;
  executedAt: string | null;
  mode: string;
};
export function FillsPreview() {
  const { href } = useAdminReadContext();
  return (
    <ReadList<Fill>
      path="/api/trader/admin/console/fills?limit=7"
      title="Последние исполнения"
      note="Только подтверждённые fills; принятие ордера биржей не является исполнением"
      action={<Action path="/admin/orders?tab=fills">Все исполнения →</Action>}
    >
      {(items) => (
        <ul className="divide-waia-divider divide-y">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
            >
              <div>
                <Link
                  href={href("/admin/orders", {
                    tab: "all",
                    sel: item.orderId,
                    organization_id: item.organizationId,
                  })}
                  className="hover:text-waia-accent-cool text-sm font-medium"
                >
                  {item.symbol} · {item.mode}
                </Link>
                <p className="text-waia-fg-muted mt-1 text-xs">
                  {item.quantity} × {item.price}
                </p>
              </div>
              <div className="text-right text-xs">
                <EvidenceTime at={item.executedAt} />
                <p className="text-waia-fg-muted mt-1">
                  Комиссия {item.fee} {item.feeAsset}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ReadList>
  );
}
type Cycle = {
  id: string;
  organizationId: string;
  symbol: string;
  at: string;
  reason: string;
  mode: string;
  runId: string;
};
export function ActivityPanel({ full = false }: { full?: boolean }) {
  const { href } = useAdminReadContext();
  return (
    <ReadList<Cycle>
      path={`/api/trader/admin/console/cycles?limit=${full ? 50 : 7}`}
      title="Что делает Трейдер"
      note="Последние сохранённые циклы. NO_TRADE — подтверждённое решение не торговать"
      action={full ? undefined : <Action path="/admin?tab=algorithm">Работа алгоритма →</Action>}
    >
      {(items) => (
        <ul className="divide-waia-divider divide-y">
          {items.map((item) => (
            <li key={item.id} className="px-5 py-4">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-sm font-medium">
                  {item.symbol} · {item.mode}
                </span>
                <span className="text-xs">
                  <EvidenceTime at={item.at} />
                </span>
              </div>
              <p className="text-waia-fg-muted mt-2 text-xs leading-6">
                {item.reason.includes("NO_TRADE")
                  ? "Решение: не торговать"
                  : "Завершён цикл оценки"}{" "}
                · <span title={item.reason}>{item.reason}</span>
              </p>
              <Link
                className={linkClass}
                href={href("/admin/research", {
                  tab: "runs",
                  cycle: item.id,
                  organization_id: item.organizationId,
                  mode: item.mode === "undetermined" ? "all" : item.mode,
                })}
              >
                Доказательства цикла →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ReadList>
  );
}
export function ClientsPreview() {
  const { href } = useAdminReadContext();
  return (
    <ReadList<{ id: string; name: string; access: string }>
      path="/api/trader/admin/console/clients?limit=5"
      title="Клиенты"
      action={<Action path="/admin/clients">Все клиенты →</Action>}
    >
      {(items) => (
        <ul className="divide-waia-divider divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <Link
                className="hover:text-waia-accent-cool text-sm"
                href={href("/admin/clients", {
                  sel: item.id,
                  organization_id: item.id,
                  exchange_account_id: null,
                })}
              >
                {item.name || item.id.slice(-10)}
              </Link>
              <span className="text-waia-fg-muted text-xs">{item.access}</span>
            </li>
          ))}
        </ul>
      )}
    </ReadList>
  );
}
export function ResearchPreview() {
  const { href } = useAdminReadContext();
  return (
    <ReadList<{ id: string; title: string; state: string | null; observedAt: string | null }>
      path="/api/trader/admin/console/research/catalog?tab=campaigns&limit=5"
      title="Исследования"
      note="Кампании и сохранённые состояния; результат исследования не означает допуск к торговле"
      action={<Action path="/admin/research">Все исследования →</Action>}
    >
      {(items) => (
        <ul className="divide-waia-divider divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-3 px-5 py-4">
              <Link
                href={href("/admin/research", { tab: "campaigns", sel: item.id })}
                className="hover:text-waia-accent-cool text-sm"
              >
                {item.title}
              </Link>
              <div className="text-right text-xs">
                <p>
                  {(
                    {
                      DRAFT: "Черновик",
                      ACTIVE: "Активна",
                      PAUSED: "Приостановлена",
                      ARCHIVED: "В архиве",
                    } as Record<string, string>
                  )[item.state ?? ""] ??
                    item.state ??
                    "Состояние не сохранено"}
                </p>
                <EvidenceTime at={item.observedAt} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ReadList>
  );
}
