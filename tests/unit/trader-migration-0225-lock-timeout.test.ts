import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assertPostgresMigrateSessionLockBudget } from "../../scripts/ops/postgres-migrate-with-session-lock-budget";

const MIGRATION = "db/migrations_postgres/0225_trader_noncapital_domain_ownership_v1.sql";
const MAIN_0225_SHA256 = "3ea3246779f356ff7eceaf27ae3307f10beb6940435c92ae8fcc4ed6487931a3";

describe("migration 0225 stays on the applied main hash (DEE-1151)", () => {
  it("matches main byte-for-byte and keeps the lock budget on the migrate wrapper", () => {
    const checkout = readFileSync(MIGRATION);
    const mainBytes = execFileSync("git", ["show", `origin/main:${MIGRATION}`]);
    const checkoutHash = createHash("sha256").update(checkout).digest("hex");
    expect(checkoutHash).toBe(createHash("sha256").update(mainBytes).digest("hex"));
    expect(checkoutHash).toBe(MAIN_0225_SHA256);
    expect(checkout.toString("utf8")).not.toContain("set_config");

    const wrapper = readFileSync(
      "scripts/ops/postgres-migrate-with-session-lock-budget.ts",
      "utf8",
    );
    expect(wrapper).toMatch(/writers of the locked tables stopped/);
    expect(wrapper).toContain("SET lock_timeout");
    expect(wrapper).toContain("SET statement_timeout");
    expect(wrapper).toContain("migrate(");
    expect(wrapper).not.toMatch(
      /lock_timeout'\s*,\s*'0'|lock_timeout\s*=\s*'0'|statement_timeout\s*=\s*'0'/,
    );
    expect(readFileSync("package.json", "utf8")).toContain(
      "tsx scripts/ops/postgres-migrate-with-session-lock-budget.ts",
    );
    expect(wrapper).toContain("assertPostgresMigrateSessionLockBudget");
    expect(wrapper).toContain("migratePostgresConnectionWithSessionLockBudget");
  });

  it("refuses to migrate when the session budget is missing or zero", () => {
    expect(() => assertPostgresMigrateSessionLockBudget(undefined)).toThrow(
      /session lock budget was not applied before migrate/,
    );
    expect(() =>
      assertPostgresMigrateSessionLockBudget({
        lock_timeout_ms: "0",
        statement_timeout_ms: "120000",
      }),
    ).toThrow(/lock_timeout=0ms/);
    expect(() =>
      assertPostgresMigrateSessionLockBudget({
        lock_timeout_ms: "5000",
        statement_timeout_ms: "0",
      }),
    ).toThrow(/statement_timeout=0ms/);
    expect(() =>
      assertPostgresMigrateSessionLockBudget({
        lock_timeout_ms: "5000",
        statement_timeout_ms: "120000",
      }),
    ).not.toThrow();
  });

  it("allows drizzle postgres migrate only through the session-budget wrapper outside tests", () => {
    const needle = "drizzle-orm/postgres-js/migrator";
    const allowed = new Set(["scripts/ops/postgres-migrate-with-session-lock-budget.ts"]);
    const roots = ["app", "lib", "services", "scripts", "drizzle"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!name.endsWith(".ts") && !name.endsWith(".mjs") && !name.endsWith(".js")) continue;
        if (allowed.has(path)) continue;
        if (readFileSync(path, "utf8").includes(needle)) offenders.push(path);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});
