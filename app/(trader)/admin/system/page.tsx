"use client";
import Link from "next/link";
import { Activity, Bot, Database, Server, ShieldCheck } from "lucide-react";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { ADMIN_SECTIONS } from "@/components/trader/admin-console/navigation/sections";
import {
  ConsoleBadge,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  EvidenceTime,
  controlClass,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import type { SystemReadModel } from "@/lib/trader/admin-console/read-models/system";

const JOB_LABELS: Record<string, string> = {
  payment_watcher: "Наблюдение платежей",
  treasury_watcher: "Наблюдение казначейства",
  settlement: "Зачёт платежей",
  market_brain: "Рыночный контур",
  paper_loop: "Виртуальный портфель Paper",
  admin_market_quotes: "Котировки HTX",
  admin_usd_quotes: "Котировки USD",
  admin_account_valuation: "Оценка счетов",
  admin_news: "Новости",
  admin_fear_greed: "Fear & Greed",
  admin_retention: "Хранение проекций",
  account_observation: "Наблюдение биржевых счетов",
  invoice_issue: "Ручной выпуск счетов",
};
const JOB_STATUS: Record<string, string> = {
  running: "Выполняется",
  succeeded: "Успешно",
  failed: "Ошибка",
  skipped: "Пропущено",
};
export default function AdminSystemPage() {
  const context = useAdminReadContext();
  const section = ADMIN_SECTIONS.find((item) => item.id === "system")!;
  const requested = context.params.get("tab");
  const tab =
    requested === "controls"
      ? "authority"
      : section.tabs.some(([id]) => id === requested)
        ? requested!
        : "services";
  const read = useAdminRead<SystemReadModel>(`/api/trader/admin/console/system?tab=${tab}`);
  const data = read.envelope?.data;
  const controls = data?.controls;
  return (
    <section>
      {read.loading ? <ConsoleLoading /> : null}
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {data && !read.reason ? (
        <div className="space-y-5">
          {["services", "sources", "jobs", "ai", "releases"].includes(tab) ? (
            <p className="text-waia-fg-muted text-xs leading-5">
              Общая инфраструктура парка. Её доступность не даёт разрешения на торговлю; допуски
              клиента показаны отдельно.
            </p>
          ) : null}
          {tab === "services" ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <ConsolePanel title="Консоль и API">
                  <div className="space-y-3 p-5">
                    <Server size={20} className="text-waia-accent-cool" />
                    <p className="text-sm">Ответ административного API получен.</p>
                    <EvidenceTime at={read.envelope?.generatedAt} />
                    <p className="text-waia-fg-muted text-xs">
                      Это проверка чтения. Готовность исполнения и разрешение рисковать не выводятся
                      из HTTP 200.
                    </p>
                  </div>
                </ConsolePanel>
                <ConsolePanel title="Сборщики">
                  <div className="space-y-3 p-5">
                    <Database size={20} className="text-waia-accent-cool" />
                    <p className="text-sm">Сохранённые запуски и возраст источников</p>
                    <button
                      className={controlClass}
                      onClick={() => context.update({ tab: "jobs" })}
                    >
                      Открыть задания
                    </button>
                  </div>
                </ConsolePanel>
                <ConsolePanel title="Исполнение">
                  <div className="space-y-3 p-5">
                    <Activity size={20} className="text-waia-accent-cool" />
                    <DataState
                      state="unavailable"
                      reason="EXECUTION_HOST_DIAGNOSTICS_UNAVAILABLE"
                    />
                    <p className="text-waia-fg-muted text-xs">
                      Наличие сохранённой оценки Runtime Authority показано в допусках и не заменяет
                      диагностику хоста.
                    </p>
                  </div>
                </ConsolePanel>
              </div>
              <ConsolePanel
                title="Последняя работа контуров"
                note="Отсутствие записи не считается успешным запуском."
              >
                <JobTable jobs={data.jobs} />
              </ConsolePanel>
            </>
          ) : null}
          {tab === "jobs" ? (
            <ConsolePanel
              title="Задания"
              note="Расписание — ожидаемый запуск; состояние берётся из сохранённого журнала. Ручной выпуск не является заданием cron."
            >
              <JobTable jobs={data.jobs} />
            </ConsolePanel>
          ) : null}
          {tab === "sources" ? (
            <ConsolePanel
              title="Источники"
              note="Данные собраны фоновыми сборщиками. Открытие этой страницы не обращается к бирже."
            >
              <ConsoleTable
                rows={data.sources ?? []}
                rowKey={(row) => `${row.source}:${row.kind}`}
                caption="Состояние источников"
                columns={[
                  {
                    title: "Источник",
                    render: (row) => (
                      <>
                        <p className="font-medium">{row.source}</p>
                        <p className="text-waia-fg-muted mt-1 text-xs">
                          {{ quotes: "Котировки", news: "Новости", fear_greed: "Fear & Greed" }[
                            row.kind
                          ] ?? row.kind}
                        </p>
                      </>
                    ),
                  },
                  {
                    title: "Состояние",
                    render: (row) => (
                      <ConsoleBadge tone={row.state === "ok" ? "good" : "warning"}>
                        {
                          {
                            ok: "Наблюдается",
                            partial: "Частичный охват",
                            stale: "Устарел",
                            unavailable: "Нет наблюдения",
                          }[row.state]
                        }
                      </ConsoleBadge>
                    ),
                  },
                  {
                    title: "Охват",
                    align: "right",
                    render: (row) =>
                      row.fresh === null
                        ? `${row.total} сохранённых записей`
                        : `${row.fresh} / ${row.total} актуальных`,
                  },
                  {
                    title: "Последнее наблюдение",
                    render: (row) => <EvidenceTime at={row.observedAt} label="" />,
                  },
                ]}
              />
            </ConsolePanel>
          ) : null}
          {tab === "ai" ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <ConsolePanel title="Административный помощник">
                <div className="space-y-4 p-5">
                  <Bot size={22} className="text-waia-accent-cool" />
                  <ConsoleBadge>
                    {data.assistant.enabled ? "Модель включена флагом" : "Модель выключена"}
                  </ConsoleBadge>
                  <p className="text-sm leading-6">
                    Помощник читает те же данные, что и разделы консоли. Изменяющих инструментов
                    нет. Быстрые ответы доступны без модели.
                  </p>
                  <p className="text-waia-fg-muted text-xs">
                    Флаг включения не подтверждает доступность провайдера. Ошибка помощника не
                    блокирует другие разделы.
                  </p>
                  <DataState state="unavailable" reason={data.assistant.telemetryReason} />
                </div>
              </ConsolePanel>
              <ConsolePanel title="Границы данных">
                <div className="space-y-4 p-5">
                  <DataState state="unavailable" reason="RESEARCH_REASONING_NOT_IN_CONSOLE" />
                  <DataState state="unavailable" reason="HOLDOUT_PROTECTED" />
                  <p className="text-waia-fg-muted text-sm leading-6">
                    Секреты биржи, приватная память AI-TWIN и запечатанные исследовательские данные
                    не входят в контекст помощника.
                  </p>
                </div>
              </ConsolePanel>
            </div>
          ) : null}
          {tab === "releases" ? (
            <ConsolePanel title="Текущий релиз">
              <div className="space-y-4 p-5">
                {data.release.state === "value" ? (
                  <>
                    <p className="font-mono text-sm break-all">{data.release.sha}</p>
                    <ConsoleBadge tone="warning">Совпадение с деплоем не подтверждено</ConsoleBadge>
                    <p className="text-waia-fg-muted text-sm">
                      Источник: WAIA_RELEASE_SHA. Переменная сообщает ревизию сборки и сама по себе
                      не подтверждает развёрнутый код.
                    </p>
                  </>
                ) : (
                  <DataState state="unavailable" reason={data.release.reason} />
                )}
              </div>
            </ConsolePanel>
          ) : null}
          {tab === "authority" && controls ? (
            <>
              <ConsolePanel
                title="Допуски и лимиты"
                action={<ShieldCheck size={19} className="text-waia-accent-cool" />}
              >
                <div className="space-y-3 p-5">
                  <p className="text-sm leading-6">
                    Live требует отдельного разрешения Org 0, действующего продвижения через
                    Strategy Validation Gate и допуска runtime/Risk. Paper, продвижение стратегии и
                    включение Live — разные шаги.
                  </p>
                  <p className="text-waia-fg-muted text-sm leading-6">
                    Risk только сужает допуск. Guardian даёт рекомендацию; исполнение сокращения
                    подтверждается отдельно. Из этой таблицы торговые команды не отправляются.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      className={`${controlClass} inline-flex items-center`}
                      href={context.href("/admin/live-enable")}
                    >
                      Процедура допуска Live
                    </Link>
                    <Link
                      className={`${controlClass} inline-flex items-center`}
                      href={context.href("/admin/kill-switches")}
                    >
                      Восстановление после остановки
                    </Link>
                  </div>
                  {controls.accountBindingReason ? (
                    <DataState state="not_applicable" reason={controls.accountBindingReason} />
                  ) : null}
                  {controls.truncated ? (
                    <DataState state="partial" reason="LIST_TRUNCATED" />
                  ) : null}
                </div>
              </ConsolePanel>
              <ConsolePanel
                title="Матрица выключателей"
                note="Существующий runtime поддерживает платформу и организацию. Области счёта, стратегии и инструмента не подменяются более широкой командой."
              >
                <ConsoleTable
                  rows={controls.killSwitches}
                  rowKey={(row) => row.id}
                  caption="Матрица выключателей"
                  columns={[
                    {
                      title: "Область",
                      render: (row) => (
                        <>
                          <p>
                            {row.scope === "platform"
                              ? "Весь парк"
                              : row.scope === "organization"
                                ? "Организация"
                                : row.scope}
                          </p>
                          <p className="text-waia-fg-muted mt-1 font-mono text-xs">
                            {row.organizationId}
                          </p>
                        </>
                      ),
                    },
                    {
                      title: "Тип / эффект",
                      render: (row) => (
                        <>
                          <p>{row.type}</p>
                          <p className="text-waia-fg-muted mt-1 text-xs">{row.enforcement}</p>
                        </>
                      ),
                    },
                    {
                      title: "Состояние",
                      render: (row) => (
                        <ConsoleBadge tone={row.state === "ACTIVE" ? "warning" : "neutral"}>
                          {row.state}
                        </ConsoleBadge>
                      ),
                    },
                    {
                      title: "Источник",
                      render: (row) => (row.origin === "manual" ? "Оператор" : "Автоматический"),
                    },
                    {
                      title: "Ревизия / дата",
                      render: (row) => (
                        <>
                          <p className="mb-1 tabular-nums">{row.version}</p>
                          <EvidenceTime at={row.at} label="" />
                        </>
                      ),
                    },
                  ]}
                />
              </ConsolePanel>
              <ConsolePanel title="Разрешение Live">
                <ConsoleTable
                  rows={controls.liveEnable}
                  rowKey={(row) => row.organizationId}
                  caption="Разрешение Live"
                  columns={[
                    {
                      title: "Клиент",
                      render: (row) => (
                        <span className="font-mono text-xs">{row.organizationId}</span>
                      ),
                    },
                    {
                      title: "Состояние",
                      render: (row) => <ConsoleBadge>{row.state}</ConsoleBadge>,
                    },
                    {
                      title: "Сохранённый предел",
                      align: "right",
                      render: (row) => formatAdminMoney(row.cap, row.currency),
                    },
                    { title: "Дата", render: (row) => <EvidenceTime at={row.at} label="" /> },
                  ]}
                />
              </ConsolePanel>
              <ConsolePanel
                title="Runtime Authority"
                note="Последняя сохранённая оценка для каждого экземпляра; текущая связь с хостом проверяется отдельно."
              >
                <ConsoleTable
                  rows={controls.runtimeAuthority}
                  rowKey={(row) => row.id}
                  caption="Runtime Authority"
                  columns={[
                    {
                      title: "Экземпляр",
                      render: (row) => (
                        <>
                          <p className="font-mono text-xs">{row.instance}</p>
                          <p className="text-waia-fg-muted mt-1 font-mono text-xs">
                            {row.organizationId}
                          </p>
                        </>
                      ),
                    },
                    {
                      title: "Положение",
                      render: (row) => (
                        <ConsoleBadge tone={row.posture === "NORMAL" ? "neutral" : "warning"}>
                          {row.posture}
                        </ConsoleBadge>
                      ),
                    },
                    {
                      title: "Дата оценки",
                      render: (row) => <EvidenceTime at={row.at} label="" />,
                    },
                  ]}
                />
              </ConsolePanel>
              <ConsolePanel
                title="Состояние Risk"
                note="Резерв Risk показан отдельно. Он не вычитается повторно из свободного остатка."
              >
                {controls.accountBindingReason ? (
                  <div className="p-5">
                    <DataState state="not_applicable" reason={controls.accountBindingReason} />
                    <button
                      className={`${controlClass} mt-3`}
                      onClick={() => context.update({ exchange_account_id: null })}
                    >
                      Показать runtime-счета клиента
                    </button>
                  </div>
                ) : (
                  <ConsoleTable
                    rows={controls.risk}
                    rowKey={(row) => `${row.organizationId}:${row.accountId}`}
                    caption="Состояние Risk"
                    columns={[
                      {
                        title: "Runtime-счёт",
                        render: (row) => (
                          <>
                            <p className="font-mono text-xs">{row.accountId}</p>
                            <p className="text-waia-fg-muted mt-1 font-mono text-xs">
                              {row.organizationId}
                            </p>
                          </>
                        ),
                      },
                      {
                        title: "Допуск / сверка",
                        render: (row) => (
                          <>
                            <ConsoleBadge>{row.posture}</ConsoleBadge>
                            <p className="text-waia-fg-muted mt-2 text-xs">
                              {row.reconciliation} · {row.killState}
                            </p>
                          </>
                        ),
                      },
                      {
                        title: "Лимит",
                        align: "right",
                        render: (row) => formatAdminMoney(row.limit, row.currency),
                      },
                      {
                        title: "Внутренний резерв",
                        align: "right",
                        render: (row) => formatAdminMoney(row.reserved, row.currency),
                      },
                      { title: "Дата", render: (row) => <EvidenceTime at={row.at} label="" /> },
                    ]}
                  />
                )}
              </ConsolePanel>
            </>
          ) : null}
          {tab === "audit" && data.audit ? (
            <ConsolePanel
              title="Аудит"
              note="Неизменяемый журнал AI-TRADER. Доступно только чтение; содержимое секретов и произвольные payload не выводятся."
            >
              {data.audit.reason ? (
                <div className="p-5">
                  <DataState state="not_applicable" reason={data.audit.reason} />
                  <button
                    className={`${controlClass} mt-3`}
                    onClick={() => context.update({ exchange_account_id: null })}
                  >
                    Аудит клиента
                  </button>
                </div>
              ) : (
                <ConsoleTable
                  rows={data.audit.items}
                  rowKey={(row) => row.id}
                  caption="Аудит AI-TRADER"
                  columns={[
                    {
                      title: "Действие",
                      render: (row) => <span className="font-mono text-xs">{row.action}</span>,
                    },
                    {
                      title: "Объект",
                      render: (row) => (
                        <>
                          <p>{row.entityType}</p>
                          <p className="text-waia-fg-muted mt-1 font-mono text-xs">
                            {row.entityId}
                          </p>
                        </>
                      ),
                    },
                    { title: "Инициатор", render: (row) => row.actorType },
                    { title: "Дата", render: (row) => <EvidenceTime at={row.at} label="" /> },
                  ]}
                />
              )}
            </ConsolePanel>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
function JobTable({ jobs }: { jobs: SystemReadModel["jobs"] }) {
  return (
    <ConsoleTable
      rows={jobs}
      rowKey={(row) => row.jobKey}
      caption="Сохранённые запуски заданий"
      columns={[
        {
          title: "Задание",
          render: (row) => (
            <>
              <p className="font-medium">{JOB_LABELS[row.jobKey] ?? row.jobKey}</p>
              <p className="text-waia-fg-muted mt-1 text-xs">
                {row.owner === "worker"
                  ? "Cloudflare Worker"
                  : row.owner === "human"
                    ? "Оператор"
                    : "Execution host"}
              </p>
            </>
          ),
        },
        { title: "Расписание", render: (row) => row.cron ?? row.capability ?? "Не установлено" },
        {
          title: "Последний запуск",
          render: (row) =>
            row.lastRun ? (
              <>
                <ConsoleBadge
                  tone={
                    row.lastRun.status === "failed"
                      ? "danger"
                      : row.state === "stale"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {JOB_STATUS[row.lastRun.status] ?? row.lastRun.status}
                </ConsoleBadge>
                {row.reason ? (
                  <div className="mt-2">
                    <DataState state={row.state} reason={row.reason} />
                  </div>
                ) : null}
              </>
            ) : (
              <DataState state="unavailable" reason={row.reason} />
            ),
        },
        { title: "Дата", render: (row) => <EvidenceTime at={row.lastRun?.at} label="" /> },
      ]}
    />
  );
}
