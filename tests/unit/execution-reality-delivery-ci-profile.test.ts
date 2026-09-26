import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getResolvedWaiaDbRuntimeConfig } from "@/db/runtime-backend";
import { parseExecutionRealityDeliveryArgs } from "@/lib/trader/reality/v2/execution-report-delivery-cli";

afterEach(() => vi.unstubAllEnvs());
describe("DEE1122 actual CI delivery profile (no DB connection)", () => {
  it("keeps the executable child and native suite admitted under the exact CI flags and endpoint", () => {
    const workflow = readFileSync(".github/workflows/postgres-integration.yml", "utf8");
    const capital = workflow.split("  capital-authority:")[1]!.split("\n  integration:")[0]!;
    const step = capital.split("      - name: Required actual-Postgres capital authority regressions")[1]!;
    const endpoint = workflow.match(/^  DATABASE_URL_POSTGRES: (\S+)$/m)![1]!;
    const flags = ["WAIA_PG_INTEGRATION", "WAIA_TRADER_CLI", "WAIA_POSTGRES_CLI"];
    for (const name of flags) {
      const value = step.match(new RegExp(`^\\s+${name}: "([^"]+)"$`, "m"))?.[1];
      expect(value, name).toBe("1"); vi.stubEnv(name, value);
    }
    const parsed = new URL(endpoint);
    expect([parsed.hostname, parsed.port, parsed.pathname, parsed.username])
      .toEqual(["127.0.0.1", "5432", "/waia_it", "waia_it"]);
    // The actual native child sets this backend explicitly. The real config
    // parser is exercised; no alternative validation profile or DB is created.
    const native = readFileSync("tests/integration/postgres-execution-reality-delivery.test.ts", "utf8");
    expect(native).toContain('WAIA_DB_BACKEND: "postgres"');
    vi.stubEnv("WAIA_DB_BACKEND", "postgres"); vi.stubEnv("DATABASE_URL_POSTGRES", endpoint);
    expect(getResolvedWaiaDbRuntimeConfig().backend).toBe("postgres");
    expect(parseExecutionRealityDeliveryArgs(["--organization-id", "00000000-0000-4000-8000-000000112201",
      "--account-id", "synthetic-fixture", "--execution-attempt-id", "00000000-0000-4000-8000-000000112202"]))
      .toMatchObject({ accountId: "synthetic-fixture" });
    expect(step).toContain("tests/integration/postgres-execution-reality-delivery.test.ts");
    expect(step).toContain("--no-file-parallelism");
    const cli = JSON.parse(readFileSync("package.json", "utf8")).scripts["trader:reality:catch-up-execution"];
    expect(cli).toContain("WAIA_TRADER_CLI=1");
    expect(cli).toContain("--require ./scripts/trader/trader-cli-server-only-prelude.cjs");
    expect(cli).toContain("--conditions=react-server scripts/trader/reality-execution-report-catch-up.ts");
    expect(step).toContain("node scripts/postgres-validation/assert-capital-test-results.mjs");
    for (const path of ["tests/integration/postgres-execution-reality-delivery.test.ts",
      "tests/helpers/execution-reality-delivery-fixture.ts", "tests/unit/execution-reality-delivery-*.test.ts",
      "scripts/trader/reality-execution-report-catch-up.ts", "package.json"])
      expect(workflow.split("\nenv:")[0]).toContain(`- "${path}"`);
  });
});
