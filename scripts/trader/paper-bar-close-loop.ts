/** Existing paper command, with an explicit PostgreSQL observational-only mode (DEE-1121). */
import { pathToFileURL } from "node:url";

export async function runPaperBarCloseCli(args = process.argv.slice(2)) {
  args = [...args];
  if (args.includes("--saved-research-understanding")) {
    const { check }: Pick<typeof import("@/lib/trader/paper/research-understanding-v1/contract"), "check"> = await import("@/lib/trader/paper/research-understanding-v1/contract");
    check(process.env.WAIA_TRADER_CLI === "1", "CLI_MODE_REQUIRED");
    const { parseSavedResearchOptions } = await import("@/lib/trader/paper/research-understanding-v1/cli-options");
    const input = await parseSavedResearchOptions(args);
    const { getResolvedWaiaDbRuntimeConfig } = await import("@/db/runtime-backend");
    check(getResolvedWaiaDbRuntimeConfig().backend === "postgres", "POSTGRES_REQUIRED");
    const { shouldUsePerRequestPostgresClient } = await import("@/db/postgres-client");
    check(shouldUsePerRequestPostgresClient(), "OWNED_POSTGRES_POOL_REQUIRED");
    const { getWaiaRuntimeDb, disposeWaiaRuntimeDb } = await import("@/db/waia-runtime-db");
    const runtime = await getWaiaRuntimeDb();
    try {
      check(runtime.kind === "postgres" && runtime._sql, "OWNED_POSTGRES_POOL_REQUIRED");
      const { runSavedResearchLoop } = await import("@/lib/trader/paper/research-understanding-v1/run-saved-research-loop");
      // Trusted CLI SERVICE composition: no actor/user/permission data is accepted from files or flags.
      const result = await runSavedResearchLoop(runtime._sql, { organizationId: input.assignment.organizationId }, input);
      console.info(JSON.stringify({ kind: "saved_research_understanding", ...result }));
      return result;
    } finally { await disposeWaiaRuntimeDb(runtime); }
  }
  if (!args.includes("--durable-noncapital")) {
    // Keep all legacy mock/SQLite/Execution imports behind the old mode boundary.
    const { runLegacyPaperBarCloseLoop } = await import("./paper-bar-close-loop-legacy");
    return runLegacyPaperBarCloseLoop();
  }
  const { parseRecordedPaperOptions } = await import("@/lib/trader/paper/durable-noncapital/cli-options-v1");
  const { assertEnvironment, requireCondition }: Pick<typeof import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1"), "assertEnvironment" | "requireCondition"> = await import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1");
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
    if ((process.argv.includes("--durable-noncapital") || process.argv.includes("--saved-research-understanding")) && result && result.status !== "COMPLETE") process.exitCode = 1;
  }).catch(async (error: unknown) => {
    const restricted = process.argv.includes("--durable-noncapital") || process.argv.includes("--saved-research-understanding");
    if (restricted) {
      const { RecordedAnalysisRefusal } = await import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1");
      const { ResearchRefusal } = await import("@/lib/trader/paper/research-understanding-v1/contract");
      console.error("[trader:paper-loop] FAIL:", error instanceof RecordedAnalysisRefusal || error instanceof ResearchRefusal ? error.code : "INFRASTRUCTURE_FAILURE");
      process.exitCode = 1;
    } else {
      console.error("[trader:paper-loop] FAIL:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}
