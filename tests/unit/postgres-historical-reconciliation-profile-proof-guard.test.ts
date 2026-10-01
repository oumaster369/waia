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
const capitalFiles = [
  "postgres-execution-v2.test.ts",
  "postgres-execution-reality-delivery.test.ts",
  "postgres-risk-v2.test.ts",
  "postgres-risk-validation-org-fk-v1.test.ts",
  "postgres-risk-limits-bootstrap.test.ts",
  "postgres-trader-service-actor-authorization.test.ts",
  "postgres-reality-v2.test.ts",
  "postgres-canonical-decision-verification-v2.test.ts",
  "postgres-promotion-audit-atomicity.test.ts",
  "postgres-runtime-authority-v2.test.ts",
  "postgres-guardian-authority-v2.test.ts",
  "postgres-guardian-observation-scope.test.ts",
  "postgres-forecast-v2-feedback-read-port.test.ts",
  "postgres-forecast-v2-persistence.test.ts",
  "postgres-billing-period-command-atomicity.test.ts",
  "postgres-billing-invoice-command-atomicity.test.ts",
  "postgres-billing-reality-dependencies.test.ts",
  "postgres-reporting-period-basis.test.ts",
  "postgres-noncapital-cycle-owner-v2.test.ts",
  "postgres-org-live-enable-atomicity.test.ts",
  "postgres-recorded-paper-analysis-v1.test.ts",
  "postgres-mi-canonical-pit-lineage-v1.test.ts",
  "postgres-research-understanding-v1.test.ts",
  "postgres-knowledge-snapshot-eligibility.test.ts",
  "postgres-historical-production-reconciliation-frontier-v1.test.ts",
  "postgres-research-application-v1.test.ts",
  "postgres-runtime-domain-ownership-v1.test.ts",
  "postgres-live-capital-envelope-v2.test.ts",
  "postgres-ordinary-paper-order-domain.test.ts",
];
const capitalPassed = () => capitalFiles.map(name => ({ name: `/workspace/tests/integration/${name}`, status: "passed",
  assertionResults: [{ title: "synthetic guard control, not native proof", status: "passed" }] }));
function runCapital(testResults = capitalPassed()) {
  writeFileSync(file, JSON.stringify({ testResults }));
  return spawnSync(process.execPath, ["scripts/postgres-validation/assert-capital-test-results.mjs", file], { encoding: "utf8" });
}
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
  it("wires the exact capital29 union and independent75-minute PROFILE35 job without changing generic LEGACY", () => {
    const workflow = parse(readFileSync(".github/workflows/postgres-integration.yml", "utf8"));
    const capital = workflow.jobs["capital-authority"];
    expect(capital["timeout-minutes"]).toBe(30);
    const bootstrap = capital.steps.find((s: { run?: string }) => s.run?.includes("prepare-historical-reconciliation-fixture.ts"));
    expect(bootstrap.env.WAIA_POSTGRES_CLI).toBe("1");
    expect(capital.steps.filter((s: { run?: string }) => s.run?.includes("db:postgres:auth-prelude"))).toHaveLength(0);
    const command = capital.steps.find((s: { run?: string }) => s.run?.includes("assert-capital-test-results"));
    const selected = (command.run.match(/tests\/integration\/[^\s]+\.test\.ts/g) as string[])
      .map(path => path.replace("tests/integration/", ""));
    expect(selected).toEqual(capitalFiles);
    expect(new Set(selected).size).toBe(29);
    const guard = readFileSync("scripts/postgres-validation/assert-capital-test-results.mjs", "utf8");
    const requiredArray = guard.match(/const requiredFiles = \[([\s\S]*?)\];/)?.[1];
    expect(requiredArray).toBeDefined();
    expect([...requiredArray!.matchAll(/"([^"\n]+\.test\.ts)"/g)].map(match => match[1])).toEqual(capitalFiles);
    expect(command.run).not.toMatch(/--testNamePattern|--exclude/);
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
  it("accepts the exact synthetic29-file guard control", () => {
    const result = runCapital();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("29 critical suites, no skipped tests");
  });
  it.each(capitalFiles)("refuses a report omitting mandatory %s", missing => {
    const result = runCapital(capitalPassed().filter(row => !row.name.endsWith(`/${missing}`)));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Required PostgreSQL proof missing, failed or skipped: ${missing}`);
  });
  it.each(["failed", "pending", "duplicate"])("refuses a %s application proof without weakening the old24", mode => {
    const report = capitalPassed(), application = report.find((row) => row.name.endsWith("/postgres-research-application-v1.test.ts"))!;
    if (mode === "duplicate") report.push(application);
    else application.assertionResults[0].status = mode;
    const result = runCapital(report);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Required PostgreSQL proof missing, failed or skipped: postgres-research-application-v1.test.ts");
  });

});
