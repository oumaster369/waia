import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/account-observation-postgres.yml", "utf8");
const historicalWorkflow = readFileSync(".github/workflows/postgres-integration.yml", "utf8");
const suites = [
  "tests/integration/account-observation-migration-postgres.test.ts",
  "tests/integration/trader-account-observation-postgres.test.ts",
  "tests/integration/account-observation-reader-postgres.test.ts",
  "tests/integration/account-observation-credential-postgres.test.ts",
  "tests/integration/account-observation-risk-owner-postgres.test.ts",
];
const resultPath = ".tmp/account-observation-postgres-results.json";
const guardPath = "scripts/postgres-validation/assert-account-observation-test-results.mjs";
const unitCommand = "pnpm test --run tests/unit/account-observation-postgres-ci-contract.test.ts tests/unit/account-observation-test-results-guard.test.ts";
const nativeCommand = [
  "mkdir -p .tmp",
  `rm -f ${resultPath}`,
  `pnpm test --run --no-file-parallelism --reporter=default --reporter=json --outputFile=${resultPath} \\`,
  ...suites.map((suite, index) => `  ${suite}${index < suites.length - 1 ? " \\" : ""}`),
  `node ${guardPath} ${resultPath}`,
].join("\n");
const syntheticUrl = "postgres://waia_local_admin:local_validation_only@127.0.0.1:55460/waia_dee960_local";

// A deliberately narrow static contract for this workflow's block-style YAML,
// matching the existing historical CI-profile test without a transitive parser dependency.
function job(source: string, id: string) {
  const marker = `\n  ${id}:\n`;
  expect(source.split(marker)).toHaveLength(2);
  return source.slice(source.indexOf(marker) + 1).split(/\n(?=  [\w-]+:\n)/)[0]!.trim();
}
function requireEnforcedObservationJob(source: string) {
  const block = job(source, "account-observation-postgres17");
  expect(block).not.toMatch(/^\s*(?:-\s*)?(?:if|continue-on-error|needs):/m);
  expect(block).not.toMatch(/\$\{\{\s*secrets\.|\|\|\s*(?:true|:)|--passWithNoTests|--testNamePattern|--exclude|--shard|--changed/);
  expect(block).toContain('DEE960_LOCAL_PG17: "1"');
  expect(block.match(/DEE960_LOCAL_PG17:/g)).toHaveLength(1);
  const run = block.match(/\n        run: \|\n((?:          .*(?:\n|$))+)/)?.[1];
  expect(run, "mandatory literal native command").toBeDefined();
  expect(run!.split("\n").filter(Boolean).map((line) => line.slice(10)).join("\n").trimEnd())
    .toBe(nativeCommand);
  for (const suite of suites) expect(block.split(suite)).toHaveLength(2);
  expect(block).toContain(`\n        run: ${unitCommand}\n`);
  return block;
}
function hasSafeReaderPortGuard(source: string): boolean {
  return source.includes('const dee1235ReaderFixture = process.env.DEE1235_READER_LOCAL_PG17 === "1";') &&
    source.includes('const requestedPort = dee1235ReaderFixture ? "55738" : process.env.DEE960_LOCAL_PG17_PORT ?? "55460";') &&
    source.includes('process.env.DEE960_LOCAL_PG17_PORT !== "55738"') &&
    source.includes('requestedPort !== "55460" && requestedPort !== "55461"') &&
    source.includes('const localPort = requestedPort === "55461" ? "55461" : requestedPort === "55738" ? "55738" : "55460";') &&
    source.includes('`postgres://waia_local_admin:local_validation_only@127.0.0.1:${localPort}/waia_dee960_local`') &&
    !/process\.env\.(?:DATABASE_URL|POSTGRES_URL)/.test(source);
}
function hasSafeCredentialPortGuard(source: string): boolean {
  return source.includes('const HOST = process.env.DEE1235_CREDENTIAL_FIXTURE === "1" ? "127.0.0.1:55732" : "127.0.0.1:55460";') &&
    source.includes('const url = `postgres://waia_local_admin:local_validation_only@${HOST}/waia_dee960_local`;') &&
    !/process\.env\.(?:DATABASE_URL|POSTGRES_URL)/.test(source);
}
function hasSafeRiskOwnerPortGuard(source: string): boolean {
  const guardedUrl = [
    'const localPortOverride = process.env.DEE1135_LOCAL_PG17_PORT;',
    'if (localPortOverride !== undefined && ((Boolean(process.env.CI) || Boolean(process.env.GITHUB_ACTIONS)) ||',
    '  localPortOverride !== "55740")) throw new Error("DEE1135_LOCAL_PG17_PORT_ISOLATED_LOCAL_ONLY");',
    'const url = `postgres://waia_local_admin:local_validation_only@127.0.0.1:${localPortOverride ?? "55460"}/waia_dee960_local`;',
  ].join("\n");
  return source.includes(guardedUrl) &&
    !/process\.env\.(?:DATABASE_URL|POSTGRES_URL)/.test(source);
}

describe("account observation PostgreSQL CI contract", () => {
  it("retains both pre-existing historical jobs byte-for-byte", () => {
    // Baseline 74a5a6b0: never replace a historical guard with the new account gate.
    // An intentional future change needs an independently reviewed contract update.
    // DEE-1152: the integration job changed only by adding
    // tests/integration/postgres-dee540-blind-tail-max-pool.test.ts to its test list.
    expect(createHash("sha256").update(job(historicalWorkflow, "integration")).digest("hex"))
      .toBe("1c81412ccc89b82effbbe7b8ba3918fca8d4022fc3d3fc77edd43cfa62475509");
    expect(createHash("sha256").update(job(historicalWorkflow, "historical-postgres17")).digest("hex"))
      .toBe("e85758d52b4ee3b7ca1f6993ad31be8a336695bdfb49aa47d63fe55612daa250");
  });

  it("runs all five real suites serially on a separate synthetic PostgreSQL 17 service", () => {
    const block = requireEnforcedObservationJob(workflow);
    for (const expected of ["image: postgres:17-alpine", "- 55460:5432",
      "POSTGRES_USER: waia_local_admin", "POSTGRES_PASSWORD: local_validation_only",
      "POSTGRES_DB: waia_dee960_local", "timeout-minutes: 15", "pnpm install --frozen-lockfile",
      `DATABASE_URL_POSTGRES: ${syntheticUrl}`, `DATABASE_URL_POSTGRES_SESSION: ${syntheticUrl}`])
      expect(block).toContain(expected);
    for (const suite of suites) {
      const source = readFileSync(suite, "utf8");
      expect(source).toContain('process.env.DEE960_LOCAL_PG17 === "1"');
      if (suite === "tests/integration/account-observation-reader-postgres.test.ts") {
        // The reader suite may target the separately provisioned, loopback-only
        // PG17 validation cluster. Other suites never inherit this reader port.
        expect(hasSafeReaderPortGuard(source)).toBe(true);
      } else if (suite === "tests/integration/account-observation-credential-postgres.test.ts") {
        // Separate owned TLS fixture: only this explicit flag can select its
        // fixed loopback port; normal CI remains pinned to the 55460 service.
        expect(hasSafeCredentialPortGuard(source)).toBe(true);
      } else if (suite === "tests/integration/account-observation-risk-owner-postgres.test.ts") {
        // Its reviewed local fixture uses only 55740; any supplied override
        // is refused in CI, which keeps the canonical 55460 service.
        expect(hasSafeRiskOwnerPortGuard(source)).toBe(true);
      } else {
        expect(source).toContain(`const url = "${syntheticUrl}"`);
      }
      expect(source).not.toMatch(/\b(?:describe|it|test)\.(?:skip|todo|only)\s*\(/);
    }
  });

  it("keeps the risk-owner fixture override local-only and closed in either CI environment", () => {
    const source = readFileSync("tests/integration/account-observation-risk-owner-postgres.test.ts", "utf8");
    expect(hasSafeRiskOwnerPortGuard(source)).toBe(true);
    for (const mutation of [
      source.replace('localPortOverride !== undefined', 'localPortOverride === undefined'),
      source.replace('Boolean(process.env.CI)', 'false'),
      source.replace('Boolean(process.env.GITHUB_ACTIONS)', 'false'),
      source.replace('Boolean(process.env.CI)', 'process.env.CI === "true"'),
      source.replace('Boolean(process.env.GITHUB_ACTIONS)', 'process.env.GITHUB_ACTIONS === "true"'),
      source.replace('localPortOverride !== "55740"', 'false'),
      source.replace('localPortOverride !== "55740"', 'localPortOverride !== "5432"'),
      source.replace('throw new Error("DEE1135_LOCAL_PG17_PORT_ISOLATED_LOCAL_ONLY")', 'console.warn("ignored")'),
      source.replace('localPortOverride ?? "55460"', 'localPortOverride ?? "5432"'),
      source.replace('127.0.0.1:${localPortOverride', 'example.com:${localPortOverride'),
      source.replace('/waia_dee960_local`', '/production`'),
      source + '\nconst unsafeUrl = process.env.DATABASE_URL;\n',
      source + '\nconst unsafeUrl = process.env.POSTGRES_URL;\n',
    ]) expect(hasSafeRiskOwnerPortGuard(mutation)).toBe(false);
  });

  it("keeps the credential TLS fixture loopback-only and independent of database environment URLs", () => {
    const source = readFileSync("tests/integration/account-observation-credential-postgres.test.ts", "utf8");
    expect(hasSafeCredentialPortGuard(source)).toBe(true);
    for (const mutation of [
      source.replace('=== "1" ? "127.0.0.1:55732"', '!== "1" ? "127.0.0.1:55732"'),
      source.replace('"127.0.0.1:55732"', '"example.com:55732"'),
      source.replace('"127.0.0.1:55460"', '"127.0.0.1:5432"'),
      source.replace('${HOST}/waia_dee960_local`', '${HOST}/production`'),
      source + '\nconst unsafeUrl = process.env.DATABASE_URL;\n',
    ]) expect(hasSafeCredentialPortGuard(mutation)).toBe(false);
  });

  it("keeps the reader's alternate PG17 port closed and loopback-only", () => {
    const readerPath = "tests/integration/account-observation-reader-postgres.test.ts";
    const reader = readFileSync(readerPath, "utf8");
    expect(hasSafeReaderPortGuard(reader)).toBe(true);
    for (const mutation of [
      reader.replace('DEE1235_READER_LOCAL_PG17 === "1"', 'DEE1235_READER_LOCAL_PG17 !== "1"'),
      reader.replace('dee1235ReaderFixture ? "55738"', 'dee1235ReaderFixture ? "5432"'),
      reader.replace('process.env.DEE960_LOCAL_PG17_PORT !== "55738"', 'process.env.DEE960_LOCAL_PG17_PORT !== "5432"'),
      reader.replace('127.0.0.1:${localPort}/waia_dee960_local', 'example.com:${localPort}/waia_dee960_local'),
      reader.replace('requestedPort !== "55460" && requestedPort !== "55461"', 'requestedPort !== "55460"'),
      reader.replace('requestedPort !== "55460" && requestedPort !== "55461"', 'false'),
      reader.replace('127.0.0.1:${localPort}/waia_dee960_local', 'example.com:${localPort}/waia_dee960_local'),
      reader.replace('waia_dee960_local`', 'production`'),
      reader.replace('const localPort = requestedPort === "55461" ? "55461" : requestedPort === "55738" ? "55738" : "55460";', 'const localPort = requestedPort;'),
    ]) {
      expect(hasSafeReaderPortGuard(mutation)).toBe(false);
    }
  });

  it("rejects disabled, soft-failing or selectively filtered account gates", () => {
    for (const mutation of [
      workflow.replace("  account-observation-postgres17:\n", "  account-observation-postgres17:\n    if: false\n"),
      workflow.replace("  account-observation-postgres17:\n", "  account-observation-postgres17:\n    continue-on-error: true\n"),
      workflow.replace('DEE960_LOCAL_PG17: "1"', 'DEE960_LOCAL_PG17: "0"'),
      workflow.replace(suites[1]!, "--passWithNoTests"),
      workflow.replace(suites[2]!, `${suites[2]} || true`),
      workflow.replace(`node ${guardPath} ${resultPath}`, ""),
      workflow.replace(`node ${guardPath}`, `# node ${guardPath}`),
      workflow.replace(`node ${guardPath}`, `! node ${guardPath}`),
      workflow.replace(`node ${guardPath} ${resultPath}`, `node ${guardPath} ${resultPath} || true`),
      workflow.replace(`node ${guardPath} ${resultPath}`, `node ${guardPath} .tmp/old-results.json`),
      workflow.replace(`--outputFile=${resultPath}`, "--outputFile=.tmp/other-results.json"),
      workflow.replace("--reporter=json", "--reporter=default"),
      workflow.replace(`rm -f ${resultPath}`, "# stale result retained"),
      workflow.replace("--no-file-parallelism", "--fileParallelism"),
      workflow.replace(unitCommand, unitCommand.replace("tests/unit/account-observation-test-results-guard.test.ts", "tests/unit/other.test.ts")),
    ]) expect(() => requireEnforcedObservationJob(mutation)).toThrow();
  });

  it("triggers on module, interfaces, schema, test helpers and dependency/config changes", () => {
    const paths = workflow.split("\njobs:")[0]!;
    expect(paths).toContain("  workflow_dispatch:");
    expect(paths).toContain("  pull_request:\n    paths:");
    expect(historicalWorkflow).not.toContain("account-observation");
    expect(workflow).not.toMatch(/^  (?:integration|historical-postgres17):/m);
    for (const path of ["db/migrations_postgres/**", "db/schema.postgres.ts",
      "db/local-validation/dee960-account-observation.sql", "lib/trader/account-observation/**",
      "lib/trader/account-observation/host-role-probe.ts", "scripts/postgres-validation/**",
      "scripts/postgres-validation/assert-account-observation-test-results.mjs",
      "tests/unit/account-observation-credential-startup.test.ts",
      "tests/unit/account-observation-test-results-guard.test.ts",
      "tests/unit/account-observation-postgres-ci-contract.test.ts",
      // DEE-1015: the provisioning proofs in this gate exercise these executable surfaces.
      "scripts/trader/account-observation-collector-host.ts",
      "scripts/ops/account-observation-provision-collection-state-v1.ts",
      "scripts/ops/provision-account-observation-logins.mjs",
      "lib/trader/risk/v2/**",
      "lib/trader/risk/numeric.ts",
      "lib/trader/reality/v2/**",
      "lib/trader/mi/**",
      "lib/trader/paper/serialize-paper-evaluation-export.ts",
      "lib/waia-core/**",
      "db/waia-postgres-transaction.ts",
      "tests/unit/trader-htx-account-acquisition-v1.test.ts",
      "tests/unit/trader-risk-account-source-profile-v1.test.ts",
      "tests/unit/trader-risk-account-reconciliation-v1.test.ts",
      "lib/trader/credentials/**", "lib/trader/security/**",
      "services/ai-trader-account-observation-host/**",
      "components/trader/account-observation/**", "app/api/trader/account-observation/**",
      "app/api/trader/admin/account-observation/**", "app/(trader)/admin/account-observation/**",
      "app/(trader)/trader/**", "tests/helpers/**", "tests/integration/*account-observation*.test.ts",
      "tests/unit/*account-observation*.test.ts", "tests/unit/*account-observation*.test.tsx",
      "tests/e2e/account-observation.spec.ts", "package.json", "pnpm-lock.yaml", "vitest.config.*", "vitest.setup.ts",
      ".github/workflows/account-observation-postgres.yml", ".github/workflows/postgres-integration.yml"])
      expect(paths).toContain(`- "${path}"`);
  });
});
