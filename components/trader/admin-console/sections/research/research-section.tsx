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
import { ResearchRunDetails, selectedResearchRuns } from "./run-details";
import { CycleDetails } from "@/components/trader/admin-console/sections/research/cycle-details";

type Runs = {
  items: (Omit<
    ReturnType<typeof presentResearchRun>,
    "committedCycles" | "qualifiedTotalCycles"
  > & {
    id: string;
    kind: string;
    committedCycles: number | null;
    qualifiedTotalCycles: number | null;
  })[];
  total: number;
};
const labels: Record<string, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Error",
  STOPPED: "Stopped",
  PROPOSED: "Proposed",
  VALIDATING: "Under review",
  VALIDATED: "Confirmed",
  DECAYING: "Weakening",
  RETIRED: "Archived",
  QUARANTINED: "Quarantined",
  VERIFIED: "Confirmed",
  UNVERIFIED: "Unconfirmed",
  SEALED: "Sealed",
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
  draft: "Draft",
  registered: "Registered",
  backtested: "Test completed",
  walk_forward_validated: "Walk-forward passed",
  blind_validated: "Review completed",
  rejected: "Rejected",
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
    tab !== "runs"
      ? `/api/trader/admin/console/research/catalog?tab=${tab}${context.params.get("status") ? `&status=${encodeURIComponent(context.params.get("status")!)}` : ""}`
      : null,
  );
  const read = tab === "runs" ? runs : catalogue;
  const compared = selectedResearchRuns(context.params.get("compare"));
  const title = section.tabs.find(([id]) => id === tab)![1];
  return (
    <section>
      <CycleDetails />
      <ResearchRunDetails />
      {read.loading ? <ConsoleLoading /> : null}
      {read.reason ? (
        <div className="mb-4">
          <DataState state="unavailable" reason={read.reason} />
          {read.reason === "RESEARCH_REQUIRES_HISTORY_MODE" ? (
            <button
              className={`${controlClass} mt-3`}
              onClick={() => context.update({ mode: "history" })}
            >
              Show historical runs
            </button>
          ) : null}
          {read.reason === "RESEARCH_EXCHANGE_ACCOUNT_BINDING_NOT_PERSISTED" ? (
            <button
              className={`${controlClass} mt-3`}
              onClick={() => context.update({ exchange_account_id: null })}
            >
              Client research
            </button>
          ) : null}
        </div>
      ) : null}
      {!read.reason && tab === "runs" && runs.envelope ? (
        <ConsolePanel
          title={title}
          action={
            <button
              className={controlClass}
              disabled={compared.length < 2}
              onClick={() => context.update({ compare_open: "1", run: null })}
            >
              Compare {compared.length ? `(${compared.length})` : "2–4 runs"}
            </button>
          }
          note="Historical mode. Test completion does not mean a recommendation or trading admission."
        >
          <ConsoleTable
            rows={runs.envelope.data.items ?? []}
            rowKey={(row) => row.id}
            caption="Historical runs"
            columns={[
              {
                title: "Compare",
                render: (row) => (
                  <input
                    type="checkbox"
                    aria-label={`Compare run ${row.runId}`}
                    checked={compared.includes(row.id)}
                    disabled={!compared.includes(row.id) && compared.length >= 4}
                    onChange={(e) =>
                      context.update({
                        compare: JSON.stringify(
                          e.target.checked
                            ? [...compared, row.id]
                            : compared.filter((id) => id !== row.id),
                        ),
                      })
                    }
                  />
                ),
              },
              {
                title: "Run",
                render: (row) => (
                  <button
                    className="text-waia-accent-cool text-left text-xs break-all hover:underline"
                    onClick={() => context.update({ run: row.id, run_tab: null })}
                  >
                    {row.runId}
                    <span className="text-waia-fg-muted mt-1 block">
                      {row.kind === "backtest" ? "Strategy test" : "Historical replay"}
                    </span>
                  </button>
                ),
              },
              {
                title: "Market / sample",
                render: (row) => (
                  <>
                    <p className="font-medium">{row.symbol}</p>
                    <p className="text-waia-fg-muted mt-1 text-xs">{row.partition}</p>
                  </>
                ),
              },
              {
                title: "State",
                render: (row) => (
                  <>
                    <ConsoleBadge
                      tone={
                        row.inactive ? "warning" : row.phase === "FAILED" ? "danger" : "neutral"
                      }
                    >
                      {labels[row.phase] ?? labels[row.phase.toLowerCase()] ?? row.phase}
                    </ConsoleBadge>
                    {row.inactive ? (
                      <p className="text-waia-warning mt-2 text-xs">
                        No activity for over 10 minutes
                      </p>
                    ) : null}
                  </>
                ),
              },
              {
                title: "Confirmed cycles",
                align: "right",
                render: (row) =>
                  row.qualifiedTotalCycles !== null && row.qualifiedTotalCycles > 0 ? (
                    `${row.committedCycles} / ${row.qualifiedTotalCycles}`
                  ) : row.committedCycles === null ? (
                    <DataState
                      state="not_applicable"
                      reason="BACKTEST_CYCLE_BINDING_NOT_PERSISTED"
                    />
                  ) : (
                    String(row.committedCycles)
                  ),
              },
              {
                title: "Last observation",
                render: (row) => <EvidenceTime at={row.observedAt} label="" />,
              },
            ]}
          />
          {runs.envelope.data.total > runs.envelope.data.items.length ? (
            <p className="text-waia-warning p-4 text-xs">
              Showing {runs.envelope.data.items.length} of {runs.envelope.data.total}
            </p>
          ) : null}
        </ConsolePanel>
      ) : null}
      {!read.reason && tab !== "runs" && catalogue.envelope ? (
        <ConsolePanel
          title={title}
          note={
            tab === "qualification"
              ? "Qualification status and sealing fact. Holdout contents are inaccessible."
              : "Saved research-mode information; Live and Paper are not summed here."
          }
        >
          <ConsoleTable
            rows={catalogue.envelope.data.items}
            rowKey={(row) => `${row.kind}:${row.id}`}
            caption={title}
            columns={[
              {
                title: "Name",
                render: (row) => (
                  <>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-waia-fg-muted mt-1 text-xs">
                      {
                        {
                          campaign: "Campaign",
                          hypothesis: "Hypothesis",
                          edge: "Knowledge link",
                          dataset: "Dataset",
                          qualification: "Strategy qualification",
                        }[row.kind]
                      }
                      {row.version ? ` · version ${row.version}` : ""}
                    </p>
                  </>
                ),
              },
              {
                title: "State",
                render: (row) =>
                  row.state ? (
                    <ConsoleBadge>
                      {labels[row.state] ?? labels[row.state.toLowerCase()] ?? row.state}
                    </ConsoleBadge>
                  ) : (
                    <DataState state="unavailable" reason="RESEARCH_STATE_NOT_PERSISTED" />
                  ),
              },
              { title: "Market / regime", render: (row) => row.symbol ?? "Not specified for this record" },
              {
                title: "Evidence",
                render: (row) =>
                  row.evidenceRef ? (
                    <span title={row.evidenceRef} className="font-mono text-xs break-all">
                      {row.evidenceRef}
                    </span>
                  ) : row.kind === "dataset" ? (
                    "Sealing fact only"
                  ) : (
                    "Link not saved"
                  ),
              },
              {
                title: "Record date",
                render: (row) => <EvidenceTime at={row.observedAt} label="" />,
              },
            ]}
          />
          {catalogue.envelope.data.state === "partial" ? (
            <p className="text-waia-warning p-4 text-xs">
              Showing {catalogue.envelope.data.items.length} of {catalogue.envelope.data.total}
            </p>
          ) : null}
        </ConsolePanel>
      ) : null}
      <p className="text-waia-fg-muted mt-5 text-xs leading-6">
        Shadow logs and research reasoning from files are unavailable here. Forecasts and trading profit are assessed separately; sealed holdout is not disclosed.
      </p>
    </section>
  );
}
