"use client";

import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
} from "@/components/trader/admin-console/primitives/console-ui";
import type { DiscoveryLoopRunView } from "@/lib/trader/discovery/discovery-loop-view";

type DiscoveryLoopRead = {
  total: number;
  items: DiscoveryLoopRunView[];
};

export function DiscoveryLoopPanel() {
  const read = useAdminRead<DiscoveryLoopRead>("/api/trader/admin/discovery-loop");
  const items = read.envelope?.data.items ?? [];
  return (
    <ConsolePanel
      title="Discovery"
      note="Read saved runs, trials and verdicts only. No orders and no enabling trading."
    >
      {read.loading ? <ConsoleLoading /> : null}
      {read.reason ? (
        <div className="px-5 py-4">
          <DataState state="unavailable" reason={read.reason} />
        </div>
      ) : null}
      <ConsoleTable
        caption="Discovery runs"
        rows={items}
        rowKey={(row) => row.id}
        columns={[
          { title: "Time", render: (row) => row.createdAt },
          { title: "Campaign", render: (row) => row.campaignId },
          { title: "Status", render: (row) => row.status ?? "—" },
          { title: "Reason", render: (row) => row.reason ?? "—" },
          { title: "Equity", render: (row) => row.capitalAuthority ?? "—" },
          {
            title: "Verdicts",
            render: (row) =>
              row.verdicts
                .map((verdict) => `${verdict.partition}: ${verdict.verdict}`)
                .join(", ") || "—",
          },
        ]}
      />
    </ConsolePanel>
  );
}
