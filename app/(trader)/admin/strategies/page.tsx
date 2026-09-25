"use client";
import Link from "next/link";
import { PromotionProposals } from "@/components/trader/admin-console/sections/strategies/proposals";
import { StrategyDetails } from "@/components/trader/admin-console/sections/strategies/strategy-details";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { ADMIN_SECTIONS } from "@/components/trader/admin-console/navigation/sections";
import {
  ConsoleBadge,
  ConsoleDialog,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  DetailLink,
  controlClass,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import type { StrategyWorkspace } from "@/lib/trader/admin-console/research/strategy-workspace";

export default function AdminStrategiesPage() {
  const context = useAdminReadContext();
  const section = ADMIN_SECTIONS.find((row) => row.id === "strategies")!;
  const tab = section.tabs.some(([id]) => id === context.params.get("tab"))
    ? context.params.get("tab")!
    : "working";
  const read = useAdminRead<StrategyWorkspace>("/api/trader/admin/console/strategies");
  const data = read.envelope?.data;
  const items = data?.items ?? [];
  const selected = items.find(
    (row) => `${row.strategyId}:${row.version}` === context.params.get("sel"),
  );
  return (
    <section>
      {read.loading ? <ConsoleLoading /> : null}
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {data && !read.reason ? (
        <ConsolePanel
          title={section.tabs.find(([id]) => id === tab)![1]}
          note="Стратегия и версия. Продвижение, квалификация и разрешение Live — отдельные факты."
          action={
            <Link
              className={`${controlClass} inline-flex items-center`}
              href={context.href("/admin/strategy-promotions")}
            >
              Продвижение стратегий
            </Link>
          }
        >
          <div className="border-waia-divider text-waia-fg-muted flex flex-wrap items-center gap-3 border-b px-5 py-3 text-xs">
            <span>Подтверждённый deployment: {data.workingCount ?? "неполный охват"}</span>
            <span>Контур: {read.envelope?.mode}</span>
            {data.scopeReason ? <DataState state="unavailable" reason={data.scopeReason} /> : null}
            {data.evidenceTruncated ? (
              <DataState state="partial" reason="STRATEGY_EVIDENCE_TRUNCATED" />
            ) : null}
          </div>
          <ConsoleTable
            rows={items.filter((row) => row.tab === tab)}
            rowKey={(row) => `${row.strategyId}:${row.version}`}
            caption="Стратегии и версии"
            columns={[
              {
                title: "Стратегия",
                render: (row) => (
                  <>
                    <DetailLink
                      onClick={() => context.update({ sel: `${row.strategyId}:${row.version}` })}
                    >
                      {row.displayName}
                    </DetailLink>
                    <p className="text-waia-fg-muted mt-1 font-mono text-xs">{row.strategyId}</p>
                  </>
                ),
              },
              {
                title: "Версия",
                render: (row) => <span className="font-mono text-xs">{row.version}</span>,
              },
              {
                title: "Состояние",
                render: (row) => (
                  <ConsoleBadge tone={row.working ? "good" : "neutral"}>
                    {row.activityLabel}
                  </ConsoleBadge>
                ),
              },
              {
                title: "Основание",
                render: (row) =>
                  row.deployments.length
                    ? `${row.deployments.length} действующих продвижений`
                    : row.recentlyWorked
                      ? "Сохранённые сделки выбранного контура"
                      : row.evidence.length
                        ? "Сохранённые записи исследования"
                        : "Каталог реализации",
              },
            ]}
          />
        </ConsolePanel>
      ) : null}
      {tab === "proposed" ? (
        <div className="mt-5">
          <PromotionProposals />
        </div>
      ) : null}
      <ConsoleDialog
        open={Boolean(selected)}
        onClose={() => context.update({ sel: null })}
        title={selected ? `${selected.displayName} · ${selected.version}` : "Стратегия"}
        wide
      >
        {selected ? <StrategyDetails strategy={selected} all={items} /> : null}
      </ConsoleDialog>
    </section>
  );
}
