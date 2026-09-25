"use client";
import Link from "next/link";
import { useAdminReadContext } from "../../data/read-context";
import { useAdminRead } from "../../data/use-admin-read";
import {
  ConsoleTable,
  ConsoleBadge,
  ConsoleLoading,
  EvidenceTime,
  controlClass,
} from "../../primitives/console-ui";
import { DataState } from "../../primitives/data-state";
import { formatAdminMoney } from "../../primitives/money";
import { multiplyDecimal } from "@/lib/trader/risk/numeric";
import type { StrategyWorkspaceItem } from "@/lib/trader/admin-console/research/strategy-workspace";
import type { StrategyPerformance } from "@/lib/trader/admin-console/research/strategy-performance";
const tabs = [
  ["results", "Результаты"],
  ["accounts", "Счета и сделки"],
  ["decisions", "Решения"],
  ["checks", "Проверки"],
  ["versions", "Версии"],
] as const;
type Details = {
  performance: (StrategyPerformance & { mode: string })[];
  decisions: {
    id: string;
    cycleId: string;
    organizationId: string;
    symbol: string;
    decision: string;
    reason: string;
    category: string | null;
    at: string | null;
    mode: string;
  }[];
  decisionsTruncated: boolean;
};
const modes: Record<string, string> = {
  live: "Live — реальный контур",
  paper: "Paper — виртуальный контур",
  history: "History — воспроизведение",
};
const evidenceLabels: Record<string, string> = {
  pending: "Ожидает запуска",
  running: "Выполняется",
  completed: "Тест завершён",
  failed: "Ошибка теста",
  draft: "Черновик",
  registered: "Зарегистрирована",
  backtested: "Тест завершён",
  walk_forward_validated: "Walk-forward пройден",
  blind_validated: "Проверка завершена",
  rejected: "Отклонена",
  DRAFT: "Черновик продвижения",
  PENDING_CONFIRM: "Ожидает подтверждения",
  COOLING_OFF: "Период ожидания",
  EFFECTIVE: "Продвижение действует",
  CANCELLED: "Продвижение отменено",
  REVOKED: "Продвижение отозвано",
  OPEN: "Сделка открыта",
  CLOSED: "Сделка закрыта",
  FORCED_FLAT: "Позиция принудительно закрыта",
  RESEARCHING: "Исследуется",
  PAPER: "Тестируется в Paper",
  RETIRED: "В архиве",
};
const money = (v: string | null) =>
  v === null ? (
    <DataState state="unavailable" reason="STRATEGY_RESULT_INCOMPLETE" />
  ) : (
    formatAdminMoney(v, "USDT")
  );
export function StrategyDetails({
  strategy,
  all,
}: {
  strategy: StrategyWorkspaceItem;
  all: StrategyWorkspaceItem[];
}) {
  const context = useAdminReadContext(),
    tab = tabs.some(([id]) => id === context.params.get("detail"))
      ? context.params.get("detail")!
      : "results";
  const read = useAdminRead<Details>(
    `/api/trader/admin/console/strategies/detail?${new URLSearchParams({ strategy_id: strategy.strategyId, strategy_version: strategy.version })}`,
  );
  return (
    <div className="space-y-5">
      <ConsoleBadge>{strategy.activityLabel}</ConsoleBadge>
      <p className="text-waia-fg-muted text-sm">
        Доказательства относятся только к выбранной версии. Завершённый тест не означает
        рекомендацию к продвижению.
      </p>
      <nav className="flex flex-wrap gap-2" aria-label="Содержание стратегии">
        {tabs.map(([id, label]) => (
          <button
            className={`${controlClass} ${tab === id ? "border-waia-accent-cool" : ""}`}
            aria-current={tab === id ? "page" : undefined}
            key={id}
            onClick={() => context.update({ detail: id })}
          >
            {label}
          </button>
        ))}
      </nav>
      {read.loading ? (
        <ConsoleLoading />
      ) : read.reason ? (
        <DataState state="unavailable" reason={read.reason} />
      ) : read.envelope ? (
        <>
          {tab === "results" || tab === "accounts"
            ? read.envelope.data.performance.map((result) => (
                <section
                  key={result.mode}
                  className="border-waia-divider space-y-4 rounded-lg border p-4"
                >
                  <h3 className="font-medium">{modes[result.mode] ?? result.mode}</h3>
                  {result.reasons.map((reason) => (
                    <DataState key={reason} state="partial" reason={reason} />
                  ))}
                  {tab === "results" ? (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[
                          ["Реализованный результат периода", money(result.realized)],
                          ["Торговые комиссии", money(result.tradingFees)],
                          ["Закрытые сделки", result.closedTradeCount ?? "Недоступно"],
                          [
                            "Доля прибыльных сделок",
                            result.winRate === null
                              ? "Нет достоверного знаменателя"
                              : `${formatAdminMoney(multiplyDecimal(result.winRate, "100"), "").trim()}%`,
                          ],
                          [
                            "Фактор прибыли",
                            result.profitFactor === null
                              ? "Нет достоверного знаменателя"
                              : formatAdminMoney(result.profitFactor, ""),
                          ],
                          ["Просадка реализованного результата", money(result.maxRealizedDrawdown)],
                        ].map(([label, value]) => (
                          <div key={String(label)}>
                            <p className="text-waia-fg-muted text-xs">{label}</p>
                            <div className="mt-2 text-sm font-medium tabular-nums">{value}</div>
                          </div>
                        ))}
                      </div>
                      <p className="text-waia-fg-muted text-xs">
                        До комиссии сервиса. Комиссии учтены один раз. Просадка — в USDT по
                        последовательности реализованного результата.
                      </p>
                      <ConsoleTable
                        rows={result.daily}
                        rowKey={(r) => r.day}
                        caption="Результат по дням"
                        columns={[
                          { title: "День (UTC)", render: (r) => r.day },
                          { title: "За день", render: (r) => money(r.realized) },
                          { title: "С начала периода", render: (r) => money(r.cumulative) },
                        ]}
                      />
                      <DataState
                        state="unavailable"
                        reason="STRATEGY_UNREALIZED_PERIOD_BINDING_NOT_PERSISTED"
                      />
                      <DataState state="unavailable" reason="RETURN_METHOD_NOT_RATIFIED" />
                    </>
                  ) : (
                    <>
                      <p className="text-waia-fg-muted text-sm">
                        Счетов в наблюдаемых сделках: {result.accountCount ?? "неполный охват"}.
                        Активность не означает назначение стратегии.
                      </p>
                      <ConsoleTable
                        rows={result.trades}
                        rowKey={(r) => r.id}
                        caption="Сделки выбранной версии"
                        columns={[
                          {
                            title: "Рынок / счёт",
                            render: (r) => (
                              <>
                                <p>{r.symbol}</p>
                                <p className="text-waia-fg-muted text-xs break-all">
                                  {r.account ?? "Счёт не установлен"}
                                </p>
                              </>
                            ),
                          },
                          {
                            title: "Состояние",
                            render: (r) =>
                              r.state === "OPEN"
                                ? "Открыта"
                                : r.state === "CLOSED"
                                  ? "Закрыта"
                                  : "Принудительно закрыта",
                          },
                          { title: "Реализовано за сделку", render: (r) => money(r.realized) },
                          {
                            title: "Закрытие",
                            render: (r) => <EvidenceTime at={r.closedAt} label="" />,
                          },
                        ]}
                      />
                      {result.totalTrades > result.trades.length ? (
                        <p className="text-waia-fg-muted text-xs">
                          Показано {result.trades.length} из {result.totalTrades}.
                        </p>
                      ) : null}
                    </>
                  )}
                </section>
              ))
            : null}
          {tab === "decisions" ? (
            <>
              <ConsoleTable
                rows={read.envelope.data.decisions}
                rowKey={(r) => r.id}
                caption="Решения выбранной версии"
                columns={[
                  {
                    title: "Рынок / контур",
                    render: (r) => (
                      <>
                        {r.symbol} · {modes[r.mode] ?? "Контур не установлен"}
                      </>
                    ),
                  },
                  { title: "Решение", render: (r) => r.decision },
                  {
                    title: "Основание",
                    render: (r) => (
                      <>
                        <p>{r.category ?? "Сохранённое основание"}</p>
                        <p className="text-waia-fg-muted text-xs break-all">{r.reason}</p>
                      </>
                    ),
                  },
                  { title: "Время", render: (r) => <EvidenceTime at={r.at} label="" /> },
                  {
                    title: "Доказательства",
                    render: (r) => (
                      <Link
                        className="text-waia-accent-cool hover:underline"
                        href={context.href("/admin/research", {
                          tab: "runs",
                          cycle: r.cycleId,
                          organization_id: r.organizationId,
                        })}
                      >
                        Цикл
                      </Link>
                    ),
                  },
                ]}
              />
              {read.envelope.data.decisionsTruncated ? (
                <DataState state="partial" reason="STRATEGY_DECISIONS_TRUNCATED" />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {tab === "checks" ? (
        <>
          <ConsoleTable
            rows={strategy.evidence}
            rowKey={(r) => `${r.kind}:${r.id}`}
            caption="Проверки и доказательства стратегии"
            columns={[
              {
                title: "Запись",
                render: (r) =>
                  ({
                    trade: "Сделка",
                    promotion: "Продвижение",
                    candidate: "Квалификация",
                    lifecycle: "Жизненный цикл",
                    test: "Тест",
                  })[r.kind],
              },
              {
                title: "Клиент",
                render: (r) => <span className="text-xs break-all">{r.organizationId}</span>,
              },
              {
                title: "Статус",
                render: (r) => (
                  <span title={r.state}>
                    <ConsoleBadge>{evidenceLabels[r.state] ?? r.state}</ConsoleBadge>
                  </span>
                ),
              },
              { title: "Дата", render: (r) => <EvidenceTime at={r.at} label="" /> },
            ]}
          />
          <Link
            className={`${controlClass} inline-flex items-center`}
            href={context.href("/admin/strategy-promotions", { strategy_id: strategy.strategyId })}
          >
            Открыть управляемое продвижение
          </Link>
        </>
      ) : null}
      {tab === "versions" ? (
        <ConsoleTable
          rows={all.filter((r) => r.strategyId === strategy.strategyId)}
          rowKey={(r) => r.version}
          caption="Версии без наследования доказательств"
          columns={[
            {
              title: "Версия",
              render: (r) => (
                <button
                  className="text-waia-accent-cool hover:underline"
                  onClick={() =>
                    context.update({ sel: `${r.strategyId}:${r.version}`, detail: "checks" })
                  }
                >
                  {r.version}
                </button>
              ),
            },
            { title: "Состояние", render: (r) => r.activityLabel },
            { title: "Сохранённые записи", render: (r) => r.evidence.length },
          ]}
        />
      ) : null}
    </div>
  );
}
