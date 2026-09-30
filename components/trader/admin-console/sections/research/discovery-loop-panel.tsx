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
      note="Только чтение сохранённых запусков, испытаний и вердиктов. Без заявок и без включения торговли."
    >
      {read.loading ? <ConsoleLoading /> : null}
      {read.reason ? (
        <div className="px-5 py-4">
          <DataState state="unavailable" reason={read.reason} />
        </div>
      ) : null}
      <ConsoleTable
        caption="Запуски discovery"
        rows={items}
        rowKey={(row) => row.id}
        columns={[
          { title: "Время", render: (row) => row.createdAt },
          { title: "Кампания", render: (row) => row.campaignId },
          { title: "Статус", render: (row) => row.status ?? "—" },
          { title: "Причина", render: (row) => row.reason ?? "—" },
          { title: "Капитал", render: (row) => row.capitalAuthority ?? "—" },
          {
            title: "Вердикты",
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
