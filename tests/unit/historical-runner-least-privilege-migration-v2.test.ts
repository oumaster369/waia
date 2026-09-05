import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION_TAG = "0199_historical_runner_least_privilege_v2";
const sql = readFileSync(join(ROOT, "db/migrations_postgres", `${MIGRATION_TAG}.sql`), "utf8");
const executable = sql.replace(/^--.*$/gm, "");

const modeledWriteTables = [
  "trader_historical_simulation_run_lifecycle_event_v2",
  "trader_historical_simulation_run_start_v2",
  "trader_historical_simulation_policy_config_v2",
  "trader_historical_simulation_reason_ledger_v2",
  "trader_historical_simulation_modeled_evidence_v2",
  "trader_historical_simulation_atomic_stage_v2",
  "trader_historical_simulation_durable_snapshot_v2",
  "trader_historical_simulation_resume_checkpoint_v2",
  "trader_forecast_pit_bar_v2",
  "trader_forecast_outcome_v2",
  "trader_forecast_calibration_observation_v2",
  "trader_knowledge_confidence_update_record",
  "trader_knowledge_state_checkpoint_v2",
  "trader_orders",
  "trader_order_events",
  "trader_fills",
  "trader_fill_execution_economics",
  "trader_accounting_frontier",
] as const;

describe("Historical V2 runner least-privilege migration", () => {
  it("is journaled as the only canonical 0199 migration", () => {
    const journal = JSON.parse(readFileSync(join(ROOT,
      "db/migrations_postgres/meta/_journal.json"), "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(journal.entries).toContainEqual({ idx: 199, version: "7", when: 1780000000199,
      tag: MIGRATION_TAG, breakpoints: true });
  });

  it("covers lifecycle and modeled execution/accounting with organization-bound policies", () => {
    for (const table of modeledWriteTables) expect(sql).toContain(`'${table}'`);
    expect(sql).toContain("'organization_members'");
    expect(sql).toContain("authorized_organization constant uuid := " +
      "'3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid");
    expect(sql).toContain("FOR SELECT TO waia_historical_runner");
    expect(sql).toContain("FOR INSERT TO waia_historical_runner");
    expect(sql).toContain("FOR UPDATE TO waia_historical_runner");
    expect(sql).toContain("WITH CHECK (organization_id = %L::uuid)");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("does not grant destructive, role-escalation, credential, or live-capital authority", () => {
    expect(executable).not.toMatch(/GRANT\s+(?:DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)\b/i);
    expect(executable).not.toMatch(/ALTER\s+ROLE[^;]*(?:\sSUPERUSER|\sBYPASSRLS)|service_role/i);
    expect(executable).not.toMatch(/trader_exchange_credentials|trader_org_live_enable/);
    expect(executable).not.toMatch(/trader_(?:risk|execution|reality)_(?:verdict|allowance|plan|attempt|report|truth)/);
    expect(sql).toContain("runner.rolcanlogin OR runner.rolinherit OR runner.rolsuper");
    expect(sql).toContain("pg_auth_members");
  });

  it("normalizes and verifies the runner group as an exact non-login non-inheriting role", () => {
    expect(sql).toMatch(
      /ALTER ROLE waia_historical_runner\s+NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS\s+CONNECTION LIMIT -1;/,
    );
    for (const flag of ["rolcanlogin", "rolinherit", "rolsuper", "rolcreatedb", "rolcreaterole",
      "rolreplication", "rolbypassrls"]) expect(sql).toContain(flag);
  });

  it("allows UPDATE only for the mutable modeled order state machine", () => {
    expect(sql).toContain("update_relations constant text[] := ARRAY['trader_orders']");
    expect(sql).toContain("GRANT UPDATE ON TABLE public.%I TO waia_historical_runner");
  });

  it("keeps full sealed datasets outside the pre-holdout runner policies", () => {
    expect(sql.match(/dataset_authority_class = ''PRE_HOLDOUT_QUALIFICATION_V1''/g))
      .toHaveLength(2);
    expect(sql).toContain("The authority table can also contain FULL_SEALED_DATASET_V2 rows");
  });
});
