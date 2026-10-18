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
  execution_attempt: "Execution attempt",
  execution_plan: "Execution plan",
  risk_allowance: "Risk admission",
  risk_verdict: "Risk verdict",
  decision: "Decision",
  forecast: "Forecast",
  exchange_reports: "Exchange reports",
  order_events: "Order events",
  fills: "Fills",
};
const LABELS: Record<string, string> = {
  attempt_state: "Attempt state",
  planned_quantity: "Planned quantity",
  plan_price: "Limit price",
  allowance_state: "Admission state",
  exact_qualified_quantity: "Permitted quantity",
  verdict: "Risk verdict",
  approved_qualified_quantity: "Approved quantity",
  decision_class: "Decision class",
  universal_terminal_reason_code: "Decision reason",
  strategy_id: "Strategy",
  strategy_version: "Strategy version",
  market_question: "Forecast question",
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
      title={data?.order ? `Order · ${data.order.symbol}` : "Order evidence"}
      description="Saved decision and execution chain. Exchange order acceptance and actual fills are shown separately."
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
              {data.order.mode} · {data.order.side === "buy" ? "Buy" : "Sell"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Quantity", data.order.quantity],
              ["Filled", data.order.filledQuantity],
              ["Type", data.order.orderType === "market" ? "Market" : "Limit"],
            ].map(([label, value]) => (
              <div key={label} className="border-waia-divider rounded-lg border p-4">
                <p className="text-waia-fg-muted text-xs">{label}</p>
                <p className="mt-2 font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {data.truncated ? <DataState state="partial" reason="ORDER_EVIDENCE_CAP" /> : null}
          <section
            aria-label="Evidence chain"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {data.trace.steps.map((step) => (
              <div className="border-waia-divider rounded-lg border p-4" key={step.step}>
                <h3 className="text-sm font-medium">{TITLES[step.step] ?? step.step}</h3>
                {step.state === "ok" ? (
                  <>
                    <p className="text-waia-success mt-2 text-xs">
                      {step.step === "fills" && !data.fills.length
                        ? "No fills yet"
                        : "Record confirmed"}
                    </p>
                    {step.at ? (
                      <div className="mt-2 text-[11px]">
                        <EvidenceTime at={step.at} label="" />
                      </div>
                    ) : null}
                    {step.recordId ? (
                      <details className="text-waia-fg-muted mt-2 text-[10px]">
                        <summary>Identifier</summary>
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
            <ConsolePanel title="Evidence contents">
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
                  Open the 23 cycle stages ↗
                </Link>
              ) : null}
            </ConsolePanel>
          ) : null}
          <ConsolePanel
            title="Fills"
            note="Price is in the instrument currency; the fee is in the saved asset. Each row represents one fill."
          >
            <ConsoleTable
              rows={data.fills}
              rowKey={(r) => r.id!}
              caption="Selected order fills"
              columns={[
                { title: "Quantity", render: (r) => r.quantity },
                { title: "Price", render: (r) => r.price },
                {
                  title: "Fee",
                  render: (r) =>
                    r.fee !== null ? (
                      formatAdminMoney(r.fee, r.fee_asset ?? "")
                    ) : (
                      <DataState state="unavailable" reason="FILL_FEE_MISSING" />
                    ),
                },
                { title: "Time", render: (r) => <EvidenceTime at={r.at} label="" /> },
              ]}
            />
          </ConsolePanel>
          <ConsolePanel title="Exchange reports">
            <ConsoleTable
              rows={data.reports}
              rowKey={(r) => r.id!}
              caption="Selected order reports"
              columns={[
                { title: "Type", render: (r) => r.type },
                { title: "Source", render: (r) => r.source },
                { title: "Sequence", render: (r) => r.sequence },
                { title: "Observation", render: (r) => <EvidenceTime at={r.at} label="" /> },
              ]}
            />
          </ConsolePanel>
          <ConsolePanel title="State history">
            <ConsoleTable
              rows={data.events}
              rowKey={(r) => r.id!}
              caption="Selected order events"
              columns={[
                { title: "Event", render: (r) => r.type },
                {
                  title: "State after",
                  render: (r) =>
                    ORDER_STATUS_LABELS[r.to_state as keyof typeof ORDER_STATUS_LABELS] ??
                    r.to_state,
                },
                { title: "Time", render: (r) => <EvidenceTime at={r.at} label="" /> },
              ]}
            />
          </ConsolePanel>
        </div>
      ) : null}
    </ConsoleDialog>
  );
}
