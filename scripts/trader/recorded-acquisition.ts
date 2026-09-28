/** Fixed recorded-acquisition owner. Existing strict input/producer, separate operational lease. */
import { pathToFileURL } from "node:url";

export async function runRecordedAcquisitionCli(args = process.argv.slice(2)) {
  args = [...args];
  const { parseRecordedPaperOptions } = await import("@/lib/trader/paper/durable-noncapital/cli-options-v1");
  const { assertEnvironment } = await import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1");
  const requireCondition: typeof import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1").requireCondition = (await import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1")).requireCondition;
  requireCondition(process.env.WAIA_TRADER_CLI === "1", "CLI_MODE_REQUIRED");
  const input = parseRecordedPaperOptions(args); assertEnvironment();
  const { getResolvedWaiaDbRuntimeConfig } = await import("@/db/runtime-backend");
  requireCondition(getResolvedWaiaDbRuntimeConfig().backend === "postgres", "POSTGRES_REQUIRED");
  const { shouldUsePerRequestPostgresClient } = await import("@/db/postgres-client");
  requireCondition(shouldUsePerRequestPostgresClient(), "OWNED_POSTGRES_POOL_REQUIRED");
  const { getWaiaRuntimeDb, disposeWaiaRuntimeDb } = await import("@/db/waia-runtime-db");
  const runtime = await getWaiaRuntimeDb();
  try {
    requireCondition(runtime.kind === "postgres" && runtime._sql, "OWNED_POSTGRES_POOL_REQUIRED");
    const { runRecordedAcquisitionLoopPostgres } = await import("@/lib/trader/paper/durable-noncapital/run-recorded-paper-loop-postgres-v1");
    const result = await runRecordedAcquisitionLoopPostgres(runtime._sql, input);
    console.info(JSON.stringify({ kind: "recorded_acquisition_analysis", ...result }));
    return result;
  } finally { await disposeWaiaRuntimeDb(runtime); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecordedAcquisitionCli().then(result => {
    if (result.status !== "COMPLETE") process.exitCode = 1;
  }).catch(async (error: unknown) => {
    const { RecordedAnalysisRefusal } = await import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1");
    const { ResearchRefusal } = await import("@/lib/trader/paper/research-understanding-v1/contract");
    console.error("[trader:recorded-acquisition] FAIL:", error instanceof RecordedAnalysisRefusal || error instanceof ResearchRefusal ? error.code : "INFRASTRUCTURE_FAILURE");
    process.exitCode = 1;
  });
}
