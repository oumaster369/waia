/** Existing paper command, with an explicit PostgreSQL observational-only mode (DEE-1121). */
import { pathToFileURL } from "node:url";
import { parseRecordedPaperOptions } from "@/lib/trader/paper/durable-noncapital/cli-options-v1";
import { assertEnvironment, RecordedAnalysisRefusal, requireCondition } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";

export async function runPaperBarCloseCli(args = process.argv.slice(2)) {
  if (!args.includes("--durable-noncapital")) {
    // Keep all legacy mock/SQLite/Execution imports behind the old mode boundary.
    const { runLegacyPaperBarCloseLoop } = await import("./paper-bar-close-loop-legacy");
    return runLegacyPaperBarCloseLoop();
  }
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
    const { runRecordedPaperLoopPostgres } = await import("@/lib/trader/paper/durable-noncapital/run-recorded-paper-loop-postgres-v1");
    const result = await runRecordedPaperLoopPostgres(runtime._sql, input);
    console.info(JSON.stringify({ kind: "durable_noncapital_analysis", ...result }));
    return result;
  } finally { await disposeWaiaRuntimeDb(runtime); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPaperBarCloseCli().then(result => {
    // A typed operational stop is not completion of the requested sequence range.
    if (process.argv.includes("--durable-noncapital") && result && result.status !== "COMPLETE") process.exitCode = 1;
  }).catch((error: unknown) => {
    console.error("[trader:paper-loop] FAIL:", process.argv.includes("--durable-noncapital")
      ? error instanceof RecordedAnalysisRefusal ? error.code : "INFRASTRUCTURE_FAILURE"
      : error instanceof Error ? error.message : error);
    if (process.argv.includes("--durable-noncapital")) process.exitCode = 1;
    else process.exit(1);
  });
}
