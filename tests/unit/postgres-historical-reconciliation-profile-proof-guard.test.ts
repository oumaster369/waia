import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
const directory = mkdtempSync(join(tmpdir(), "waia-profile35-proof-"));
const file = join(directory, "report.json");
const required = "commits 35 production cycles and applies the first future-only Forecast learning closure";
const optional = "continues the upfront 80-cycle extent and binds matured knowledge to an authorized Forecast";
const environment = { ...process.env, WAIA_PG_INTEGRATION: "1", WAIA_POSTGRES_CLI: "1", WAIA_TRADER_CLI: "1",
  WAIA_HISTORICAL_PG_RECONCILIATION_PROFILE: "HISTORICAL_PG_RECONCILIATION_V1", WAIA_HISTORICAL_KNOWLEDGE_CONTINUATION_PROOF: "0",
  DATABASE_URL_POSTGRES: "postgresql://waia_it:synthetic@127.0.0.1:5432/waia_it",
  DATABASE_URL_POSTGRES_SESSION: "postgresql://waia_it:synthetic@127.0.0.1:5432/waia_it" };
const passed = () => [{ name: "/workspace/tests/integration/postgres-historical-production-first-cycle-v2.test.ts", status: "passed",
  assertionResults: [{ title: required, status: "passed" }, { title: "another actual companion", status: "passed" }] }];
function run(testResults = passed(), env: NodeJS.ProcessEnv = environment) {
  writeFileSync(file, JSON.stringify({ testResults }));
  return spawnSync(process.execPath, ["scripts/postgres-validation/assert-historical-reconciliation-profile-results.mjs", file], { encoding: "utf8", env });
}
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });
describe("mandatory PROFILE35 executed proof", () => {
  it("accepts exactly one35 assertion and all other registered assertions passed", () => {
    const result = run(); expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ profile: "HISTORICAL_PG_RECONCILIATION_V1", expectedCycles: 35,
      allRegisteredPassed: true, optional80Registered: false, registeredAssertions: 2 });
  });
  it.each(["missing-file", "duplicate-file", "wrong-file", "failed-suite", "missing-35", "duplicate-35", "empty", "failed", "pending", "optional80"])(
    "rejects %s without a skip or title-filter waiver", mode => {
      let report = passed();
      if (mode === "missing-file") report = [];
      if (mode === "duplicate-file") report.push(report[0]!);
      if (mode === "wrong-file") report[0]!.name = "/workspace/tests/integration/other.test.ts";
      if (mode === "failed-suite") report[0]!.status = "failed";
      if (mode === "missing-35") report[0]!.assertionResults.shift();
      if (mode === "duplicate-35") report[0]!.assertionResults.push(report[0]!.assertionResults[0]!);
      if (mode === "empty") report[0]!.assertionResults = [];
      if (mode === "failed" || mode === "pending") report[0]!.assertionResults[1]!.status = mode;
      if (mode === "optional80") report[0]!.assertionResults.push({ title: optional, status: "passed" });
      expect(run(report).status).not.toBe(0);
    });
  it.each(["WAIA_PG_INTEGRATION", "WAIA_POSTGRES_CLI", "WAIA_TRADER_CLI", "WAIA_HISTORICAL_PG_RECONCILIATION_PROFILE", "DATABASE_URL_POSTGRES", "DATABASE_URL_POSTGRES_SESSION"])(
    "rejects missing %s command binding", field => {
      expect(run(passed(), { ...environment, [field]: undefined }).status).not.toBe(0);
    });
  it("rejects selected80 or LEGACY command environments", () => {
    expect(run(passed(), { ...environment, WAIA_HISTORICAL_KNOWLEDGE_CONTINUATION_PROOF: "1" }).status).not.toBe(0);
    expect(run(passed(), { ...environment, WAIA_HISTORICAL_PG_RECONCILIATION_PROFILE: "LEGACY" }).status).not.toBe(0);
  });
  it("wires capital24 and the independent75-minute PROFILE35 job without changing generic LEGACY", () => {
    const workflow = parse(readFileSync(".github/workflows/postgres-integration.yml", "utf8"));
    const capital = workflow.jobs["capital-authority"];
    expect(capital["timeout-minutes"]).toBe(15);
    const bootstrap = capital.steps.find((s: { run?: string }) => s.run?.includes("prepare-historical-reconciliation-fixture.ts"));
    expect(bootstrap.env.WAIA_POSTGRES_CLI).toBe("1");
    expect(capital.steps.filter((s: { run?: string }) => s.run?.includes("db:postgres:auth-prelude"))).toHaveLength(0);
    const command = capital.steps.find((s: { run?: string }) => s.run?.includes("assert-capital-test-results"));
    expect(command.run.match(/tests\/integration\/[^\s]+\.test\.ts/g)).toHaveLength(24);
    expect(command.run).toContain("postgres-historical-production-reconciliation-frontier-v1.test.ts");
    expect(command.run).not.toContain("postgres-historical-production-first-cycle-v2.test.ts");
    const profile = workflow.jobs["historical-reconciliation-profile"];
    expect(profile["timeout-minutes"]).toBe(75); expect(profile.services.postgres.image).toBe("postgres:16-alpine");
    const proof = profile.steps.find((s: { run?: string }) => s.run?.includes("assert-historical-reconciliation-profile-results"));
    expect(proof.env).toMatchObject({ WAIA_PG_INTEGRATION: "1", WAIA_TRADER_CLI: "1", WAIA_POSTGRES_CLI: "1",
      WAIA_HISTORICAL_PG_RECONCILIATION_PROFILE: "HISTORICAL_PG_RECONCILIATION_V1", WAIA_HISTORICAL_KNOWLEDGE_CONTINUATION_PROOF: "0" });
    expect(workflow.env.DATABASE_URL_POSTGRES_SESSION).toBe(workflow.env.DATABASE_URL_POSTGRES);
    expect(proof.run).toContain("postgres-historical-production-first-cycle-v2.test.ts");
    expect(proof.run).toContain("--reporter=json"); expect(proof.run).not.toMatch(/--testNamePattern|--exclude/);
    expect(profile.steps.some((s: { run?: string }) => s.run === "pnpm db:postgres:auth-prelude && pnpm db:migrate:postgres")).toBe(true);
    expect(workflow.jobs.integration.steps.some((s: { run?: string }) => s.run?.includes("postgres-historical-production-first-cycle-v2.test.ts"))).toBe(true);
    expect(workflow.jobs.integration.env?.WAIA_HISTORICAL_PG_RECONCILIATION_PROFILE).toBeUndefined();
    for (const path of ["tests/unit/postgres-historical-reconciliation-bootstrap.test.ts", "tests/unit/postgres-historical-reconciliation-profile-proof-guard.test.ts", "tests/integration/postgres-historical-production-reconciliation-frontier-v1.test.ts"]) {
      expect(workflow.on.pull_request.paths).toContain(path);
    }
  });
});
