import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DEE-637 PostgreSQL runtime-authority RLS", () => {
  const sql = readFileSync("db/migrations_postgres/0182_dee637_runtime_authority_v2.sql", "utf8");
  const tables = [
    ["trader_runtime_authority_assessments_v2", "runtime_authority_assessments_v2_browser"],
    ["trader_runtime_control_lease_heads_v2", "runtime_lease_heads_v2_browser"],
    ["trader_runtime_control_lease_epoch_history_v2", "runtime_lease_history_v2_browser"],
  ];

  it("keeps the owning service role usable while denying browser roles", () => {
    expect(sql).not.toContain("FORCE ROW LEVEL SECURITY");

    for (const [table, policy] of tables) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`"${policy}_select_deny" ON "${table}" FOR SELECT TO authenticated, anon USING (false)`);
      expect(sql).toContain(`"${policy}_insert_deny" ON "${table}" FOR INSERT TO authenticated, anon WITH CHECK (false)`);
      expect(sql).toContain(`"${policy}_update_deny" ON "${table}" FOR UPDATE TO authenticated, anon USING (false)`);
      expect(sql).toContain(`"${policy}_delete_deny" ON "${table}" FOR DELETE TO authenticated, anon USING (false)`);
    }
  });
});
