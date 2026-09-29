import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
  });
});
