/**
 * DEE-1020: proves the canonical authority projection against a Supabase-class PostgreSQL 17
 * cluster.
 *
 * The frozen H2/post-H2 catalog digests were originally derived against a bare cluster whose
 * migration authority is the bootstrap superuser, so they were unreachable on the approved Supabase
 * production target: its `ALTER DEFAULT PRIVILEGES` baseline, its explicit `public` USAGE grants and
 * PostgreSQL 16+ role-creation grants all appeared as catalog drift. This suite builds that cluster
 * class from `scripts/postgres-validation/prelude-supabase-baseline.sql` and asserts two things that
 * must hold together:
 *
 *   1. every lawful step 0205–0210 verifies, with exactly the same digest the bare reference
 *      fixture produces (the existing `postgres-h2-migration-operator-v1` and
 *      `postgres-post-h2-migration-operator-v1` integration suites pin the bare side);
 *   2. representative unsafe authority is still refused — read/write grants to browser, service and
 *      WAIA principals, destructive structural grants, named function EXECUTE, schema CREATE,
 *      grantable privileges, credential secret-column broadening and unintended role membership.
 *
 * Requires an exclusively owned, disposable loopback cluster: role state is cluster-wide, so sharing
 * one with the bare fixtures would cross-contaminate role-creation lineage.
 */
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyH2MigrationCatalog } from "@/scripts/ops/postgres-h2-migration-operator-v1";
import { verifyPostH2MigrationCatalog } from "@/scripts/ops/postgres-post-h2-migration-operator-v1";

const adminUrl = process.env.WAIA_TEST_DEE1020_SUPABASE_LIKE_PG_ADMIN_URL?.trim();
const enabled = Boolean(adminUrl);
const migrationRoot = "db/migrations_postgres";
const authority = "waia_platform_authority";
const authorityPassword = randomUUID();
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const templateDatabase = `waia_dee1020_template_${suffix}`;
const createdDatabases = new Set<string>();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "waia-dee1020-")));
const h2Steps = ["0205", "0206", "0207", "0208"] as const;
const postH2Steps = ["0209", "0210"] as const;
const allSteps = [...h2Steps, ...postH2Steps] as const;

type Step = (typeof allSteps)[number];
type Journal = Readonly<{ entries: readonly Readonly<{ idx: number; tag: string }>[] }>;

let admin: Sql | undefined;

function assertOwnedLocalUrl(value: string): URL {
  const parsed = new URL(value);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("DEE1020_OWNED_LOOPBACK_POSTGRES_REQUIRED");
  }
  return parsed;
}

function databaseUrl(name: string, asAuthority: boolean): string {
  const parsed = assertOwnedLocalUrl(adminUrl!);
  parsed.pathname = `/${name}`;
  if (asAuthority) {
    parsed.username = authority;
    parsed.password = authorityPassword;
  }
  return parsed.toString();
}

function connect(name: string, asAuthority = true): Sql {
  return postgres(databaseUrl(name, asAuthority), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    connection: { application_name: "dee1020-supabase-like-test" },
    onnotice: () => {},
  });
}

function journal(): Journal {
  return JSON.parse(readFileSync(join(migrationRoot, "meta/_journal.json"), "utf8")) as Journal;
}

function tagFor(step: Step): string {
  const entry = journal().entries.find((item) => item.tag.startsWith(`${step}_`));
  if (!entry) throw new Error(`DEE1020_UNKNOWN_STEP_${step}`);
  return entry.tag;
}

function baselineFolder(): string {
  const source = journal();
  const entries = source.entries.filter((entry) => entry.idx <= 204);
  const root = join(scratch, "baseline-0204");
  mkdirSync(join(root, "meta"), { recursive: true });
  writeFileSync(join(root, "meta/_journal.json"), JSON.stringify({ ...source, entries }));
  for (const entry of entries) {
    copyFileSync(join(migrationRoot, `${entry.tag}.sql`), join(root, `${entry.tag}.sql`));
  }
  return root;
}

async function createDatabase(name: string, template?: string): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(name) || (template && !/^[a-z0-9_]+$/.test(template))) {
    throw new Error("DEE1020_UNSAFE_TEST_IDENTIFIER");
  }
  await admin!.unsafe(
    template
      ? `CREATE DATABASE "${name}" TEMPLATE "${template}" OWNER ${authority}`
      : `CREATE DATABASE "${name}" OWNER ${authority}`,
  );
  createdDatabases.add(name);
}

/** Applies one pinned migration file exactly as the operator does: one transaction, in file order. */
async function applyStep(sql: Sql, step: Step): Promise<void> {
  const statements = readFileSync(join(migrationRoot, `${tagFor(step)}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  await sql.begin(async (tx) => {
    for (const statement of statements) await tx.unsafe(statement);
  });
}

function verify(sql: Sql, step: Step): Promise<string> {
  return (h2Steps as readonly string[]).includes(step)
    ? verifyH2MigrationCatalog(sql, step as (typeof h2Steps)[number])
    : verifyPostH2MigrationCatalog(sql, step as (typeof postH2Steps)[number]);
}

/**
 * Clones the 0204 template, applies every step up to and including `step`, then runs `mutate` so a
 * negative case can inject unsafe authority into an otherwise lawful, fully migrated catalog.
 */
async function stateAt(step: Step, mutate?: (sql: Sql) => Promise<void>): Promise<Sql> {
  const name = `waia_dee1020_${step}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await createDatabase(name, templateDatabase);
  const sql = connect(name);
  for (const candidate of allSteps) {
    await applyStep(sql, candidate);
    if (candidate === step) break;
  }
  if (mutate) await mutate(sql);
  return sql;
}

describe.skipIf(!enabled)("DEE-1020 Supabase-class canonical catalog authority", () => {
  beforeAll(async () => {
    assertOwnedLocalUrl(adminUrl!);
    admin = postgres(adminUrl!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      connection: { application_name: "dee1020-supabase-like-admin" },
      onnotice: () => {},
    });
    for (const file of ["prelude-auth-stub.sql", "prelude-supabase-baseline.sql"]) {
      await admin.unsafe(readFileSync(join("scripts/postgres-validation", file), "utf8")).simple();
    }
    await admin.unsafe(`ALTER ROLE ${authority} LOGIN PASSWORD '${authorityPassword}'`);
    await createDatabase(templateDatabase);
    const template = connect(templateDatabase, false);
    try {
      for (const file of ["prelude-auth-stub.sql", "prelude-supabase-baseline.sql"]) {
        await template
          .unsafe(readFileSync(join("scripts/postgres-validation", file), "utf8"))
          .simple();
      }
    } finally {
      await template.end({ timeout: 5 });
    }
    const asAuthority = connect(templateDatabase);
    try {
      await migrate(drizzle(asAuthority), { migrationsFolder: baselineFolder() });
      // The DEE-1015 historical LOGIN identity exists on the approved target before this campaign
      // and is pinned by the 0206–0208 role/membership projections.
      await asAuthority
        .unsafe(
          `
        CREATE ROLE waia_historical_runner_login
          LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
        GRANT waia_historical_runner TO waia_historical_runner_login
          WITH ADMIN FALSE, INHERIT FALSE, SET TRUE
      `,
        )
        .simple();
    } finally {
      await asAuthority.end({ timeout: 5 });
    }
    await admin.unsafe(`ALTER DATABASE "${templateDatabase}" WITH IS_TEMPLATE true`);
  }, 300_000);

  afterAll(async () => {
    if (admin) {
      if (createdDatabases.has(templateDatabase)) {
        await admin.unsafe(`ALTER DATABASE "${templateDatabase}" WITH IS_TEMPLATE false`);
      }
      for (const database of [...createdDatabases].reverse()) {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      }
      await admin.unsafe(`ALTER ROLE ${authority} NOLOGIN PASSWORD NULL`).catch(() => undefined);
      await admin.end({ timeout: 5 });
    }
    rmSync(scratch, { recursive: true, force: true });
  }, 120_000);

  it("proves the Supabase-class platform baseline this suite exists to reproduce", async () => {
    const sql = await stateAt("0210");
    try {
      const [baseline] = await sql<
        Readonly<{ relation_acl: string; schema_grantees: string; creator_grants: string }>[]
      >`
        SELECT
          (SELECT relacl::text FROM pg_class WHERE oid='public.trader_account_observations'::regclass)
            AS relation_acl,
          (SELECT count(*)::text FROM aclexplode(
            (SELECT nspacl FROM pg_namespace WHERE nspname='public')) acl
            JOIN pg_roles role ON role.oid=acl.grantee
            WHERE role.rolname IN ('anon','authenticated','service_role')) AS schema_grantees,
          (SELECT count(*)::text FROM pg_auth_members membership
            JOIN pg_roles member ON member.oid=membership.member
            JOIN pg_roles granted ON granted.oid=membership.roleid
            WHERE member.rolname=current_user
              AND granted.rolname LIKE 'waia_account_observ%') AS creator_grants
      `;
      // `service_role` keeps the platform's structural set after 0205's REVOKE, which named only
      // PUBLIC/anon/authenticated — the exact production condition that broke the frozen digest.
      expect(baseline?.relation_acl).toContain("service_role=Dxtm/");
      expect(baseline?.relation_acl).not.toMatch(/service_role=[a-zA-Z]*[arwd]/);
      expect(baseline?.schema_grantees).toBe("3");
      // PostgreSQL 16+ auto-grants each created role back to the NOSUPERUSER CREATEROLE authority.
      expect(baseline?.creator_grants).toBe("3");
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 180_000);

  it("verifies every lawful step 0205-0210 against the frozen digests", async () => {
    const database = `waia_dee1020_ladder_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    await createDatabase(database, templateDatabase);
    const target = connect(database);
    try {
      const digests: string[] = [];
      for (const step of allSteps) {
        await applyStep(target, step);
        digests.push(await verify(target, step));
      }
      expect(digests).toHaveLength(6);
      expect(new Set(digests).size).toBe(6);
      expect(digests.every((digest) => /^[0-9a-f]{64}$/.test(digest))).toBe(true);
    } finally {
      await target.end({ timeout: 5 });
    }
  }, 300_000);

  const negatives = [
    {
      name: "browser SELECT on protected observation data",
      step: "0205" as Step,
      injection: "GRANT SELECT ON public.trader_account_observations TO anon",
      refusal: "CATALOG_DIGEST_MISMATCH",
    },
    {
      name: "browser INSERT on protected observation data",
      step: "0205" as Step,
      injection: "GRANT INSERT ON public.trader_account_collection_state TO authenticated",
      refusal: "CATALOG_DIGEST_MISMATCH",
    },
    {
      name: "browser UPDATE and DELETE on protected observation data",
      step: "0205" as Step,
      injection: "GRANT UPDATE, DELETE ON public.trader_account_observations TO authenticated",
      refusal: "CATALOG_DIGEST_MISMATCH",
    },
    {
      name: "service_role read authority despite its platform baseline",
      step: "0205" as Step,
      injection: "GRANT SELECT ON public.trader_account_observations TO service_role",
      refusal: "CATALOG_DIGEST_MISMATCH",
    },
    {
      name: "service_role read authority on AI-TWIN relations",
      step: "0209" as Step,
      injection: "GRANT SELECT ON public.ai_twin_observations TO service_role",
      refusal: "CATALOG_0209_GRANTS",
    },
    {
      name: "browser read authority on AI-TWIN relations",
      step: "0209" as Step,
      injection: "GRANT SELECT ON public.ai_twin_observations TO authenticated",
      refusal: "CATALOG_0209_GRANTS",
    },
    {
      name: "destructive TRUNCATE handed to a WAIA collector role",
      step: "0205" as Step,
      injection: "GRANT TRUNCATE ON public.trader_account_observations TO waia_account_observer",
      refusal: "CATALOG_AUTHORITY_STRUCTURAL_GRANT",
    },
    {
      name: "destructive TRUNCATE handed to PUBLIC",
      step: "0205" as Step,
      injection: "GRANT TRUNCATE ON public.trader_account_collection_state TO PUBLIC",
      refusal: "CATALOG_AUTHORITY_STRUCTURAL_GRANT",
    },
    {
      name: "named function EXECUTE on an observation trigger function",
      step: "0205" as Step,
      injection: "GRANT EXECUTE ON FUNCTION public.trader_observation_immutable() TO anon",
      refusal: "CATALOG_ROUTINE_NAMED_GRANT",
    },
    {
      name: "schema CREATE on public",
      step: "0205" as Step,
      injection: "GRANT CREATE ON SCHEMA public TO anon",
      refusal: "CATALOG_SCHEMA_CREATE",
    },
    {
      name: "an undeclared WAIA role holding broad table authority",
      step: "0205" as Step,
      injection: "GRANT SELECT ON public.trader_account_observations TO waia_historical_runner",
      refusal: "CATALOG_AUTHORITY_UNKNOWN_PRINCIPAL",
    },
    {
      name: "a re-delegatable grant",
      step: "0205" as Step,
      injection:
        "GRANT SELECT ON public.trader_account_observations TO waia_account_observer WITH GRANT OPTION",
      refusal: "CATALOG_AUTHORITY_GRANTABLE",
    },
    {
      name: "credential secret-column broadening for the collector role",
      step: "0210" as Step,
      injection:
        "GRANT SELECT (encrypted_payload) ON public.exchange_credentials TO waia_account_observer",
      refusal: "CATALOG_0210_GRANTS",
    },
    {
      name: "credential secret-column broadening for the projection reader",
      step: "0210" as Step,
      injection:
        "GRANT SELECT (wrapped_dek_key) ON public.exchange_credentials TO waia_account_observation_reader",
      refusal: "CATALOG_0210_GRANTS",
    },
    {
      name: "credential authority granted to an unintended role",
      step: "0210" as Step,
      injection:
        "GRANT waia_account_observation_credential TO waia_historical_runner_login WITH INHERIT TRUE",
      refusal: "CATALOG_0210_ROLE_GRANTEES",
    },
    {
      name: "the migration authority's creation grant made inheritable",
      step: "0205" as Step,
      injection: `GRANT waia_account_observer TO ${authority} WITH INHERIT TRUE, SET FALSE`,
      refusal: "CATALOG_AUTHORITY_CREATOR_MEMBERSHIP",
    },
    {
      name: "the migration authority's creation grant made settable",
      step: "0210" as Step,
      injection: `GRANT waia_account_observation_credential TO ${authority} WITH SET TRUE, INHERIT FALSE`,
      refusal: "CATALOG_0210_ROLE_GRANTEES",
    },
  ] as const;

  it.each(negatives)(
    "refuses $name",
    async ({ step, injection, refusal }) => {
      const sql = await stateAt(step, async (target) => {
        await target.unsafe(injection);
      });
      try {
        await expect(verify(sql, step)).rejects.toThrow(refusal);
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
    180_000,
  );
});
