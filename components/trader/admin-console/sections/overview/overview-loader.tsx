"use client";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { ConsoleLoading } from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import {
  OverviewFinancialDetails,
  AccountsPreview,
  NewsPanel,
  FillsPreview,
  ActivityPanel,
  ClientsPreview,
  ResearchPreview,
  type OverviewData,
} from "@/components/trader/admin-console/sections/overview/overview-content";
import {
  OverviewPanel,
  overviewFromEnvelope,
} from "@/components/trader/admin-console/sections/overview/overview-panel";
export function OverviewLoader() {
  const { params } = useAdminReadContext();
  if (params.get("tab") === "market") return <NewsPanel full />;
  if (params.get("tab") === "algorithm") return <ActivityPanel full />;
  return <OverviewSummary />;
}
function OverviewSummary() {
  const read = useAdminRead<OverviewData>("/api/trader/admin/console/overview");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-5">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope ? <OverviewPanel view={overviewFromEnvelope(read.envelope)} /> : null}
      {read.envelope && overviewFromEnvelope(read.envelope).state === "ready" ? (
        <>
          <OverviewFinancialDetails data={read.envelope.data} />
          <AccountsPreview data={read.envelope.data} />
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <FillsPreview />
            <ActivityPanel />
          </div>
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <ClientsPreview />
            <ResearchPreview />
          </div>
          <NewsPanel />
        </>
      ) : null}
    </div>
  );
}
