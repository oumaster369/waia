/**
 * DEE-1020: the class invariants that make the canonical authority projection safe.
 *
 * The database-backed proof lives in
 * `tests/integration/postgres-migration-catalog-authority-supabase-like-v1.test.ts`. This suite
 * pins the pure decisions the projection rests on, so a future edit cannot quietly move a read/write
 * class out of the digest, admit a platform principal into the WAIA contract set, or relax the
 * creator-membership rule.
 */
import { describe, expect, it } from "vitest";

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  BROWSER_HARDENED_RELATIONS,
  PLATFORM_BASELINE_TABLE_PRIVILEGES,
  PLATFORM_MANAGED_PRINCIPALS,
  WAIA_DATA_AUTHORITY_PRIVILEGES,
  WAIA_SCHEMA_USAGE_PRINCIPALS,
  assertRoutineExecuteBounded,
  partitionCreatorMemberships,
  sortCatalogRows,
  type MembershipRow,
} from "@/scripts/ops/postgres-migration-catalog-authority-v1";

function refuse(code: string, detail: string): never {
  throw new Error(`REFUSED:${code}:${detail}`);
}

function membership(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return Object.freeze({
    member_name: "waia_historical_runner_login",
    granted_role: "waia_historical_runner",
    grantor_name: "CURRENT_USER",
    admin_option: false,
    inherit_option: false,
    set_option: true,
    member_is_current_user: false,
    ...overrides,
  });
}

describe("DEE-1020 canonical authority classes", () => {
  it("keeps every read and write privilege class inside the digested set", () => {
    // These four are what read a secret column or mutate a row. If one of them ever moved into the
    // platform baseline it would leave the frozen digest for every principal at once.
    expect([...WAIA_DATA_AUTHORITY_PRIVILEGES].sort()).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    for (const privilege of WAIA_DATA_AUTHORITY_PRIVILEGES) {
      expect(PLATFORM_BASELINE_TABLE_PRIVILEGES).not.toContain(privilege);
    }
  });

  it("restricts the non-digested baseline to structural classes only", () => {
    expect([...PLATFORM_BASELINE_TABLE_PRIVILEGES].sort()).toEqual([
      "MAINTAIN",
      "REFERENCES",
      "TRIGGER",
      "TRUNCATE",
    ]);
    expect(PLATFORM_BASELINE_TABLE_PRIVILEGES).not.toContain("EXECUTE");
    expect(PLATFORM_BASELINE_TABLE_PRIVILEGES).not.toContain("CREATE");
  });

  it("never treats a WAIA contract principal as platform managed", () => {
    expect([...PLATFORM_MANAGED_PRINCIPALS].sort()).toEqual([
      "anon",
      "authenticated",
      "service_role",
    ]);
    for (const principal of PLATFORM_MANAGED_PRINCIPALS) {
      expect(WAIA_SCHEMA_USAGE_PRINCIPALS).not.toContain(principal);
      expect(principal.startsWith("waia_")).toBe(false);
    }
    for (const principal of WAIA_SCHEMA_USAGE_PRINCIPALS) {
      expect(principal.startsWith("waia_")).toBe(true);
    }
    expect(PLATFORM_MANAGED_PRINCIPALS).not.toContain("PUBLIC");
  });

  it("retains every membership that is not the migration authority's own creation grant", () => {
    const rows = [membership(), membership({ member_name: "waia_other_login", set_option: false })];
    const retained = partitionCreatorMemberships(rows, refuse);
    expect(retained).toHaveLength(2);
    // The retained shape is exactly the pre-DEE-1020 digest shape: no field was dropped.
    expect(Object.keys(retained[0]!).sort()).toEqual([
      "admin_option",
      "granted_role",
      "grantor_name",
      "inherit_option",
      "member_name",
      "set_option",
    ]);
  });

  it("drops only a management-only authority grant and refuses a usable one", () => {
    const creation = membership({
      member_name: "postgres",
      grantor_name: "supabase_admin",
      admin_option: true,
      inherit_option: false,
      set_option: false,
      member_is_current_user: true,
    });
    expect(partitionCreatorMemberships([creation], refuse)).toHaveLength(0);
    for (const usable of [{ inherit_option: true }, { set_option: true }] as const) {
      expect(() => partitionCreatorMemberships([{ ...creation, ...usable }], refuse)).toThrow(
        "CATALOG_AUTHORITY_CREATOR_MEMBERSHIP",
      );
    }
  });

  it("orders identical FOREIGN KEY definitions by C/bytewise punctuation, not ICU", () => {
    const simple = {
      schema_name: "public",
      relation_name: "trader_account_collection_state",
      constraint_type: "f",
      definition: "FOREIGN KEY (organization_id) REFERENCES organizations(id)",
    };
    const composite = {
      schema_name: "public",
      relation_name: "trader_account_collection_state",
      constraint_type: "f",
      definition:
        "FOREIGN KEY (organization_id, credential_id, exchange_account_id, last_observation_id) REFERENCES trader_account_observations(organization_id, credential_id, exchange_account_id, observation_id)",
    };
    // ICU en-US sorts ',' before ')'; C/libc/JS sort ')' before ','. Production minted 15721405
    // from the ICU order of these two identical definitions.
    expect(simple.definition < composite.definition).toBe(true);
    expect(
      sortCatalogRows(
        [composite, simple],
        ["schema_name", "relation_name", "constraint_type", "definition"],
      ).map((row) => row.definition),
    ).toEqual([simple.definition, composite.definition]);
  });

  it("derives the browser-hardened relation set from the ratified migration SQL", () => {
    // The constant is only sound while it matches what the migrations actually revoke. Reading the
    // ratified SQL here means adding a step that hardens a relation, or removing a REVOKE, fails this
    // test instead of silently leaving a structural re-grant admissible.
    const steps = ["0205", "0206", "0207", "0208", "0209", "0210"] as const;
    const directory = resolve(process.cwd(), "db/migrations_postgres");
    const hardened = new Set<string>();
    const available = readdirSync(directory);
    for (const step of steps) {
      const file = available.find((name) => name.startsWith(`${step}_`) && name.endsWith(".sql"));
      if (!file) throw new Error(`missing migration for step ${step}`);
      const sql = readFileSync(resolve(directory, file), "utf8");
      // Accepts every table-REVOKE spelling PostgreSQL allows, not just the one the current
      // migrations happen to use, so a future `REVOKE ALL PRIVILEGES ON TABLE ...` or a revocation of
      // named privileges cannot leave the parser and the constant jointly blind to a new hardening.
      const statement =
        /REVOKE\s+(?:GRANT\s+OPTION\s+FOR\s+)?([A-Z, ()\w]*?)\s+ON\s+(?:TABLE\s+)?([^;]*?)\s+FROM\s+([^;]+);/gi;
      for (const match of sql.matchAll(statement)) {
        const [, privileges, objects, grantees] = match;
        if (!privileges || !objects || !grantees) continue;
        if (/\b(?:FUNCTION|PROCEDURE|ROUTINE|SCHEMA|SEQUENCE|DATABASE|TYPE)\b/i.test(objects)) {
          continue;
        }
        const principals = grantees.split(",").map((name) => name.trim().toLowerCase());
        if (!["public", "anon", "authenticated"].every((name) => principals.includes(name))) {
          continue;
        }
        for (const object of objects.split(",")) {
          const name = object
            .trim()
            .replace(/^public\./i, "")
            .replace(/"/g, "");
          if (name.length > 0 && /^\w+$/.test(name)) hardened.add(name);
        }
      }
    }
    expect([...hardened].sort()).toEqual([...BROWSER_HARDENED_RELATIONS].sort());
  });

  it("admits PostgreSQL's stock PUBLIC EXECUTE and refuses any named-role EXECUTE", () => {
    expect(() =>
      assertRoutineExecuteBounded(
        [
          { grantee_name: "PUBLIC", privilege_type: "EXECUTE" },
          { grantee_name: "CURRENT_USER", privilege_type: "EXECUTE" },
        ],
        refuse,
      ),
    ).not.toThrow();
    for (const grantee of [...PLATFORM_MANAGED_PRINCIPALS, "waia_account_observer"]) {
      expect(() =>
        assertRoutineExecuteBounded([{ grantee_name: grantee, privilege_type: "EXECUTE" }], refuse),
      ).toThrow("CATALOG_ROUTINE_NAMED_GRANT");
    }
  });
});
