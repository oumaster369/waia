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
  ["results", "Results"],
  ["accounts", "Accounts and trades"],
  ["decisions", "Decisions"],
  ["checks", "Checks"],
  ["versions", "Versions"],
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
  live: "Live · real mode",
  paper: "Paper · virtual mode",
  history: "History · replay",
};
const evidenceLabels: Record<string, string> = {
  pending: "Awaiting run",
  running: "Running",
  completed: "Test completed",
  failed: "Test error",
  draft: "Draft",
  registered: "Registered",
  backtested: "Test completed",
  walk_forward_validated: "Walk-forward passed",
  blind_validated: "Review completed",
  rejected: "Rejected",
  DRAFT: "Promotion draft",
  PENDING_CONFIRM: "Awaiting confirmation",
  COOLING_OFF: "Cooling-off period",
  EFFECTIVE: "Promotion effective",
  CANCELLED: "Promotion cancelled",
  REVOKED: "Promotion revoked",
  OPEN: "Trade opened",
  CLOSED: "Trade closed",
  FORCED_FLAT: "Position forcibly closed",
  RESEARCHING: "Under research",
  PAPER: "Testing in Paper",
  RETIRED: "Archived",
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
        Evidence applies only to the selected version. A completed test does not mean a recommendation for promotion.
      </p>
      <nav className="flex flex-wrap gap-2" aria-label="Strategy contents">
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
                          ["Period realized result", money(result.realized)],
                          ["Trading fees", money(result.tradingFees)],
                          ["Closed trades", result.closedTradeCount ?? "Unavailable"],
                          [
                            "Winning trade ratio",
                            result.winRate === null
                              ? "No reliable denominator"
                              : `${formatAdminMoney(multiplyDecimal(result.winRate, "100"), "").trim()}%`,
                          ],
                          [
                            "Profit factor",
                            result.profitFactor === null
                              ? "No reliable denominator"
                              : formatAdminMoney(result.profitFactor, ""),
                          ],
                          ["Realized-result drawdown", money(result.maxRealizedDrawdown)],
                        ].map(([label, value]) => (
                          <div key={String(label)}>
                            <p className="text-waia-fg-muted text-xs">{label}</p>
                            <div className="mt-2 text-sm font-medium tabular-nums">{value}</div>
                          </div>
                        ))}
                      </div>
                      <p className="text-waia-fg-muted text-xs">
                        Before the service fee. Fees are counted once. Drawdown is in USDT along the realized-result sequence.
                      </p>
                      <ConsoleTable
                        rows={result.daily}
                        rowKey={(r) => r.day}
                        caption="Result by day"
                        columns={[
                          { title: "Day (UTC)", render: (r) => r.day },
                          { title: "Daily", render: (r) => money(r.realized) },
                          { title: "Since period start", render: (r) => money(r.cumulative) },
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
                        Accounts in observed trades: {result.accountCount ?? "partial coverage"}. Activity does not mean strategy assignment.
                      </p>
                      <ConsoleTable
                        rows={result.trades}
                        rowKey={(r) => r.id}
                        caption="Selected version trades"
                        columns={[
                          {
                            title: "Market / account",
                            render: (r) => (
                              <>
                                <p>{r.symbol}</p>
                                <p className="text-waia-fg-muted text-xs break-all">
                                  {r.account ?? "Account not established"}
                                </p>
                              </>
                            ),
                          },
                          {
                            title: "State",
                            render: (r) =>
                              r.state === "OPEN"
                                ? "Opened"
                                : r.state === "CLOSED"
                                  ? "Closed"
                                  : "Forcibly closed",
                          },
                          { title: "Realized per trade", render: (r) => money(r.realized) },
                          {
                            title: "Close",
                            render: (r) => <EvidenceTime at={r.closedAt} label="" />,
                          },
                        ]}
                      />
                      {result.totalTrades > result.trades.length ? (
                        <p className="text-waia-fg-muted text-xs">
                          Showing {result.trades.length} of {result.totalTrades}.
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
                caption="Selected version decisions"
                columns={[
                  {
                    title: "Market / mode",
                    render: (r) => (
                      <>
                        {r.symbol} · {modes[r.mode] ?? "Mode not established"}
                      </>
                    ),
                  },
                  { title: "Decision", render: (r) => r.decision },
                  {
                    title: "Basis",
                    render: (r) => (
                      <>
                        <p>{r.category ?? "Saved rationale"}</p>
                        <p className="text-waia-fg-muted text-xs break-all">{r.reason}</p>
                      </>
                    ),
                  },
                  { title: "Time", render: (r) => <EvidenceTime at={r.at} label="" /> },
                  {
                    title: "Evidence",
                    render: (r) => (
                      <Link
                        className="text-waia-accent-cool hover:underline"
                        href={context.href("/admin/research", {
                          tab: "runs",
                          cycle: r.cycleId,
                          organization_id: r.organizationId,
                        })}
                      >
                        Cycle
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
            caption="Strategy checks and evidence"
            columns={[
              {
                title: "Record",
                render: (r) =>
                  ({
                    trade: "Trade",
                    promotion: "Promotion",
                    candidate: "Qualification",
                    lifecycle: "Lifecycle",
                    test: "Test",
                  })[r.kind],
              },
              {
                title: "Client",
                render: (r) => <span className="text-xs break-all">{r.organizationId}</span>,
              },
              {
                title: "Status",
                render: (r) => (
                  <span title={r.state}>
                    <ConsoleBadge>{evidenceLabels[r.state] ?? r.state}</ConsoleBadge>
                  </span>
                ),
              },
              { title: "Date", render: (r) => <EvidenceTime at={r.at} label="" /> },
            ]}
          />
          <Link
            className={`${controlClass} inline-flex items-center`}
            href={context.href("/admin/strategy-promotions", { strategy_id: strategy.strategyId })}
          >
            Open governed promotion
          </Link>
        </>
      ) : null}
      {tab === "versions" ? (
        <ConsoleTable
          rows={all.filter((r) => r.strategyId === strategy.strategyId)}
          rowKey={(r) => r.version}
          caption="Versions without evidence inheritance"
          columns={[
            {
              title: "Version",
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
            { title: "State", render: (r) => r.activityLabel },
            { title: "Saved records", render: (r) => r.evidence.length },
          ]}
        />
      ) : null}
    </div>
  );
}
