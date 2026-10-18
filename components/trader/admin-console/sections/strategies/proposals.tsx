"use client";
import { useAdminRead } from "../../data/use-admin-read";
import {
  ConsolePanel,
  ConsoleTable,
  ConsoleLoading,
  EvidenceTime,
} from "../../primitives/console-ui";
import { DataState } from "../../primitives/data-state";
import type { PromotionProposalSummary } from "@/lib/trader/admin-console/research/promotion-proposal";
export function PromotionProposals() {
  const read = useAdminRead<{ items: PromotionProposalSummary[] }>(
    "/api/trader/admin/console/proposals",
  );
  return (
    <ConsolePanel
      title="Research-mode proposals"
      note="A proposal does not assign an account, promote a strategy or enable trading."
    >
      {read.loading ? (
        <ConsoleLoading />
      ) : read.reason ? (
        <div className="p-5">
          <DataState state="unavailable" reason={read.reason} />
        </div>
      ) : (
        <div className="space-y-3 p-5">
          {read.envelope?.data.items.length ? (
            read.envelope.data.items.map((p) => (
              <details key={p.id} className="border-waia-divider rounded-lg border p-4">
                <summary className="cursor-pointer text-sm">
                  {p.symbols.join(", ") || "Instruments not saved"} ·{" "}
                  {p.disposition === "pending" ? "Awaiting review" : p.disposition}
                  <span className="text-waia-fg-muted ml-3 text-xs">{p.proposalId ?? p.id}</span>
                </summary>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <section>
                    <h3 className="text-sm font-medium">1. Proposal and hypothesis</h3>
                    <EvidenceTime at={p.createdAt} />
                    <p className="text-waia-fg-muted mt-2 text-xs break-all">
                      {p.digests.hypothesis ?? "Hypothesis not saved"}
                    </p>
                  </section>
                  {(
                    [
                      ["positive", "2. Supporting evidence"],
                      ["negative", "3. Contradicting evidence"],
                    ] as const
                  ).map(([key, label]) => (
                    <section key={key}>
                      <h3 className="mb-2 text-sm font-medium">{label}</h3>
                      <ConsoleTable
                        rows={p.evidence[key]}
                        rowKey={(r) => r.id}
                        caption={label}
                        columns={[
                          { title: "Outcome", render: (r) => r.polarity },
                          {
                            title: "Trade link",
                            render: (r) => (
                              <span className="text-xs break-all">
                                {r.tradeRef || "Not saved"}
                              </span>
                            ),
                          },
                        ]}
                      />
                    </section>
                  ))}
                  <section>
                    <h3 className="text-sm font-medium">4. Qualification and candidate</h3>
                    {Object.entries(p.digests)
                      .filter(([k]) => k !== "hypothesis")
                      .map(([key, value]) => (
                        <details className="mt-2 text-xs" key={key}>
                          <summary className="cursor-pointer">
                            {
                              {
                                candidate: "Candidate",
                                development: "Development",
                                walkForward: "Walk-forward",
                              }[key as "candidate"]
                            }
                          </summary>
                          <p className="mt-1 break-all">{value ?? "Not saved"}</p>
                        </details>
                      ))}
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-medium">5. Proposed instruments</h3>
                    <p className="text-sm">{p.symbols.join(", ") || "Not saved"}</p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-medium">6. Account assignment</h3>
                    <DataState state="unavailable" reason={p.assignmentReason} />
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-medium">7. Operator decision</h3>
                    <p className="text-waia-fg-muted text-sm">
                      Separate review and governed promotion are required. This card only displays the proposal.
                    </p>
                    <p className="mt-2 text-xs">
                      Capital authority: {p.capitalAuthority ?? "not established"}; assertion:{" "}
                      {p.approvalAuthority ?? "not established"}.
                    </p>
                  </section>
                </div>
              </details>
            ))
          ) : (
            <p className="text-waia-fg-muted text-sm">
              No proposals in the selected period and scope.
            </p>
          )}
        </div>
      )}
    </ConsolePanel>
  );
}
