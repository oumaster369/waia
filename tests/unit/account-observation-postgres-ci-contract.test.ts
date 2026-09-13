import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/account-observation-postgres.yml", "utf8");
const historicalWorkflow = readFileSync(".github/workflows/postgres-integration.yml", "utf8");
const suites = [
  "tests/integration/account-observation-migration-postgres.test.ts",
  "tests/integration/trader-account-observation-postgres.test.ts",
  "tests/integration/account-observation-reader-postgres.test.ts",
];
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
  expect(block).toContain("pnpm test --run --no-file-parallelism\n");
  for (const suite of suites) expect(block.split(suite)).toHaveLength(2);
  expect(block).toContain("pnpm test --run tests/unit/account-observation-postgres-ci-contract.test.ts");
  return block;
}

describe("account observation PostgreSQL CI contract", () => {
  it("retains both pre-existing historical jobs byte-for-byte", () => {
    // Baseline 74a5a6b0: never replace a historical guard with the new account gate.
    // An intentional future change needs an independently reviewed contract update.
    expect(createHash("sha256").update(job(historicalWorkflow, "integration")).digest("hex"))
      .toBe("d5e03e6c302c10582730bf408d12208b17a5afe335976cb8aaa2a071d90c68e1");
    expect(createHash("sha256").update(job(historicalWorkflow, "historical-postgres17")).digest("hex"))
      .toBe("e85758d52b4ee3b7ca1f6993ad31be8a336695bdfb49aa47d63fe55612daa250");
  });

  it("runs all three real suites serially on a separate synthetic PostgreSQL 17 service", () => {
    const block = requireEnforcedObservationJob(workflow);
    for (const expected of ["image: postgres:17-alpine", "- 55460:5432",
      "POSTGRES_USER: waia_local_admin", "POSTGRES_PASSWORD: local_validation_only",
      "POSTGRES_DB: waia_dee960_local", "timeout-minutes: 15", "pnpm install --frozen-lockfile",
      `DATABASE_URL_POSTGRES: ${syntheticUrl}`, `DATABASE_URL_POSTGRES_SESSION: ${syntheticUrl}`])
      expect(block).toContain(expected);
    for (const suite of suites) {
      const source = readFileSync(suite, "utf8");
      expect(source).toContain('process.env.DEE960_LOCAL_PG17 === "1"');
      expect(source).toContain(`const url = "${syntheticUrl}"`);
      expect(source).not.toMatch(/\b(?:describe|it|test)\.(?:skip|todo|only)\s*\(/);
    }
  });

  it("rejects disabled, soft-failing or selectively filtered account gates", () => {
    for (const mutation of [
      workflow.replace("  account-observation-postgres17:\n", "  account-observation-postgres17:\n    if: false\n"),
      workflow.replace("  account-observation-postgres17:\n", "  account-observation-postgres17:\n    continue-on-error: true\n"),
      workflow.replace('DEE960_LOCAL_PG17: "1"', 'DEE960_LOCAL_PG17: "0"'),
      workflow.replace(suites[1]!, "--passWithNoTests"),
      workflow.replace(suites[2]!, `${suites[2]} || true`),
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
      "components/trader/account-observation/**", "app/api/trader/account-observation/**",
      "app/api/trader/admin/account-observation/**", "app/(trader)/admin/account-observation/**",
      "app/(trader)/trader/**", "tests/helpers/**", "tests/integration/*account-observation*.test.ts",
      "tests/unit/*account-observation*.test.ts", "tests/unit/*account-observation*.test.tsx",
      "tests/e2e/account-observation.spec.ts", "package.json", "pnpm-lock.yaml", "vitest.config.*", "vitest.setup.ts",
      ".github/workflows/account-observation-postgres.yml", ".github/workflows/postgres-integration.yml"])
      expect(paths).toContain(`- "${path}"`);
  });
});
