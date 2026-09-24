"use client";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { ConsoleLoading } from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  OverviewPanel,
  overviewFromEnvelope,
} from "@/components/trader/admin-console/sections/overview/overview-panel";
export function OverviewLoader() {
  const read = useAdminRead<unknown>("/api/trader/admin/console/overview");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-5">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope ? <OverviewPanel view={overviewFromEnvelope(read.envelope)} /> : null}
    </div>
  );
}
