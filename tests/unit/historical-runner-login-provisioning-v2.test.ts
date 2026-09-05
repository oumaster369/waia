import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildPostgresScramVerifier, provisionHistoricalRunnerLoginV2 } from
  "../../scripts/ops/provision-historical-runner-login.mjs";

const PASSWORD = "correct-horse-battery-staple-35-cycle";

function provisioningDatabase(existing: Readonly<{
  memberships: readonly string[];
  has_direct_grants: boolean;
  owns_objects: boolean;
}>) {
  const sql = Object.assign(vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("rolname = current_user")) {
      return [{ rolsuper: true, rolcreaterole: true }];
    }
    if (query.includes("FROM pg_roles role")) {
      return [{ rolcanlogin: false, rolinherit: false, rolsuper: false, rolcreatedb: false,
        rolcreaterole: false, rolreplication: false, rolbypassrls: false, memberships: [] }];
    }
    if (query.includes("FROM pg_roles login WHERE login.rolname")) return [{ oid: "1", ...existing }];
    throw new Error(`unexpected query: ${query}`);
  }), { unsafe: vi.fn(async () => []) });
  const pool = {
    begin: vi.fn(async (_isolation: string, callback: (tx: typeof sql) => Promise<unknown>) =>
      callback(sql)),
    end: vi.fn(async () => undefined),
  };
  return { pool, sql };
}

describe("historical runner dedicated LOGIN provisioning", () => {
  it("builds a deterministic SCRAM verifier without embedding the plaintext", () => {
    const password = PASSWORD;
    const verifier = buildPostgresScramVerifier(password, Buffer.alloc(16, 7));
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(verifier).not.toContain(password);
    expect(buildPostgresScramVerifier(password, Buffer.alloc(16, 7))).toBe(verifier);
    expect(() => buildPostgresScramVerifier("too-short"))
      .toThrow("PASSWORD_STRENGTH");
  });

  it("keeps the login constrained and never gives it owner/BYPASSRLS authority", () => {
    const source = readFileSync(path.resolve(
      import.meta.dirname, "../../scripts/ops/provision-historical-runner-login.mjs",
    ), "utf8");
    expect(source).toContain("NOINHERIT NOSUPERUSER NOCREATEDB");
    expect(source).toContain("NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    expect(source).toContain("ALTER ROLE ${RUNNER_ROLE} NOLOGIN NOINHERIT");
    expect(source).toContain("GRANT ${RUNNER_ROLE} TO ${LOGIN_ROLE}");
    expect(source).toContain("dependency.deptype='a'");
    expect(source).toContain("dependency.deptype='o'");
    expect(source).not.toMatch(/\bBYPASSRLS\b/);
    expect(source).not.toMatch(/GRANT\s+(postgres|service_role)/i);
  });

  it.each([
    [{ memberships: ["waia_historical_runner", "service_role"], has_direct_grants: false,
      owns_objects: false }, "UNEXPECTED_MEMBERSHIP"],
    [{ memberships: ["waia_historical_runner"], has_direct_grants: true,
      owns_objects: false }, "DIRECT_GRANT"],
    [{ memberships: ["waia_historical_runner"], has_direct_grants: false,
      owns_objects: true }, "OBJECT_OWNERSHIP"],
  ] as const)("rejects an existing login with forbidden authority %#", async (existing, code) => {
    const { pool } = provisioningDatabase(existing);
    await expect(provisionHistoricalRunnerLoginV2({
      WAIA_POSTGRES_ADMIN_SESSION_URL: "postgresql://admin:secret@db.invalid/waia",
      WAIA_HISTORICAL_RUNNER_DB_PASSWORD: PASSWORD,
    }, { openDatabase: () => pool })).rejects.toThrow(code);
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
