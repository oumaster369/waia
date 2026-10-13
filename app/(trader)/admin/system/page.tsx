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
import { JOB_LABELS, JOB_STATUS } from "@/lib/trader/admin-console/jobs/presentation";
import type { SystemReadModel } from "@/lib/trader/admin-console/read-models/system";

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
              Shared fleet infrastructure. Its availability does not grant trading permission; client permissions are shown separately.
            </p>
          ) : null}
          {tab === "services" ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <ConsolePanel title="Console and API">
                  <div className="space-y-3 p-5">
                    <Server size={20} className="text-waia-accent-cool" />
                    <p className="text-sm">Administrative API response received.</p>
                    <EvidenceTime at={read.envelope?.generatedAt} />
                    <p className="text-waia-fg-muted text-xs">
                      This is a read check. Execution readiness and permission to take risk cannot be inferred from HTTP 200.
                    </p>
                  </div>
                </ConsolePanel>
                <ConsolePanel title="Collectors">
                  <div className="space-y-3 p-5">
                    <Database size={20} className="text-waia-accent-cool" />
                    <p className="text-sm">Saved runs and source age</p>
                    <button
                      className={controlClass}
                      onClick={() => context.update({ tab: "jobs" })}
                    >
                      Open jobs
                    </button>
                  </div>
                </ConsolePanel>
                <ConsolePanel title="Execution">
                  <div className="space-y-3 p-5">
                    <Activity size={20} className="text-waia-accent-cool" />
                    <DataState
                      state="unavailable"
                      reason="EXECUTION_HOST_DIAGNOSTICS_UNAVAILABLE"
                    />
                    <p className="text-waia-fg-muted text-xs">
                      The presence of a saved Runtime Authority assessment is shown under permissions and does not replace host diagnostics.
                    </p>
                  </div>
                </ConsolePanel>
              </div>
              <ConsolePanel
                title="Recent activity by mode"
                note="An absent record does not mean a successful run."
              >
                <JobTable jobs={data.jobs} />
              </ConsolePanel>
            </>
          ) : null}
          {tab === "jobs" ? (
            <ConsolePanel
              title="Jobs"
              note="A schedule is an expected run; state comes from the saved log. Manual issuance is not a cron job."
            >
              <JobTable jobs={data.jobs} />
            </ConsolePanel>
          ) : null}
          {tab === "sources" ? (
            <ConsolePanel
              title="Sources"
              note="Data is gathered by background collectors. Opening this page does not contact the exchange."
            >
              <ConsoleTable
                rows={data.sources ?? []}
                rowKey={(row) => `${row.source}:${row.kind}`}
                caption="Source state"
                columns={[
                  {
                    title: "Source",
                    render: (row) => (
                      <>
                        <p className="font-medium">{row.source}</p>
                        <p className="text-waia-fg-muted mt-1 text-xs">
                          {{ quotes: "Quotes", news: "News", fear_greed: "Fear & Greed" }[
                            row.kind
                          ] ?? row.kind}
                        </p>
                      </>
                    ),
                  },
                  {
                    title: "State",
                    render: (row) => (
                      <ConsoleBadge tone={row.state === "ok" ? "good" : "warning"}>
                        {
                          {
                            ok: "Observed",
                            partial: "Partial coverage",
                            stale: "Stale",
                            unavailable: "No observation",
                          }[row.state]
                        }
                      </ConsoleBadge>
                    ),
                  },
                  {
                    title: "Coverage",
                    align: "right",
                    render: (row) =>
                      row.fresh === null
                        ? `${row.total} saved records`
                        : `${row.fresh} / ${row.total} current`,
                  },
                  {
                    title: "Last observation",
                    render: (row) => <EvidenceTime at={row.observedAt} label="" />,
                  },
                ]}
              />
            </ConsolePanel>
          ) : null}
          {tab === "ai" ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <ConsolePanel title="Administrative assistant">
                <div className="space-y-4 p-5">
                  <Bot size={22} className="text-waia-accent-cool" />
                  <ConsoleBadge>
                    {data.assistant.enabled ? "Model enabled by flag" : "Model disabled"}
                  </ConsoleBadge>
                  <p className="text-sm leading-6">
                    The assistant reads the same data as the console sections. It has no mutating tools. Quick answers work without a model.
                  </p>
                  <p className="text-waia-fg-muted text-xs">
                    The enable flag does not confirm provider availability. An assistant error does not block other sections.
                  </p>
                  <DataState state="unavailable" reason={data.assistant.telemetryReason} />
                </div>
              </ConsolePanel>
              <ConsolePanel title="Data boundaries">
                <div className="space-y-4 p-5">
                  <DataState state="unavailable" reason="RESEARCH_REASONING_NOT_IN_CONSOLE" />
                  <DataState state="unavailable" reason="HOLDOUT_PROTECTED" />
                  <p className="text-waia-fg-muted text-sm leading-6">
                    Exchange secrets, private AI-TWIN memory and sealed research data are excluded from the assistant context.
                  </p>
                </div>
              </ConsolePanel>
            </div>
          ) : null}
          {tab === "releases" ? (
            <ConsolePanel title="Current release">
              <div className="space-y-4 p-5">
                {data.release.state === "value" ? (
                  <>
                    <p className="font-mono text-sm break-all">{data.release.sha}</p>
                    <ConsoleBadge tone="warning">Deployment match is unconfirmed</ConsoleBadge>
                    <p className="text-waia-fg-muted text-sm">
                      Source: WAIA_RELEASE_SHA. The variable identifies the build revision and does not itself confirm deployed code.
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
                title="Permissions and limits"
                action={<ShieldCheck size={19} className="text-waia-accent-cool" />}
              >
                <div className="space-y-3 p-5">
                  <p className="text-sm leading-6">
                    Live requires separate Org 0 permission, an effective promotion through Strategy Validation Gate and runtime/Risk permission. Paper, strategy promotion and enabling Live are different steps.
                  </p>
                  <p className="text-waia-fg-muted text-sm leading-6">
                    Risk can only restrict permission. Guardian provides a recommendation; execution of a reduction is confirmed separately. This table sends no trading commands.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      className={`${controlClass} inline-flex items-center`}
                      href={context.href("/admin/live-enable")}
                    >
                      Live admission procedure
                    </Link>
                    <Link
                      className={`${controlClass} inline-flex items-center`}
                      href={context.href("/admin/kill-switches")}
                    >
                      Recovery after a stop
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
                title="Kill-switch matrix"
                note="The existing runtime supports platform and organization scope. Account, strategy and instrument scope cannot be substituted by a broader command."
              >
                <ConsoleTable
                  rows={controls.killSwitches}
                  rowKey={(row) => row.id}
                  caption="Kill-switch matrix"
                  columns={[
                    {
                      title: "Scope",
                      render: (row) => (
                        <>
                          <p>
                            {row.scope === "platform"
                              ? "Entire fleet"
                              : row.scope === "organization"
                                ? "Organization"
                                : row.scope}
                          </p>
                          <p className="text-waia-fg-muted mt-1 font-mono text-xs">
                            {row.organizationId}
                          </p>
                        </>
                      ),
                    },
                    {
                      title: "Type / effect",
                      render: (row) => (
                        <>
                          <p>{row.type}</p>
                          <p className="text-waia-fg-muted mt-1 text-xs">{row.enforcement}</p>
                        </>
                      ),
                    },
                    {
                      title: "State",
                      render: (row) => (
                        <ConsoleBadge tone={row.state === "ACTIVE" ? "warning" : "neutral"}>
                          {row.state}
                        </ConsoleBadge>
                      ),
                    },
                    {
                      title: "Source",
                      render: (row) => (row.origin === "manual" ? "Operator" : "Automatic"),
                    },
                    {
                      title: "Revision / date",
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
              <ConsolePanel title="Live permission">
                <ConsoleTable
                  rows={controls.liveEnable}
                  rowKey={(row) => row.organizationId}
                  caption="Live permission"
                  columns={[
                    {
                      title: "Client",
                      render: (row) => (
                        <span className="font-mono text-xs">{row.organizationId}</span>
                      ),
                    },
                    {
                      title: "State",
                      render: (row) => <ConsoleBadge>{row.state}</ConsoleBadge>,
                    },
                    {
                      title: "Saved limit",
                      align: "right",
                      render: (row) => formatAdminMoney(row.cap, row.currency),
                    },
                    { title: "Date", render: (row) => <EvidenceTime at={row.at} label="" /> },
                  ]}
                />
              </ConsolePanel>
              <ConsolePanel
                title="Runtime Authority"
                note="Latest saved assessment for each instance; current host connectivity is checked separately."
              >
                <ConsoleTable
                  rows={controls.runtimeAuthority}
                  rowKey={(row) => row.id}
                  caption="Runtime Authority"
                  columns={[
                    {
                      title: "Instance",
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
                      title: "Posture",
                      render: (row) => (
                        <ConsoleBadge tone={row.posture === "NORMAL" ? "neutral" : "warning"}>
                          {row.posture}
                        </ConsoleBadge>
                      ),
                    },
                    {
                      title: "Reasons",
                      render: (row) =>
                        row.reasonCodes?.length ? (
                          <ul className="space-y-1 text-xs">
                            {row.reasonCodes.map((code) => (
                              <li key={code}>{code}</li>
                            ))}
                          </ul>
                        ) : (
                          <DataState state="unavailable" reason="RUNTIME_REASON_NOT_RECORDED" />
                        ),
                    },
                    {
                      title: "Assessment date",
                      render: (row) => <EvidenceTime at={row.at} label="" />,
                    },
                  ]}
                />
              </ConsolePanel>
              <ConsolePanel
                title="Risk state"
                note="The Risk reserve is shown separately. It is not deducted again from the available balance."
              >
                {controls.accountBindingReason ? (
                  <div className="p-5">
                    <DataState state="not_applicable" reason={controls.accountBindingReason} />
                    <button
                      className={`${controlClass} mt-3`}
                      onClick={() => context.update({ exchange_account_id: null })}
                    >
                      Show client runtime accounts
                    </button>
                  </div>
                ) : (
                  <ConsoleTable
                    rows={controls.risk}
                    rowKey={(row) => `${row.organizationId}:${row.accountId}`}
                    caption="Risk state"
                    columns={[
                      {
                        title: "Runtime account",
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
                        title: "Admission / reconciliation",
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
                        title: "Limit",
                        align: "right",
                        render: (row) => formatAdminMoney(row.limit, row.currency),
                      },
                      {
                        title: "Internal reserve",
                        align: "right",
                        render: (row) => formatAdminMoney(row.reserved, row.currency),
                      },
                      { title: "Date", render: (row) => <EvidenceTime at={row.at} label="" /> },
                    ]}
                  />
                )}
              </ConsolePanel>
            </>
          ) : null}
          {tab === "audit" && data.audit ? (
            <ConsolePanel
              title="Audit"
              note="Immutable AI-TRADER log. Read-only access; secret contents and arbitrary payloads are not displayed."
            >
              {data.audit.reason ? (
                <div className="p-5">
                  <DataState state="not_applicable" reason={data.audit.reason} />
                  <button
                    className={`${controlClass} mt-3`}
                    onClick={() => context.update({ exchange_account_id: null })}
                  >
                    Client audit
                  </button>
                </div>
              ) : (
                <ConsoleTable
                  rows={data.audit.items}
                  rowKey={(row) => row.id}
                  caption="AI-TRADER audit"
                  columns={[
                    {
                      title: "Action",
                      render: (row) => <span className="font-mono text-xs">{row.action}</span>,
                    },
                    {
                      title: "Entity",
                      render: (row) => (
                        <>
                          <p>{row.entityType}</p>
                          <p className="text-waia-fg-muted mt-1 font-mono text-xs">
                            {row.entityId}
                          </p>
                        </>
                      ),
                    },
                    { title: "Initiator", render: (row) => row.actorType },
                    { title: "Date", render: (row) => <EvidenceTime at={row.at} label="" /> },
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
      caption="Saved job runs"
      columns={[
        {
          title: "Job",
          render: (row) => (
            <>
              <p className="font-medium">{JOB_LABELS[row.jobKey] ?? row.jobKey}</p>
              <p className="text-waia-fg-muted mt-1 text-xs">
                {row.owner === "worker"
                  ? "Cloudflare Worker"
                  : row.owner === "human"
                    ? "Operator"
                    : "Execution host"}
              </p>
            </>
          ),
        },
        { title: "Schedule", render: (row) => row.cron ?? row.capability ?? "Not established" },
        {
          title: "Last run",
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
        { title: "Date", render: (row) => <EvidenceTime at={row.lastRun?.at} label="" /> },
      ]}
    />
  );
}
