import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DEE-1032 deferred spot inventory migration", () => {
  const sql = readFileSync(
    "db/migrations_postgres/0230_trader_account_observation_spot_inventory_v1.sql",
    "utf8",
  );
  const previous = readFileSync(
    "db/migrations_postgres/0229_trader_observation_read_only_credential_v1.sql",
    "utf8",
  );
  const journal = JSON.parse(
    readFileSync("db/migrations_postgres/meta/_journal.json", "utf8"),
  ) as { entries: { idx: number; tag: string; when: number }[] };

  it("stays a repo-only journal tail and does not rewrite 0229", () => {
    expect(journal.entries).toHaveLength(231);
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 230,
      tag: "0230_trader_account_observation_spot_inventory_v1",
      when: 1780000000230,
    });
    expect(journal.entries.at(-2)?.tag).toBe("0229_trader_observation_read_only_credential_v1");
    expect(previous).toContain("This new migration is unmerged/unapplied to production");
    expect(sql).toContain("Do not apply this migration to production");
    expect(sql).not.toContain("0229_trader_observation_read_only_credential_v1");
  });

  it("exposes execute-only identifier inventory and refuses overflow", () => {
    expect(sql).toContain("trader_account_observation_spot_inventory");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("ACCOUNT_OBSERVATION_INVENTORY_OVERFLOW");
    expect(sql).toContain("ACCOUNT_OBSERVATION_INVENTORY_REFUSED");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.trader_account_observation_spot_inventory(text, jsonb) TO waia_account_observation_inventory",
    );
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.trader_account_observation_spot_inventory(text, jsonb) FROM PUBLIC");
    expect(sql).not.toMatch(/GRANT\s+INSERT/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\s*\([^)]*encrypted_payload/i);
    expect(sql).toContain("venue = 'htx' AND status = 'active'");
  });
});
