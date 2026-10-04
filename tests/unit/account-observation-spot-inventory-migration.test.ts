import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DEE-1032 deferred spot inventory migration", () => {
  const sql = readFileSync(
    "db/migrations_postgres/0231_trader_account_observation_spot_inventory_v1.sql",
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
    expect(journal.entries).toHaveLength(232);
    expect(journal.entries[230]).toMatchObject({
      idx: 230,
      tag: "0230_trader_observation_consent_revision_grants_v1",
      when: 1780000000230,
    });
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 231,
      tag: "0231_trader_account_observation_spot_inventory_v1",
      when: 1780000000231,
    });
    expect(journal.entries[229]?.tag).toBe("0229_trader_observation_read_only_credential_v1");
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

  it("requires explicit migration authority and restores only the temporary grantor edge", () => {
    const preflight = sql.indexOf("ACCOUNT_OBSERVATION_INVENTORY_OWNER_ADMIN_REQUIRED");
    const firstSchemaGrant = sql.indexOf("GRANT USAGE, CREATE ON SCHEMA public");
    expect(preflight).toBeGreaterThan(-1);
    expect(firstSchemaGrant).toBeGreaterThan(preflight);
    expect(sql).toContain("pg_has_role(current_user, 'waia_account_observation_inventory_owner', 'SET')");
    expect(sql).toContain("membership.admin_option");
    expect(sql).toContain("migration_actor.rolsuper");
    expect(sql).toContain("ACCOUNT_OBSERVATION_INVENTORY_LOGIN_MEMBERSHIP_UNSAFE");
    expect(sql).not.toContain("'MEMBER'");
    expect(sql).toContain("grantor_role.rolname = migration_role");
    expect(sql).toContain("had_same_grantor_membership");
    expect(sql).toContain("previous_admin_option");
    expect(sql).toContain("previous_inherit_option");
    expect(sql).toContain("previous_set_option");
    expect(sql).toContain("IF added_temporary_membership THEN");
    expect(sql).toContain("REVOKE %I FROM %I");
    expect(sql).toContain("SET TRUE GRANTED BY %I");
    expect(sql).toContain("FROM %I GRANTED BY %I");
    expect(sql).toContain("ACCOUNT_OBSERVATION_INVENTORY_OWNER_SELF_ADMIN_EDGE_UNSAFE");
  });

  it("correlates every state identifier to the state row in the owner policy", () => {
    const policy = sql.slice(sql.indexOf("CREATE POLICY trader_observation_inventory_owner_state"),
      sql.indexOf("GRANT USAGE ON SCHEMA public TO waia_account_observation_inventory"));
    expect(policy).toContain("trader_account_collection_state.organization_id = credential.organization_id");
    expect(policy).toContain("trader_account_collection_state.credential_id = credential.id");
    expect(policy).toContain("trader_account_collection_state.exchange_account_id = credential.exchange_account_id");
  });
});
