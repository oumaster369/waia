import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("migration 0225 lock budget (DEE-1151)", () => {
  const sql = readFileSync(
    "db/migrations_postgres/0225_trader_noncapital_domain_ownership_v1.sql",
    "utf8",
  );

  it("fails fast on lock waits and says writers must be stopped", () => {
    expect(sql).toMatch(/writers of the locked tables stopped/i);
    expect(sql).toMatch(/Do not apply it during a live session/i);
    expect(sql).toContain("SET LOCAL");
    const chunks = sql
      .split("--> statement-breakpoint")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
    const reset = chunks[chunks.length - 1] ?? "";
    expect(reset).toContain("set_config('lock_timeout', '0', true)");
    expect(reset).toContain("set_config('statement_timeout', '0', true)");
    const executable = chunks.slice(0, -1).filter((chunk) => !chunk.startsWith("--") || chunk.includes("SELECT") || chunk.includes("LOCK") || chunk.includes("ALTER") || chunk.includes("CREATE"));
    for (const chunk of executable) {
      if (!/^(SELECT|LOCK|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|COMMENT|GRANT|REVOKE|DO)\b/m.test(chunk)) {
        continue;
      }
      expect(chunk).toContain("set_config('lock_timeout', '5s', true)");
      expect(chunk).toContain("set_config('statement_timeout', '120s', true)");
    }
    expect(sql).toContain("LOCK TABLE");
    const lockChunk = executable.find((chunk) => chunk.includes("LOCK TABLE"));
    expect(lockChunk?.indexOf("set_config('lock_timeout', '5s', true)")).toBeLessThan(
      lockChunk?.indexOf("LOCK TABLE") ?? -1,
    );
  });
});
