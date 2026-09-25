"use client";
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
import type { ResearchCatalog } from "@/lib/trader/admin-console/research/catalog";
import type { presentResearchRun } from "@/lib/trader/admin-console/research/research-runs";
import { CycleDetails } from "@/components/trader/admin-console/sections/research/cycle-details";

type Runs = { items: ReturnType<typeof presentResearchRun>[]; total: number };
const labels: Record<string, string> = {
  QUEUED: "В очереди",
  RUNNING: "Выполняется",
  COMPLETED: "Завершён",
  FAILED: "Ошибка",
  STOPPED: "Остановлен",
  PROPOSED: "Предложена",
  VALIDATING: "Проверяется",
  VALIDATED: "Подтверждена",
  DECAYING: "Ослабевает",
  RETIRED: "В архиве",
  QUARANTINED: "Карантин",
  VERIFIED: "Подтверждена",
  UNVERIFIED: "Не подтверждена",
  SEALED: "Запечатан",
  draft: "Черновик",
  registered: "Зарегистрирована",
  backtested: "Тест завершён",
  walk_forward_validated: "Walk-forward пройден",
  blind_validated: "Проверка завершена",
  rejected: "Отклонена",
};
export function ResearchSection() {
  const context = useAdminReadContext();
  const section = ADMIN_SECTIONS.find((item) => item.id === "research")!;
  const tab = section.tabs.some(([id]) => id === context.params.get("tab"))
    ? context.params.get("tab")!
    : "campaigns";
  const runs = useAdminRead<Runs>(
    tab === "runs" ? "/api/trader/admin/console/research/runs" : null,
  );
  const catalogue = useAdminRead<ResearchCatalog>(
    tab !== "runs" ? `/api/trader/admin/console/research/catalog?tab=${tab}` : null,
  );
  const read = tab === "runs" ? runs : catalogue;
  const title = section.tabs.find(([id]) => id === tab)![1];
  return (
    <section>
      <CycleDetails />
      {read.loading ? <ConsoleLoading /> : null}
      {read.reason ? (
        <div className="mb-4">
          <DataState state="unavailable" reason={read.reason} />
          {read.reason === "RESEARCH_REQUIRES_HISTORY_MODE" ? (
            <button
              className={`${controlClass} mt-3`}
              onClick={() => context.update({ mode: "history" })}
            >
              Показать исторические запуски
            </button>
          ) : null}
          {read.reason === "RESEARCH_EXCHANGE_ACCOUNT_BINDING_NOT_PERSISTED" ? (
            <button
              className={`${controlClass} mt-3`}
              onClick={() => context.update({ exchange_account_id: null })}
            >
              Исследования клиента
            </button>
          ) : null}
        </div>
      ) : null}
      {!read.reason && tab === "runs" && runs.envelope ? (
        <ConsolePanel
          title={title}
          note="Исторический контур. Завершение теста не означает рекомендацию или допуск к торговле."
        >
          <ConsoleTable
            rows={runs.envelope.data.items ?? []}
            rowKey={(row) => `${row.organizationId}:${row.runId}`}
            caption="Исторические запуски"
            columns={[
              {
                title: "Запуск",
                render: (row) => <span className="font-mono text-xs break-all">{row.runId}</span>,
              },
              {
                title: "Рынок / выборка",
                render: (row) => (
                  <>
                    <p className="font-medium">{row.symbol}</p>
                    <p className="text-waia-fg-muted mt-1 text-xs">{row.partition}</p>
                  </>
                ),
              },
              {
                title: "Состояние",
                render: (row) => (
                  <>
                    <ConsoleBadge
                      tone={
                        row.inactive ? "warning" : row.phase === "FAILED" ? "danger" : "neutral"
                      }
                    >
                      {labels[row.phase] ?? row.phase}
                    </ConsoleBadge>
                    {row.inactive ? (
                      <p className="text-waia-warning mt-2 text-xs">
                        Нет активности более 10 минут
                      </p>
                    ) : null}
                  </>
                ),
              },
              {
                title: "Подтверждённые циклы",
                align: "right",
                render: (row) =>
                  row.qualifiedTotalCycles > 0
                    ? `${row.committedCycles} / ${row.qualifiedTotalCycles}`
                    : String(row.committedCycles),
              },
              {
                title: "Последнее наблюдение",
                render: (row) => <EvidenceTime at={row.observedAt} label="" />,
              },
            ]}
          />
          {runs.envelope.data.total > runs.envelope.data.items.length ? (
            <p className="text-waia-warning p-4 text-xs">
              Показано {runs.envelope.data.items.length} из {runs.envelope.data.total}
            </p>
          ) : null}
        </ConsolePanel>
      ) : null}
      {!read.reason && tab !== "runs" && catalogue.envelope ? (
        <ConsolePanel
          title={title}
          note={
            tab === "qualification"
              ? "Статус квалификации и факт запечатывания. Содержимое holdout закрыто."
              : "Сохранённые сведения исследовательского контура; Live и Paper здесь не суммируются."
          }
        >
          <ConsoleTable
            rows={catalogue.envelope.data.items}
            rowKey={(row) => `${row.kind}:${row.id}`}
            caption={title}
            columns={[
              {
                title: "Название",
                render: (row) => (
                  <>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-waia-fg-muted mt-1 text-xs">
                      {
                        {
                          campaign: "Кампания",
                          hypothesis: "Гипотеза",
                          edge: "Связь знаний",
                          dataset: "Набор данных",
                          qualification: "Квалификация стратегии",
                        }[row.kind]
                      }
                      {row.version ? ` · версия ${row.version}` : ""}
                    </p>
                  </>
                ),
              },
              {
                title: "Состояние",
                render: (row) =>
                  row.state ? (
                    <ConsoleBadge>{labels[row.state] ?? row.state}</ConsoleBadge>
                  ) : (
                    <DataState state="unavailable" reason="RESEARCH_STATE_NOT_PERSISTED" />
                  ),
              },
              { title: "Рынок / режим", render: (row) => row.symbol ?? "Не задан для этой записи" },
              {
                title: "Доказательство",
                render: (row) =>
                  row.evidenceRef ? (
                    <span title={row.evidenceRef} className="font-mono text-xs break-all">
                      {row.evidenceRef}
                    </span>
                  ) : row.kind === "dataset" ? (
                    "Только факт запечатывания"
                  ) : (
                    "Ссылка не сохранена"
                  ),
              },
              {
                title: "Дата записи",
                render: (row) => <EvidenceTime at={row.observedAt} label="" />,
              },
            ]}
          />
          {catalogue.envelope.data.state === "partial" ? (
            <p className="text-waia-warning p-4 text-xs">
              Показано {catalogue.envelope.data.items.length} из {catalogue.envelope.data.total}
            </p>
          ) : null}
        </ConsolePanel>
      ) : null}
      <p className="text-waia-fg-muted mt-5 text-xs leading-6">
        Shadow-журнал и исследовательские рассуждения из файлов здесь недоступны. Прогнозы и
        торговая прибыль оцениваются раздельно; запечатанный holdout не раскрывается.
      </p>
    </section>
  );
}
