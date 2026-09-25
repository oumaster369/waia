"use client";
import { useAdminReadContext } from "../../data/read-context";
import { useAdminRead } from "../../data/use-admin-read";
import {
  ConsoleDialog,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  EvidenceTime,
  controlClass,
} from "../../primitives/console-ui";
import { DataState } from "../../primitives/data-state";
import { formatAdminMoney } from "../../primitives/money";
import type { ResearchRunDetail } from "@/lib/trader/admin-console/research/run-detail";
import type { compareResearchRuns } from "@/lib/trader/admin-console/research/compare-runs";
export function selectedResearchRuns(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}
const conditionLabels = {
  dataset: "Набор данных",
  period: "Период воспроизведения",
  costs: "Издержки",
  version: "Стратегия и версия",
  model: "Модель прогнозов",
};
const tabs = [
  ["results", "Сделки и результаты"],
  ["cycles", "Циклы и причины"],
  ["data", "Данные"],
  ["artifacts", "Артефакты"],
  ["logs", "Журнал"],
] as const;
const money = (v: string | null) =>
  v === null ? (
    <DataState state="unavailable" reason="RESEARCH_METRIC_NOT_PERSISTED" />
  ) : (
    formatAdminMoney(v, "USDT")
  );
export function ResearchRunDetails() {
  const context = useAdminReadContext(),
    selected = context.params.get("run"),
    compare = selectedResearchRuns(context.params.get("compare")),
    comparing = context.params.get("compare_open") === "1";
  const suffix = new URLSearchParams();
  for (const id of compare) suffix.append("run_id", id);
  const endpoint = comparing
    ? `/api/trader/admin/console/research/compare?${suffix}`
    : selected
      ? `/api/trader/admin/console/research/runs/${encodeURIComponent(selected)}`
      : null;
  const read = useAdminRead<{
    items: ResearchRunDetail[];
    comparison: ReturnType<typeof compareResearchRuns> | null;
  }>(endpoint);
  const tab = tabs.some(([id]) => id === context.params.get("run_tab"))
    ? context.params.get("run_tab")!
    : "results";
  const data = read.envelope?.data;
  return (
    <ConsoleDialog
      open={!!selected || comparing}
      onClose={() => context.update({ run: null, compare_open: null, run_tab: null })}
      title={comparing ? "Сравнение запусков" : "Доказательства запуска"}
      description="Сохранённые результаты исторического контура. Успешный тест сам по себе не даёт допуска к торговле."
      wide
    >
      {read.loading ? (
        <ConsoleLoading />
      ) : read.reason ? (
        <DataState state="unavailable" reason={read.reason} />
      ) : data ? (
        <div className="space-y-5">
          {comparing ? (
            <>
              <ConsolePanel
                title="Сначала — условия сравнения"
                note="Совпадение неизвестных значений не подтверждает одинаковые условия."
              >
                <ConsoleTable
                  rows={Object.entries(conditionLabels)}
                  rowKey={(r) => r[0]}
                  caption="Условия запусков"
                  columns={[
                    { title: "Условие", render: (r) => r[1] },
                    ...data.items.map((run) => ({
                      title: run.runId,
                      render: (r: [string, string]) => (
                        <span className="text-xs break-all">
                          {run.conditions[r[0] as keyof typeof conditionLabels] ?? "Не сохранено"}
                        </span>
                      ),
                    })),
                  ]}
                />
                {data.comparison?.ok ? (
                  <p className="p-4 text-sm">
                    {data.comparison.sameConditions
                      ? "Условия совпадают."
                      : `Есть различия или неподтверждённые условия: ${[...new Set([...data.comparison.differences, ...data.comparison.unknownConditions])].map((k) => conditionLabels[k as keyof typeof conditionLabels]).join(", ")}.`}
                  </p>
                ) : null}
              </ConsolePanel>
              <ConsoleTable
                rows={data.items}
                rowKey={(r) => r.id}
                caption="Прибыльность отдельно от качества прогнозов"
                columns={[
                  { title: "Запуск", render: (r) => <span className="break-all">{r.runId}</span> },
                  { title: "Операционный результат", render: (r) => money(r.metrics.netPnl) },
                  {
                    title: "Качество прогнозов",
                    render: (r) =>
                      r.metrics.forecastQuality ?? (
                        <DataState state="unavailable" reason="FORECAST_QUALITY_NOT_PERSISTED" />
                      ),
                  },
                ]}
              />
            </>
          ) : null}
          {!comparing && data.items[0] ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {data.items[0].symbol} · {data.items[0].partition}
                  </p>
                  <p className="text-waia-fg-muted text-xs break-all">{data.items[0].runId}</p>
                </div>
                <EvidenceTime at={data.items[0].observedAt} />
              </div>
              <nav className="flex flex-wrap gap-2" aria-label="Содержание запуска">
                {tabs.map(([id, label]) => (
                  <button
                    key={id}
                    aria-current={tab === id ? "page" : undefined}
                    className={`${controlClass} ${tab === id ? "border-waia-accent-cool" : ""}`}
                    onClick={() => context.update({ run_tab: id })}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {data.items.map((run) => (
                <div key={run.id} className="space-y-4">
                  {tab === "results" ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {[
                          ["Капитал", run.metrics.equity],
                          ["Свободно", run.metrics.cash],
                          ["Операционный результат", run.metrics.netPnl],
                        ].map(([label, value]) => (
                          <div className="border-waia-divider rounded-lg border p-4" key={label}>
                            <p className="text-waia-fg-muted text-xs">{label}</p>
                            <div className="mt-3 font-medium tabular-nums">{money(value)}</div>
                          </div>
                        ))}
                      </div>
                      <p className="text-waia-fg-muted text-xs">
                        USDT ·{" "}
                        {run.metrics.method === "historical_durable_checkpoint/v2"
                          ? "Подтверждённый снимок исторического воспроизведения"
                          : "Итог по запуску не сохранён"}
                        . До комиссии сервиса. Режимы не суммируются.
                      </p>
                      {run.resultSlices.length ? (
                        <ConsoleTable
                          rows={run.resultSlices}
                          rowKey={(r) => `${r.regime}:${r.strategySignalId}:${r.digest}`}
                          caption="Сохранённые срезы теста"
                          columns={[
                            {
                              title: "Режим / сигнал",
                              render: (r) => (
                                <span className="break-all">
                                  {r.regime} · {r.strategySignalId}
                                </span>
                              ),
                            },
                            { title: "Реализовано", render: (r) => money(r.realizedPnl) },
                            { title: "Торговые комиссии", render: (r) => money(r.fees) },
                            {
                              title: "Закрытые сделки",
                              render: (r) => r.closedTrades ?? "Не сохранено",
                            },
                          ]}
                        />
                      ) : null}
                      <DataState state="unavailable" reason="RETURN_METHOD_NOT_RATIFIED" />
                    </>
                  ) : null}
                  {tab === "cycles" ? (
                    <>
                      <p className="text-sm">
                        Подтверждённые циклы: {run.progress.committed ?? "не сохранено"}
                        {run.progress.qualified && run.progress.qualified > 0
                          ? ` / ${run.progress.qualified}`
                          : ""}
                      </p>
                      <ConsoleTable
                        rows={run.cycles}
                        rowKey={(r) => `${r.accountId}:${r.id}`}
                        caption="Подтверждённые циклы"
                        columns={[
                          {
                            title: "Цикл",
                            render: (r) => (
                              <span className="text-xs break-all">
                                {r.sequence} · {r.id}
                              </span>
                            ),
                          },
                          {
                            title: "Время рынка",
                            render: (r) => <EvidenceTime at={r.at} label="" />,
                          },
                          { title: "Результат", render: (r) => money(r.netPnl) },
                          {
                            title: "Решения / запреты Risk / fills",
                            render: (r) => `${r.decisions} / ${r.riskVetoes} / ${r.fills}`,
                          },
                          {
                            title: "Фиксация",
                            render: (r) =>
                              r.checkpoint ? (
                                <details>
                                  <summary className="cursor-pointer">Подтверждена</summary>
                                  <p className="text-xs break-all">{r.checkpoint}</p>
                                </details>
                              ) : (
                                <DataState state="unavailable" reason="NOT_PERSISTED_FOR_CYCLE" />
                              ),
                          },
                        ]}
                      />
                      {run.truncated ? (
                        <p>
                          Показано {run.cycles.length} из {run.totalCycles}. Итог взят из полной
                          проекции.
                        </p>
                      ) : null}
                      {run.kind === "backtest" ? (
                        <DataState
                          state="unavailable"
                          reason="BACKTEST_CYCLE_BINDING_NOT_PERSISTED"
                        />
                      ) : null}
                    </>
                  ) : null}
                  {tab === "data" ? (
                    <ConsoleTable
                      rows={Object.entries(conditionLabels)}
                      rowKey={(r) => r[0]}
                      caption="Данные и условия"
                      columns={[
                        { title: "Условие", render: (r) => r[1] },
                        {
                          title: "Сохранённое значение",
                          render: (r) =>
                            run.conditions[r[0] as keyof typeof conditionLabels] ? (
                              <span className="text-xs break-all">
                                {run.conditions[r[0] as keyof typeof conditionLabels]}
                              </span>
                            ) : (
                              <DataState
                                state="unavailable"
                                reason="RESEARCH_CONDITION_NOT_PERSISTED"
                              />
                            ),
                        },
                      ]}
                    />
                  ) : null}
                  {tab === "artifacts" ? (
                    <>
                      <ConsoleTable
                        rows={run.artifacts}
                        rowKey={(r) => r.label}
                        caption="Контрольные суммы доказательств"
                        columns={[
                          { title: "Доказательство", render: (r) => r.label },
                          {
                            title: "Контрольная сумма",
                            render: (r) => (
                              <span className="font-mono text-xs break-all">{r.digest}</span>
                            ),
                          },
                        ]}
                      />
                      <DataState state="unavailable" reason="HOLDOUT_PROTECTED" />
                    </>
                  ) : null}
                  {tab === "logs" ? (
                    <>
                      <ConsoleTable
                        rows={run.events}
                        rowKey={(r) => `${r.at}:${r.phase}:${r.committed}`}
                        caption="Жизненный цикл запуска"
                        columns={[
                          { title: "Этап", render: (r) => r.phase },
                          {
                            title: "Наблюдение",
                            render: (r) => <EvidenceTime at={r.at} label="" />,
                          },
                          { title: "Подтверждено циклов", render: (r) => r.committed },
                          { title: "Ошибка", render: (r) => r.errorCode ?? "Нет кода ошибки" },
                        ]}
                      />
                      <DataState state="unavailable" reason="SHADOW_JOURNAL_FILE_ONLY" />
                      <DataState state="unavailable" reason="RESEARCH_REASONING_FILE_ONLY" />
                    </>
                  ) : null}
                  {run.reasons.includes("HISTORICAL_EVIDENCE_INCOMPLETE") ? (
                    <DataState state="partial" reason="HISTORICAL_EVIDENCE_INCOMPLETE" />
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </ConsoleDialog>
  );
}
