import type { Metadata } from "next";

import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { getWaiaRuntimeDb, disposeWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { listBacktestRunsPostgres } from "@/lib/trader/research/backtest-run-repository-postgres";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Research — AI-TRADER",
  description: "Read-only research backtest run dashboard.",
};

function formatTimestamp(value: Date | null): string {
  return value ? value.toISOString() : "—";
}

export default async function TraderResearchPage() {
  const userId = await getOptionalSessionUserId();
  let runs: Awaited<ReturnType<typeof listBacktestRunsPostgres>> = [];
  let backend: "postgres" | "unavailable" = "unavailable";

  if (userId) {
    const organizationId = personalOrganizationIdFromUserId(userId);
    const context = requireOrgContext(organizationId);
    const runtime = await getWaiaRuntimeDb();
    try {
      if (runtime.kind === "postgres") {
        runs = await listBacktestRunsPostgres(runtime.db, context, { limit: 50 });
        backend = "postgres";
      }
    } finally {
      await disposeWaiaRuntimeDb(runtime);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">AI-TRADER · Research Intelligence</p>
        <h1 className="text-2xl font-semibold tracking-tight">Backtest runs</h1>
        <p className="text-muted-foreground text-sm">
          Read-only dashboard listing historical backtest runs when Postgres research substrate is
          available.
        </p>
        <p className="text-muted-foreground text-xs">
          Backend: <span className="font-mono">{backend}</span>
        </p>
      </header>

      {runs.length === 0 ? (
        <section className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No backtest runs recorded yet.
        </section>
      ) : (
        <section className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-xs tracking-wide uppercase">
              <tr>
                <th className="px-4 py-3">Strategy</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Split</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Cost model</th>
                <th className="px-4 py-3">Completed</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs">{run.strategyId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{run.strategyVersion}</td>
                  <td className="px-4 py-3">{run.split}</td>
                  <td className="px-4 py-3">{run.status}</td>
                  <td className="px-4 py-3 font-mono text-xs">{run.costModelVersion}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {formatTimestamp(run.completedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
