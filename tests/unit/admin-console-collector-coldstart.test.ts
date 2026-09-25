// @vitest-environment node
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
describe("collector cold start outside Next", () => {
  it("initializes with Worker-style absent import.meta.url and exposes initialized retention constants", async () => {
    const bundle = await build({
      stdin: {
        contents:
          'export * from "./lib/trader/admin-console/collectors/run-due"; export * from "./lib/trader/admin-console/collectors/postgres-store";',
        resolveDir: process.cwd(),
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      packages: "external",
      alias: { "@": process.cwd() },
      define: { "import.meta.url": "undefined" },
      logLevel: "silent",
    });
    const execution = spawnSync(process.execPath, ["-"], {
      // Linux limits each argv entry to 128 KiB; the real collector bundle is
      // larger. Send it over stdin so the same cold-start proof runs in CI.
      input:
        bundle.outputFiles[0]!.text +
        `
(async()=>{let count=0;const {PgDialect}=require("drizzle-orm/pg-core");
await module.exports.createPostgresCollectorStore({execute:async(statement)=>{
 const query=new PgDialect().sqlToQuery(statement);
 if(!query.sql.includes("LIMIT $2")||query.params[1]!==5000)throw new Error("UNINITIALIZED_RETENTION_LIMIT");
 count++;return {count:0};
}}).retain(new Date());if(count!==8)throw new Error("MISSING_RETENTION_BATCH");})().catch(e=>{console.error(e);process.exitCode=1;});
`,
      cwd: process.cwd(),
      env: { ...process.env, VITEST: "false", WAIA_POSTGRES_CLI: "" },
      encoding: "utf8",
    });
    expect(execution.error).toBeUndefined();
    expect(execution.stderr).toBe("");
    expect(execution.status).toBe(0);
  });
});
