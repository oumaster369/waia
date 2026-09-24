import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "db/migrations_postgres/0216_trader_admin_change_log_triggers.sql"),
  "utf8",
);

describe("admin console change-log migration 0216", () => {
  it("uses one static function per table and never reads ciphertext", () => {
    const tables = [
      ...sql.matchAll(/CREATE TRIGGER trader_admin_change_log_trg[\s\S]*?ON public\.([a-z0-9_]+)/g),
    ].map((match) => match[1]);
    expect(new Set(tables).size).toBe(25);
    expect(tables).toContain("trader_orders");
    expect(tables).toContain("exchange_credentials");
    const bodies = sql.split("CREATE OR REPLACE FUNCTION public.").slice(1);
    expect(bodies).toHaveLength(25);
    for (const body of bodies) {
      const source = body.split("$$;")[0] ?? "";
      expect(source).not.toMatch(/\bEXECUTE\b/);
      expect(source).not.toMatch(/format\s*\(/);
      expect(source).toContain("SECURITY DEFINER");
      expect(source).toContain("SET search_path = public, pg_temp");
    }
    expect(sql).toContain("REVOKE ALL ON FUNCTION");
    expect(sql.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(25);
    expect(sql).not.toMatch(/encrypted_payload|wrapped_dek|api_key/);
    expect(sql).toContain("OLD.historical_run_id IS NOT NULL");
    expect(sql).toContain("NEW.historical_run_id IS NOT NULL");
  });
});
