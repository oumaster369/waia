/** Fixed saved-research owner. No legacy fallback or caller-selected ownership domain. */
import { pathToFileURL } from "node:url";

export async function runSavedResearchCli(args = process.argv.slice(2)) {
  args = [...args];
  if (args.includes("--saved-research-application")) {
    const check: typeof import("@/lib/trader/paper/research-application-v1/contract").requireApplication = (await import("@/lib/trader/paper/research-application-v1/contract")).requireApplication;
    if (process.env.WAIA_TRADER_CLI !== "1") throw new Error("CLI_MODE_REQUIRED");
    const { parseSavedApplicationOptions } = await import("@/lib/trader/paper/research-application-v1/cli-options");
    const input = await parseSavedApplicationOptions(args);
    const { getResolvedWaiaDbRuntimeConfig } = await import("@/db/runtime-backend");
    check(getResolvedWaiaDbRuntimeConfig().backend === "postgres", "POSTGRES_REQUIRED");
    const { shouldUsePerRequestPostgresClient } = await import("@/db/postgres-client");
    check(shouldUsePerRequestPostgresClient(), "OWNED_POSTGRES_POOL_REQUIRED");
    const { getWaiaRuntimeDb, disposeWaiaRuntimeDb } = await import("@/db/waia-runtime-db");
    const runtime = await getWaiaRuntimeDb();
    try {
      check(runtime.kind === "postgres" && runtime._sql, "OWNED_POSTGRES_POOL_REQUIRED");
      const { runSavedDomainApplication } = await import("@/lib/trader/paper/research-application-v1/run-saved-application");
      const result = await runSavedDomainApplication(runtime._sql, { organizationId: input.configuration.organizationId }, input);
      console.info(JSON.stringify({ kind: "saved_domain_research_application", ...result })); return result;
    } finally { await disposeWaiaRuntimeDb(runtime); }
  }
  if (args.includes("--saved-research-understanding")) {
    const check: typeof import("@/lib/trader/paper/research-understanding-v1/contract").check = (await import("@/lib/trader/paper/research-understanding-v1/contract")).check;
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
      const { runSavedDomainResearchLoop } = await import("@/lib/trader/paper/research-understanding-v1/run-saved-research-loop");
      // Trusted CLI SERVICE composition: no actor/user/permission data is accepted from files or flags.
      const result = await runSavedDomainResearchLoop(runtime._sql, { organizationId: input.assignment.organizationId }, input);
      console.info(JSON.stringify({ kind: "saved_domain_research_understanding", ...result }));
      return result;
    } finally { await disposeWaiaRuntimeDb(runtime); }
  }
  throw new Error("SAVED_RESEARCH_MODE_REQUIRED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSavedResearchCli().then(result => {
    if (result.status !== "COMPLETE") process.exitCode = 1;
  }).catch(async (error: unknown) => {
    const { ResearchRefusal } = await import("@/lib/trader/paper/research-understanding-v1/contract");
    const { ResearchApplicationRefusal } = await import("@/lib/trader/paper/research-application-v1/contract");
    console.error("[trader:saved-research] FAIL:", error instanceof ResearchRefusal || error instanceof ResearchApplicationRefusal ? error.code : "INFRASTRUCTURE_FAILURE");
    process.exitCode = 1;
  });
}
