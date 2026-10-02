import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";

import * as credentialProbe from "@/lib/trader/account-observation/host-role-probe";
import { probeObservationCredentialPool } from "@/lib/trader/account-observation/host-role-probe";
import { createObservationCredentialReader } from "@/lib/trader/account-observation/credential-read-boundary";
import { encryptCredentialPayload } from "@/lib/trader/credentials/envelope-crypto";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";
import { buildHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";
import { requireHtxStoredPermissionMetadata } from "@/lib/trader/security/htx-secure-credential-resolver";
import { runAccountObservationCollector } from "@/scripts/trader/account-observation-collector-host";
import {
  ACCOUNT_OBSERVATION_LOGIN_PLAN,
  provisionAccountObservationLoginsV1,
} from "@/scripts/ops/provision-account-observation-logins.mjs";
import {
  MANIFEST_RELEASE_SHA,
  manifestAssignment,
  sealManifest,
} from "@/tests/unit/account-observation-manifest-fixtures";

// Explicit synthetic loopback-only target; never use production environment URLs.
const enabled = process.env.DEE960_LOCAL_PG17 === "1";
const url = "postgres://waia_local_admin:local_validation_only@127.0.0.1:55460/waia_dee960_local";
const HOST = "127.0.0.1:55460";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

/** Distinct, synthetic, >=32 characters; never a production secret. */
const PASSWORDS = Object.freeze({
  collector: "dee1015_synthetic_collector_password_0001",
  reader: "dee1015_synthetic_reader_password_00000002",
  credential: "dee1015_synthetic_credential_password_0003",
});

const MIGRATIONS = Object.freeze([
  "db/migrations_postgres/0006_exchange_credentials.sql",
  "db/migrations_postgres/0007_exchange_credentials_rls.sql",
  "db/migrations_postgres/0205_trader_account_observation_v1.sql",
  "db/migrations_postgres/0210_trader_account_observation_credential_v1.sql",
  "db/migrations_postgres/0229_trader_observation_read_only_credential_v1.sql",
]);

describe.skipIf(!enabled)(
  "DEE-1015 account-observation credential authority on actual PostgreSQL 17",
  () => {
    let root: Sql;
    let admin: Sql;
    let database: string;
    let adminSessionUrl: string;
    // Each runtime LOGIN is provisioned with CONNECTION LIMIT 2, so one shared bounded client per
    // identity both respects that bound and keeps it under test.
    const clients = new Map<keyof typeof PASSWORDS, Sql>();

    function runtimeUrl(purpose: keyof typeof PASSWORDS): string {
      const login = ACCOUNT_OBSERVATION_LOGIN_PLAN.find(
        (entry) => entry.purpose === purpose,
      )!.loginRole;
      return `postgres://${login}:${PASSWORDS[purpose]}@${HOST}/${database}`;
    }

    function open(purpose: keyof typeof PASSWORDS): Sql {
      const existing = clients.get(purpose);
      if (existing) return existing;
      const login = ACCOUNT_OBSERVATION_LOGIN_PLAN.find(
        (entry) => entry.purpose === purpose,
      )!.loginRole;
      const client = postgres(`postgres://${login}:${PASSWORDS[purpose]}@${HOST}/${database}`, {
        max: 1,
        connect_timeout: 3,
        max_lifetime: 60,
        prepare: false,
        onnotice: () => {},
      });
      clients.set(purpose, client);
      return client;
    }

    beforeAll(async () => {
      root = postgres(url, { max: 1, connect_timeout: 3, prepare: false });
      const version = Number((await root`SHOW server_version_num`)[0].server_version_num);
      expect(version).toBeGreaterThanOrEqual(170000);
      expect(version).toBeLessThan(180000);

      database = "dee1015_cred_" + randomUUID().replaceAll("-", "");
      await root.unsafe(`CREATE DATABASE "${database}"`);
      adminSessionUrl = url.replace("/waia_dee960_local", "/" + database);
      admin = postgres(adminSessionUrl, { max: 3, connect_timeout: 3, prepare: false });

      // Canonical migrations are applied by a limited, non-superuser DDL owner.
      await admin.unsafe(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dee1015_cred_owner') THEN
          CREATE ROLE dee1015_cred_owner NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
          CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
          CREATE ROLE anon NOLOGIN; END IF;
      END $$;
      GRANT USAGE, CREATE ON SCHEMA public TO dee1015_cred_owner WITH GRANT OPTION;`);
      await admin.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE dee1015_cred_owner");
        await tx.unsafe("CREATE TABLE public.organizations (id uuid PRIMARY KEY)");
        for (const path of MIGRATIONS) {
          for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint")) {
            if (statement.trim()) await tx.unsafe(statement);
          }
        }
      });
      for (const statement of readFileSync(
        "db/migrations_postgres/0230_trader_account_observation_spot_inventory_v1.sql",
        "utf8",
      ).split("--> statement-breakpoint")) {
        if (statement.trim()) await admin.unsafe(statement);
      }

      // The reviewed Human operator provisions the actual three runtime LOGIN identities.
      const receipt = await provisionAccountObservationLoginsV1({
        WAIA_POSTGRES_ADMIN_SESSION_URL: adminSessionUrl,
        WAIA_OBSERVATION_COLLECTOR_DB_PASSWORD: PASSWORDS.collector,
        WAIA_OBSERVATION_READER_DB_PASSWORD: PASSWORDS.reader,
        WAIA_OBSERVATION_CREDENTIAL_DB_PASSWORD: PASSWORDS.credential,
      });
      expect(receipt.status).toBe("OK");
      expect(receipt.logins.map((entry: { loginRole: string }) => entry.loginRole)).toEqual(
        ACCOUNT_OBSERVATION_LOGIN_PLAN.map((entry) => entry.loginRole),
      );
      for (const entry of ACCOUNT_OBSERVATION_LOGIN_PLAN) {
        await admin.unsafe(`GRANT CONNECT ON DATABASE "${database}" TO "${entry.loginRole}"`);
      }
    }, 60000);

    afterAll(async () => {
      for (const client of clients.values()) await client?.end({ timeout: 2 }).catch(() => {});
      await admin?.end({ timeout: 2 });
      await root?.end({ timeout: 2 });
      // Isolated synthetic database retained for diagnosis; no destructive cleanup.
    });

    async function provider() {
      return SecretsStoreMasterKeyProvider.create({
        secretGetter: async () => MASTER_KEY,
        productionReady: true,
      });
    }

    /** Synthetic credential + Human-provisioned collection-state assignment. */
    async function seed(
      options: {
        assigned?: boolean;
        status?: string;
        configurationRevision?: string;
        symbols?: readonly string[];
        permissionMetadata?: string | ((exchangeAccountId: string) => string);
      } = {},
    ) {
      const organizationId = randomUUID();
      const credentialId = randomUUID();
      const exchangeAccountId = String(100000 + Math.floor(Math.random() * 800000));
      const envelope = await encryptCredentialPayload(await provider(), {
        apiKey: "synthetic-observation-key",
        apiSecret: "synthetic-observation-secret",
      });
      const permissionMetadata =
        typeof options.permissionMetadata === "function"
          ? options.permissionMetadata(exchangeAccountId)
          : (options.permissionMetadata ??
            JSON.stringify(
              buildHtxPermissionMetadata({
                exchangeAccountId,
                scopes: ["read"],
              }),
            ));
      await admin`INSERT INTO public.organizations VALUES (${organizationId})`;
      await admin`INSERT INTO public.exchange_credentials (id, organization_id, venue,
        exchange_account_id, api_key_masked, encrypted_payload, payload_key_version,
        wrapped_dek_key_version, wrapped_dek_key, permission_metadata, status)
        VALUES (${credentialId}, ${organizationId}, 'htx', ${exchangeAccountId}, 'mask****',
          ${envelope.encryptedPayload}, ${envelope.payloadKeyVersion},
          ${envelope.wrappedDekKeyVersion}, ${envelope.wrappedDekKey},
          ${permissionMetadata},
          ${options.status ?? "active"})`;
      if (options.assigned !== false) {
        await admin`INSERT INTO public.trader_account_collection_state
          (organization_id, credential_id, exchange_account_id, configuration_revision, symbols)
          VALUES (${organizationId}, ${credentialId}, ${exchangeAccountId},
            ${options.configurationRevision ?? "config-1"},
            ${admin.json([...(options.symbols ?? ["BTCUSDT"])])})`;
      }
      return { organizationId, credentialId, exchangeAccountId };
    }

    async function credentialReader(
      assignments: readonly {
        organizationId: string;
        credentialId: string;
        exchangeAccountId: string;
      }[],
    ) {
      return createObservationCredentialReader({
        sql: open("credential"),
        provider: await provider(),
        assignments,
      });
    }

    /** Raw statement attempt through one runtime LOGIN, reporting the PostgreSQL error code. */
    async function attempt(
      purpose: keyof typeof PASSWORDS,
      statement: string,
      context?: {
        organizationId: string;
        credentialId: string;
        exchangeAccountId: string;
      },
    ): Promise<string> {
      const role = ACCOUNT_OBSERVATION_LOGIN_PLAN.find(
        (entry) => entry.purpose === purpose,
      )!.parentRole;
      const client = open(purpose);
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          if (context) {
            await tx`SELECT set_config('waia.observation_org', ${context.organizationId}, true),
              set_config('waia.observation_credential', ${context.credentialId}, true),
              set_config('waia.observation_account', ${context.exchangeAccountId}, true)`;
          }
          await tx.unsafe(statement);
        });
        return "ALLOWED";
      } catch (error) {
        return (error as { code?: string }).code ?? "REFUSED";
      }
    }

    it("provisions exactly the three attested runtime LOGIN identities", async () => {
      const posture = await admin`
        SELECT login.rolname::text AS login, login.rolcanlogin, login.rolinherit, login.rolsuper,
               login.rolcreatedb, login.rolcreaterole, login.rolreplication, login.rolbypassrls,
               login.rolconnlimit,
               (SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
                FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid
                WHERE m.member = login.oid) AS memberships,
               EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = login.oid
                 AND (m.admin_option OR m.inherit_option OR NOT m.set_option)) AS unsafe_options,
               EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass
                 AND d.refobjid = login.oid AND d.deptype='o') AS owns_objects,
               EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass
                 AND d.refobjid = login.oid AND d.deptype='a'
                 AND d.classid <> 'pg_database'::regclass) AS direct_grants
        FROM pg_roles login
        WHERE login.rolname = ANY (${ACCOUNT_OBSERVATION_LOGIN_PLAN.map((e) => e.loginRole)})
        ORDER BY login.rolname`;
      expect(posture).toHaveLength(3);
      for (const row of posture) {
        const expected = ACCOUNT_OBSERVATION_LOGIN_PLAN.find((e) => e.loginRole === row.login)!;
        expect({ ...row, memberships: row.memberships }).toMatchObject({
          rolcanlogin: true,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 2,
          unsafe_options: false,
          owns_objects: false,
          direct_grants: false,
          memberships:
            expected.purpose === "collector"
              ? ["waia_account_observation_inventory", "waia_account_observer"]
              : [expected.parentRole],
        });
        expect(row.login).not.toBe(expected.parentRole);
      }
    });

    it("keeps every NOLOGIN parent unprivileged and non-login", async () => {
      const parents = await admin`
        SELECT rolname::text AS role, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb,
               rolcreaterole, rolreplication
        FROM pg_roles
        WHERE rolname = ANY (${ACCOUNT_OBSERVATION_LOGIN_PLAN.map((e) => e.parentRole)})
        ORDER BY rolname`;
      expect(parents).toHaveLength(3);
      for (const parent of parents) {
        expect(parent).toMatchObject({
          rolcanlogin: false,
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
        });
      }
    });

    it("is idempotent on exact retry and tolerates only database CONNECT", async () => {
      const again = await provisionAccountObservationLoginsV1({
        WAIA_POSTGRES_ADMIN_SESSION_URL: adminSessionUrl,
        WAIA_OBSERVATION_COLLECTOR_DB_PASSWORD: PASSWORDS.collector,
        WAIA_OBSERVATION_READER_DB_PASSWORD: PASSWORDS.reader,
        WAIA_OBSERVATION_CREDENTIAL_DB_PASSWORD: PASSWORDS.credential,
      });
      expect(again.status).toBe("OK");
      expect(again.logins.every((entry: { created: boolean }) => entry.created === false)).toBe(
        true,
      );
    });

    it("declares only the minimal credential projection and no whole-table SELECT", async () => {
      const privileges = await admin`SELECT
        has_table_privilege('waia_account_observation_credential',
          'public.exchange_credentials','SELECT') AS whole_table,
        has_column_privilege('waia_account_observation_credential',
          'public.exchange_credentials','encrypted_payload','SELECT') AS ciphertext,
        has_column_privilege('waia_account_observation_credential',
          'public.exchange_credentials','permission_metadata','SELECT') AS metadata,
        has_column_privilege('waia_account_observation_credential',
          'public.exchange_credentials','venue','SELECT') AS venue,
        has_column_privilege('waia_account_observation_credential',
          'public.exchange_credentials','api_key_masked','SELECT') AS masked,
        has_column_privilege('waia_account_observation_credential',
          'public.exchange_credentials','observation_revision','SELECT') AS revision,
        has_column_privilege('waia_account_observation_credential',
          'public.exchange_credentials','observation_read_only','SELECT') AS observation_decision,
        has_any_column_privilege('waia_account_observation_credential',
          'public.exchange_credentials','INSERT,UPDATE') AS credential_writes,
        has_table_privilege('waia_account_observation_credential',
          'public.trader_account_observations','SELECT') AS observation_reads,
        has_any_column_privilege('waia_account_observation_credential',
          'public.trader_account_collection_state','INSERT,UPDATE') AS state_writes,
        has_column_privilege('waia_account_observer',
          'public.exchange_credentials','encrypted_payload','SELECT') AS observer_ciphertext,
        has_column_privilege('waia_account_observation_reader',
          'public.exchange_credentials','encrypted_payload','SELECT') AS reader_ciphertext,
        has_column_privilege('waia_account_observer',
          'public.exchange_credentials','wrapped_dek_key','SELECT') AS observer_wrapped,
        has_column_privilege('waia_account_observation_reader',
          'public.exchange_credentials','wrapped_dek_key','SELECT') AS reader_wrapped,
        (SELECT relforcerowsecurity FROM pg_class
          WHERE oid='public.exchange_credentials'::regclass) AS forced_rls`;
      expect(privileges[0]).toMatchObject({
        whole_table: false,
        ciphertext: true,
        metadata: false,
        venue: false,
        masked: false,
        revision: false,
        observation_decision: true,
        credential_writes: false,
        observation_reads: false,
        state_writes: false,
        observer_ciphertext: false,
        reader_ciphertext: false,
        observer_wrapped: false,
        reader_wrapped: false,
        // DEE-1015 deliberately does not enable FORCE RLS on exchange_credentials.
        forced_rls: false,
      });
    });

    it("classifies the canonical HTX read-only policy at the generated-column and decrypt boundaries", async () => {
      const assignment = await seed();
      const reader = await credentialReader([assignment]);
      const canonical = buildHtxPermissionMetadata({
        exchangeAccountId: assignment.exchangeAccountId,
        scopes: ["read"],
      });
      const withField = (field: string, value: unknown) =>
        JSON.stringify({ ...canonical, [field]: value });
      const cases = [
        { name: "canonical read", metadata: JSON.stringify(canonical), allowed: true },
        { name: "duplicate read", metadata: withField("scopes", ["read", "read"]), allowed: true },
        {
          name: "valid account label",
          metadata: withField("accountLabel", "primary"),
          allowed: true,
        },
        { name: "trade scope", metadata: withField("scopes", ["read", "trade"]), allowed: false },
        {
          name: "withdraw scope",
          metadata: withField("scopes", ["read", "withdraw"]),
          allowed: false,
        },
        {
          name: "unknown scope",
          metadata: withField("scopes", ["read", "future-scope"]),
          allowed: false,
        },
        { name: "empty scopes", metadata: withField("scopes", []), allowed: false },
        { name: "scopes-only legacy metadata", metadata: '{"scopes":["read"]}', allowed: false },
        { name: "missing scopes", metadata: withField("scopes", undefined), allowed: false },
        { name: "null scopes", metadata: withField("scopes", null), allowed: false },
        { name: "string scopes", metadata: withField("scopes", "read"), allowed: false },
        { name: "object scopes", metadata: withField("scopes", {}), allowed: false },
        { name: "non-string member", metadata: withField("scopes", ["read", 7]), allowed: false },
        {
          name: "mixed null member",
          metadata: withField("scopes", ["read", null]),
          allowed: false,
        },
        { name: "wrong version", metadata: withField("version", 2), allowed: false },
        { name: "string version", metadata: withField("version", "1"), allowed: false },
        { name: "wrong market", metadata: withField("marketType", "futures"), allowed: false },
        { name: "non-string market", metadata: withField("marketType", 1), allowed: false },
        {
          name: "foreign account metadata",
          metadata: withField("exchangeAccountId", "foreign-account"),
          allowed: false,
        },
        {
          name: "non-string account metadata",
          metadata: withField("exchangeAccountId", 123),
          allowed: false,
        },
        {
          name: "withdraw not forbidden",
          metadata: withField("withdrawForbidden", false),
          allowed: false,
        },
        {
          name: "withdraw flag wrong type",
          metadata: withField("withdrawForbidden", "true"),
          allowed: false,
        },
        {
          name: "transfer not forbidden",
          metadata: withField("transferForbidden", false),
          allowed: false,
        },
        {
          name: "transfer flag wrong type",
          metadata: withField("transferForbidden", "true"),
          allowed: false,
        },
        { name: "warnings not array", metadata: withField("warnings", "none"), allowed: false },
        { name: "non-string warning", metadata: withField("warnings", [1]), allowed: false },
        { name: "null label", metadata: withField("accountLabel", null), allowed: false },
        { name: "numeric label", metadata: withField("accountLabel", 1), allowed: false },
        {
          name: "wrong row venue",
          metadata: JSON.stringify(canonical),
          venue: "binance",
          allowed: false,
        },
        { name: "empty metadata", metadata: "", allowed: false },
        { name: "malformed metadata", metadata: "{", allowed: false },
        { name: "SQL null metadata", metadata: null, allowed: false },
      ] as const;

      for (const candidate of cases) {
        const candidateVenue = "venue" in candidate ? candidate.venue : "htx";
        await admin`UPDATE public.exchange_credentials SET permission_metadata=${candidate.metadata},
          venue=${candidateVenue}
          WHERE id=${assignment.credentialId}`;
        let oracleAllowed = false;
        try {
          const raw: unknown = candidate.metadata === null ? null : JSON.parse(candidate.metadata);
          const parsed =
            typeof raw === "object" && raw !== null && !Array.isArray(raw)
              ? (raw as Record<string, unknown>)
              : null;
          const verified = requireHtxStoredPermissionMetadata({
            purpose: "read",
            venue: candidateVenue,
            exchangeAccountId: assignment.exchangeAccountId,
            permissionMetadata: parsed,
          });
          oracleAllowed =
            verified.scopes.length > 0 && verified.scopes.every((scope) => scope === "read");
        } catch {
          oracleAllowed = false;
        }
        expect(oracleAllowed, `${candidate.name} independent HTX read oracle`).toBe(
          candidate.allowed,
        );

        const [generated] = await admin<{ observation_read_only: boolean }[]>`
          SELECT observation_read_only FROM public.exchange_credentials WHERE id=${assignment.credentialId}`;
        expect(generated?.observation_read_only, candidate.name).toBe(candidate.allowed);
        const credential = open("credential");
        const role = ACCOUNT_OBSERVATION_LOGIN_PLAN.find(
          (entry) => entry.purpose === "credential",
        )!.parentRole;
        const projected = await credential.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`SELECT set_config('waia.observation_org', ${assignment.organizationId}, true),
            set_config('waia.observation_credential', ${assignment.credentialId}, true),
            set_config('waia.observation_account', ${assignment.exchangeAccountId}, true)`;
          return tx<{ observation_read_only: boolean }[]>`
            SELECT observation_read_only FROM public.exchange_credentials
            WHERE id=${assignment.credentialId}`;
        });
        expect(projected, candidate.name).toHaveLength(1);
        expect(projected[0]!.observation_read_only, candidate.name).toBe(candidate.allowed);

        const decrypted = reader.getDecryptedCredentials(
          { organizationId: assignment.organizationId },
          assignment.credentialId,
        );
        if (candidate.allowed) {
          await expect(decrypted, candidate.name).resolves.toMatchObject({
            apiKey: expect.any(String),
            apiSecret: expect.any(String),
          });
        } else {
          await expect(decrypted, candidate.name).rejects.toThrow(
            "ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_READ_ONLY",
          );
        }
      }

      await admin`UPDATE public.exchange_credentials SET permission_metadata=${JSON.stringify(canonical)},
        venue='htx' WHERE id=${assignment.credentialId}`;
      const wrongExpectedAccount = `${Number(assignment.exchangeAccountId) + 1}`;
      const [accountMismatch] = await admin<{ allowed: boolean }[]>`
        SELECT public.exchange_credential_observation_read_only(permission_metadata, venue,
          ${wrongExpectedAccount}) AS allowed
        FROM public.exchange_credentials WHERE id=${assignment.credentialId}`;
      expect(accountMismatch?.allowed).toBe(false);
      expect(() =>
        requireHtxStoredPermissionMetadata({
          purpose: "read",
          venue: "htx",
          exchangeAccountId: wrongExpectedAccount,
          permissionMetadata: canonical,
        }),
      ).toThrow();
    });

    it("matches canonical account whitespace rejection before read-only admission", async () => {
      const valid = buildHtxPermissionMetadata({ exchangeAccountId: "73737331", scopes: ["read"] });
      const whitespace = [
        9,
        10,
        11,
        12,
        13,
        32,
        0x00a0,
        0x1680,
        ...Array.from({ length: 11 }, (_, index) => 0x2000 + index),
        0x2028,
        0x2029,
        0x202f,
        0x205f,
        0x3000,
        0xfeff,
      ];
      for (const code of whitespace) {
        const char = String.fromCodePoint(code);
        for (const account of [char, `${char}73737331`, `73737331${char}`]) {
          const metadata = { ...valid, exchangeAccountId: account };
          const [row] = await admin<{ allowed: boolean }[]>`
            SELECT public.exchange_credential_observation_read_only(
              ${JSON.stringify(metadata)}, 'htx', ${account}) AS allowed`;
          expect(row?.allowed, `U+${code.toString(16)}`).toBe(false);
          expect(() =>
            requireHtxStoredPermissionMetadata({
              purpose: "read",
              venue: "htx",
              exchangeAccountId: account,
              permissionMetadata: metadata,
            }),
          ).toThrow();
        }
      }
    });

    it("refuses a trade-scoped credential before plaintext is returned", async () => {
      const assignment = await seed({
        permissionMetadata: (exchangeAccountId) =>
          JSON.stringify(
            buildHtxPermissionMetadata({ exchangeAccountId, scopes: ["read", "trade"] }),
          ),
      });
      const reader = await credentialReader([assignment]);
      await expect(
        reader.getDecryptedCredentials(
          { organizationId: assignment.organizationId },
          assignment.credentialId,
        ),
      ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_READ_ONLY");
    });

    it("decrypts exactly the assigned credential through the existing crypto path", async () => {
      const assignment = await seed();
      const reader = await credentialReader([assignment]);
      await expect(
        reader.getDecryptedCredentials(
          { organizationId: assignment.organizationId },
          assignment.credentialId,
        ),
      ).resolves.toEqual({
        apiKey: "synthetic-observation-key",
        apiSecret: "synthetic-observation-secret",
      });
    });

    it("refuses a credential that has no provisioned observation assignment", async () => {
      const unassigned = await seed({ assigned: false });
      const reader = await credentialReader([unassigned]);
      await expect(
        reader.getDecryptedCredentials(
          { organizationId: unassigned.organizationId },
          unassigned.credentialId,
        ),
      ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_FOUND");
    });

    it("refuses a revoked credential even with a provisioned assignment", async () => {
      const revoked = await seed({ status: "revoked" });
      const reader = await credentialReader([revoked]);
      await expect(
        reader.getDecryptedCredentials(
          { organizationId: revoked.organizationId },
          revoked.credentialId,
        ),
      ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_FOUND");
    });

    it("refuses another organization's and another account's credential", async () => {
      const mine = await seed();
      const theirs = await seed();
      const reader = await credentialReader([mine]);
      // A different organization is not in the trusted assignment set at all.
      await expect(
        reader.getDecryptedCredentials(
          { organizationId: theirs.organizationId },
          theirs.credentialId,
        ),
      ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_ASSIGNED");
      // Nor can a caller pair its own organization with a foreign credential id.
      await expect(
        reader.getDecryptedCredentials(
          { organizationId: mine.organizationId },
          theirs.credentialId,
        ),
      ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_ASSIGNED");
    });

    it("refuses a foreign credential smuggled into the assignment set with a wrong account", async () => {
      const victim = await seed();
      // Attacker knows a real credential UUID and its organization, but claims an account that
      // has no provisioned assignment for it.
      const reader = await credentialReader([
        { ...victim, exchangeAccountId: String(Number(victim.exchangeAccountId) + 1) },
      ]);
      await expect(
        reader.getDecryptedCredentials(
          { organizationId: victim.organizationId },
          victim.credentialId,
        ),
      ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_FOUND");
    });

    it("denies raw credential reads without runtime context and with arbitrary context", async () => {
      const assignment = await seed();
      const projection = `SELECT id, encrypted_payload FROM public.exchange_credentials
        WHERE id = '${assignment.credentialId}'`;
      const client = open("credential");
      {
        const withoutContext = await client.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE waia_account_observation_credential");
          return tx.unsafe(projection);
        });
        expect(withoutContext).toHaveLength(0);

        const arbitrary = await client.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE waia_account_observation_credential");
          await tx`SELECT set_config('waia.observation_org', ${randomUUID()}, true),
            set_config('waia.observation_credential', ${assignment.credentialId}, true),
            set_config('waia.observation_account', ${assignment.exchangeAccountId}, true)`;
          return tx.unsafe(projection);
        });
        expect(arbitrary).toHaveLength(0);
      }
    });

    it("refuses SELECT * and every non-granted credential column for the credential login", async () => {
      const assignment = await seed();
      for (const statement of [
        "SELECT * FROM public.exchange_credentials",
        "SELECT permission_metadata FROM public.exchange_credentials",
        "SELECT venue FROM public.exchange_credentials",
        "SELECT api_key_masked FROM public.exchange_credentials",
        "SELECT observation_revision FROM public.exchange_credentials",
      ]) {
        expect(await attempt("credential", statement, assignment)).toBe("42501");
      }
    });

    it("refuses every credential and observation write from the credential login", async () => {
      const assignment = await seed();
      for (const statement of [
        `UPDATE public.exchange_credentials SET status='revoked'
          WHERE id='${assignment.credentialId}'`,
        `DELETE FROM public.exchange_credentials WHERE id='${assignment.credentialId}'`,
        `INSERT INTO public.exchange_credentials (id, organization_id, venue,
          exchange_account_id, status) VALUES ('${randomUUID()}',
          '${assignment.organizationId}', 'htx', '1', 'active')`,
        `UPDATE public.trader_account_collection_state SET consecutive_failures=9
          WHERE credential_id='${assignment.credentialId}'`,
        `DELETE FROM public.trader_account_collection_state
          WHERE credential_id='${assignment.credentialId}'`,
        "SELECT payload FROM public.trader_account_observations",
        `INSERT INTO public.trader_account_observations (organization_id, credential_id,
          exchange_account_id, observation_id, credential_revision, configuration_revision,
          lease_token, payload) VALUES ('${assignment.organizationId}',
          '${assignment.credentialId}', '${assignment.exchangeAccountId}', '${randomUUID()}',
          1, 'config-1', '${randomUUID()}', '{}'::jsonb)`,
      ]) {
        expect(await attempt("credential", statement, assignment)).toBe("42501");
      }
    });

    it("denies encrypted credential material to the observer and reader logins", async () => {
      const assignment = await seed();
      for (const purpose of ["collector", "reader"] as const) {
        expect(
          await attempt(
            purpose,
            "SELECT encrypted_payload FROM public.exchange_credentials",
            assignment,
          ),
        ).toBe("42501");
        expect(
          await attempt(
            purpose,
            "SELECT wrapped_dek_key FROM public.exchange_credentials",
            assignment,
          ),
        ).toBe("42501");
      }
    });

    it("keeps observer able to record observations while the reader cannot mutate", async () => {
      const assignment = await seed();
      expect(
        await attempt(
          "collector",
          `UPDATE public.trader_account_collection_state SET consecutive_failures=1
            WHERE credential_id='${assignment.credentialId}'`,
          assignment,
        ),
      ).toBe("ALLOWED");
      // The Human-owned bootstrap row remains outside collector authority.
      expect(
        await attempt(
          "collector",
          `INSERT INTO public.trader_account_collection_state (organization_id, credential_id,
            exchange_account_id, configuration_revision, symbols) VALUES
            ('${assignment.organizationId}', '${assignment.credentialId}', '999999',
             'config-1', '["BTCUSDT"]'::jsonb)`,
          assignment,
        ),
      ).toBe("42501");
      expect(
        await attempt(
          "reader",
          `UPDATE public.trader_account_collection_state SET consecutive_failures=2
            WHERE credential_id='${assignment.credentialId}'`,
          assignment,
        ),
      ).toBe("42501");
    });

    it("grants no role, order, execution or cross-plane authority to any observation login", async () => {
      const roles = ACCOUNT_OBSERVATION_LOGIN_PLAN.flatMap((entry) => [
        entry.loginRole,
        entry.parentRole,
      ]);
      const graph = await admin`
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_roles subject, unnest(${roles}::text[]) AS candidate(name)
          WHERE subject.rolname = candidate.name
            AND pg_has_role(subject.rolname, 'dee1015_cred_owner', 'USAGE')
        ) AS no_owner_authority,
        NOT EXISTS (
          SELECT 1 FROM pg_roles subject, unnest(${roles}::text[]) AS candidate(name)
          WHERE subject.rolname = candidate.name AND (subject.rolsuper OR subject.rolbypassrls)
        ) AS no_superuser_path,
        NOT EXISTS (
          SELECT 1 FROM pg_class relation, unnest(${roles}::text[]) AS candidate(name)
          JOIN pg_roles subject ON subject.rolname = candidate.name
          WHERE relation.relowner = subject.oid
        ) AS owns_no_relation`;
      expect(graph[0]).toMatchObject({
        no_owner_authority: true,
        no_superuser_path: true,
        owns_no_relation: true,
      });

      // No observation identity may reach the historical execution plane.
      const historical = await admin`
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_auth_members m
          JOIN pg_roles member ON member.oid = m.member
          JOIN pg_roles parent ON parent.oid = m.roleid
          WHERE member.rolname = ANY (${roles}) AND parent.rolname LIKE 'waia_historical%'
        ) AS no_historical_membership`;
      expect(historical[0].no_historical_membership).toBe(true);
    });

    it("starts the actual collector through all three provisioned runtime identities", async () => {
      // The three logins carry CONNECTION LIMIT 2, so release the shared qualification clients
      // and let the real host own its own bounded pools.
      for (const client of clients.values()) await client.end({ timeout: 2 }).catch(() => {});
      clients.clear();

      const assignment = manifestAssignment({
        organizationId: randomUUID(),
        credentialId: randomUUID(),
        exchangeAccountId: String(100000 + Math.floor(Math.random() * 800000)),
      });
      const sealed = sealManifest({ assignments: [assignment] });
      const seeded = await seed({
        configurationRevision: assignment.configurationRevision,
        symbols: assignment.symbols,
      });
      // Re-key the manifest onto the actually seeded identity tuple.
      const bound = manifestAssignment({
        organizationId: seeded.organizationId,
        credentialId: seeded.credentialId,
        exchangeAccountId: seeded.exchangeAccountId,
      });
      expect(bound.configurationRevision).toBe(sealed.body.assignments[0]!.configurationRevision);
      const manifest = sealManifest({ assignments: [bound] });
      await admin`UPDATE public.trader_account_collection_state
        SET configuration_revision = ${bound.configurationRevision}
        WHERE credential_id = ${seeded.credentialId}`;

      const directory = mkdtempSync(join(tmpdir(), "dee1015-collector-"));
      const manifestPath = join(directory, "assignments.json");
      writeFileSync(manifestPath, manifest.text, "utf8");

      const requested: string[] = [];
      let firstRequest: (url: string) => void = () => {};
      const reached = new Promise<string>((resolveRequest) => {
        firstRequest = resolveRequest;
      });
      // Synthetic transport: no real HTX host is ever contacted.
      const fetchImpl: typeof fetch = async (input) => {
        const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
        requested.push(url);
        firstRequest(url);
        return new Response(JSON.stringify({ status: "error", "err-code": "synthetic" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const events: string[] = [];
      const controller = new AbortController();
      const previousTier = process.env.WAIA_DEPLOYMENT_TIER;
      process.env.WAIA_DEPLOYMENT_TIER = "production";
      let run: Promise<void> | undefined;
      try {
        run = runAccountObservationCollector({
          env: {
            WAIA_TRADER_CLI: "1",
            WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA,
            WAIA_OBSERVATION_OWNER_ID: "dee1015-qualification",
            WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: manifestPath,
            WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: manifest.digest,
            WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: runtimeUrl("collector"),
            WAIA_OBSERVATION_READER_DATABASE_URL: runtimeUrl("reader"),
            WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: runtimeUrl("credential"),
            WAIA_OBSERVATION_MASTER_KEY: MASTER_KEY,
          },
          signal: controller.signal,
          fetchImpl,
          report: (event) => {
            events.push(event);
          },
        });
        const url = await Promise.race([
          reached,
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("NO_SYNTHETIC_REQUEST")), 20000),
          ),
        ]);
        // Reaching a signed venue read proves the whole bounded chain executed: collector and
        // reader authority, the assignment-bound credential read and the existing decrypt path.
        // The signed key is the synthetic plaintext, so decryption demonstrably succeeded.
        expect(url).toContain("AccessKeyId=synthetic-observation-key");
        expect(url.startsWith("https://api.huobi.pro/")).toBe(true);
        expect(events).toContain("HOST_STARTED");
      } finally {
        controller.abort();
        await run?.catch(() => {});
        if (previousTier === undefined) delete process.env.WAIA_DEPLOYMENT_TIER;
        else process.env.WAIA_DEPLOYMENT_TIER = previousTier;
        rmSync(directory, { recursive: true, force: true });
      }
      // Read-only transport only: no order, cancel, transfer or withdraw endpoint was contacted.
      for (const url of requested) {
        expect(url).not.toMatch(
          /\/order\/orders\/place|batchcancel|submitcancel|transfer|withdraw/,
        );
      }
    }, 60000);

    describe("DEE-1127 actual restricted-session startup admission", () => {
      const login = "waia_account_observation_credential_login";
      const parent = "waia_account_observation_credential";

      async function changedPosture(change: string, restore: string) {
        await expect(probeObservationCredentialPool(open("credential"))).resolves.toBe(login);
        try {
          await admin.unsafe(change);
          await expect(probeObservationCredentialPool(open("credential"))).rejects.toThrow(
            /^OBSERVATION_CREDENTIAL_ROLE_REFUSED$/,
          );
        } finally {
          await admin.unsafe(restore);
          await expect(probeObservationCredentialPool(open("credential"))).resolves.toBe(login);
        }
      }

      it("admits the actual NOINHERIT login without requiring inherited projection privileges; tolerates CONNECT/TEMP", async () => {
        const actual = await open("credential")`
          SELECT session_user::text AS login,
            has_column_privilege(session_user, 'public.exchange_credentials', 'encrypted_payload', 'SELECT') AS login_projection,
            has_column_privilege('waia_account_observation_credential', 'public.exchange_credentials', 'encrypted_payload', 'SELECT') AS parent_projection,
            has_database_privilege(session_user, current_database(), 'CONNECT') AS connect,
            has_database_privilege(session_user, current_database(), 'TEMP') AS temp`;
        expect(actual[0]).toEqual({
          login,
          login_projection: false,
          parent_projection: true,
          connect: true,
          temp: true,
        });
        // Explicit direct TEMP is the same database-ACL exception, not a hidden CONNECT-only claim.
        try {
          await admin.unsafe(`GRANT TEMP ON DATABASE "${database}" TO ${login}`);
          await expect(probeObservationCredentialPool(open("credential"))).resolves.toBe(login);
        } finally {
          await admin.unsafe(`REVOKE TEMP ON DATABASE "${database}" FROM ${login}`);
        }
        const settings = await open("credential")`SHOW transaction_read_only`;
        expect(settings[0].transaction_read_only).toBe("off");
      });

      it("refuses a different actual authenticated login", async () => {
        await expect(probeObservationCredentialPool(open("reader"))).rejects.toThrow(
          /^OBSERVATION_CREDENTIAL_ROLE_REFUSED$/,
        );
      });

      it("refuses a session that already switched current_user", async () => {
        const switched = postgres(runtimeUrl("credential"), {
          max: 1,
          connect_timeout: 3,
          max_lifetime: 60,
          prepare: false,
          connection: { options: "-c role=waia_account_observation_credential" },
        });
        try {
          const identity =
            await switched`SELECT session_user::text AS login, current_user::text AS current`;
          expect(identity[0]).toEqual({ login, current: parent });
          await expect(probeObservationCredentialPool(switched)).rejects.toThrow(
            /^OBSERVATION_CREDENTIAL_ROLE_REFUSED$/,
          );
        } finally {
          await switched.end({ timeout: 2 });
        }
      });

      it.each([
        ["INHERIT", "NOINHERIT"],
        ["SUPERUSER", "NOSUPERUSER"],
        ["BYPASSRLS", "NOBYPASSRLS"],
        ["CREATEDB", "NOCREATEDB"],
        ["CREATEROLE", "NOCREATEROLE"],
        ["REPLICATION", "NOREPLICATION"],
        ["NOLOGIN", "LOGIN"],
        ["CONNECTION LIMIT 3", "CONNECTION LIMIT 2"],
      ])(
        "refuses actual login attribute %s and recovers after exact restoration",
        async (bad, good) => {
          await changedPosture(`ALTER ROLE ${login} ${bad}`, `ALTER ROLE ${login} ${good}`);
        },
      );

      it.each([
        ["LOGIN", "NOLOGIN"],
        ["INHERIT", "NOINHERIT"],
        ["SUPERUSER", "NOSUPERUSER"],
        ["BYPASSRLS", "NOBYPASSRLS"],
        ["CREATEDB", "NOCREATEDB"],
        ["CREATEROLE", "NOCREATEROLE"],
        ["REPLICATION", "NOREPLICATION"],
      ])("refuses actual parent attribute %s and recovers", async (bad, good) => {
        await changedPosture(`ALTER ROLE ${parent} ${bad}`, `ALTER ROLE ${parent} ${good}`);
      });

      it.each(["ADMIN TRUE", "INHERIT TRUE", "SET FALSE"])(
        "refuses membership option %s",
        async (bad) => {
          await changedPosture(
            `GRANT ${parent} TO ${login} WITH ${bad}`,
            `GRANT ${parent} TO ${login} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
          );
        },
      );

      it("refuses missing membership, extra membership and a nested parent", async () => {
        await changedPosture(
          `REVOKE ${parent} FROM ${login}`,
          `GRANT ${parent} TO ${login} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
        );
        await changedPosture(
          `GRANT waia_account_observation_reader TO ${login} WITH INHERIT FALSE, SET TRUE`,
          `REVOKE waia_account_observation_reader FROM ${login}`,
        );
        await changedPosture(
          `GRANT waia_account_observation_reader TO ${parent} WITH INHERIT FALSE, SET TRUE`,
          `REVOKE waia_account_observation_reader FROM ${parent}`,
        );
      });

      it.each([
        ["SELECT (id) ON public.exchange_credentials", login],
        ["USAGE ON SCHEMA public", login],
        ["SELECT ON public.exchange_credentials", parent],
        ["SELECT (api_key_masked) ON public.exchange_credentials", parent],
        ["UPDATE (status) ON public.exchange_credentials", parent],
        ["REFERENCES (id) ON public.exchange_credentials", parent],
        ["TRIGGER ON public.exchange_credentials", parent],
        ["MAINTAIN ON public.exchange_credentials", parent],
        ["SELECT (symbols) ON public.trader_account_collection_state", parent],
        ["SELECT ON public.trader_account_observations", parent],
        ["SELECT (api_key_masked) ON public.exchange_credentials", "PUBLIC"],
        ["DELETE ON public.trader_account_collection_state", "PUBLIC"],
      ])("refuses effective or direct excess grant %s to %s", async (privilege, grantee) => {
        // PostgreSQL REVOKE table SELECT also revokes the original column SELECT ACLs.
        // Restore that exact baseline rather than mistaking a later refusal for a new case.
        const restoreProjection =
          privilege === "SELECT ON public.exchange_credentials" && grantee === parent
            ? `; GRANT SELECT (id, organization_id, exchange_account_id, status, observation_read_only, encrypted_payload,
              payload_key_version, wrapped_dek_key_version, wrapped_dek_key) ON public.exchange_credentials TO ${parent}`
            : "";
        await changedPosture(
          `GRANT ${privilege} TO ${grantee}`,
          `REVOKE ${privilege} FROM ${grantee}${restoreProjection}`,
        );
      });

      it("refuses missing required projection on either relation", async () => {
        for (const projection of [
          "SELECT (encrypted_payload) ON public.exchange_credentials",
          "SELECT (credential_id) ON public.trader_account_collection_state",
        ]) {
          await changedPosture(
            `REVOKE ${projection} FROM ${parent}`,
            `GRANT ${projection} TO ${parent}`,
          );
        }
      });

      it("refuses effective permanent CREATE from database, schema and PUBLIC", async () => {
        for (const grantee of [login, parent, "PUBLIC"]) {
          await changedPosture(
            `GRANT CREATE ON DATABASE "${database}" TO ${grantee}`,
            `REVOKE CREATE ON DATABASE "${database}" FROM ${grantee}`,
          );
          await changedPosture(
            `GRANT CREATE ON SCHEMA public TO ${grantee}`,
            `REVOKE CREATE ON SCHEMA public FROM ${grantee}`,
          );
        }
      });

      it("refuses disabled RLS and missing state FORCE without requiring credential FORCE", async () => {
        for (const relation of ["exchange_credentials", "trader_account_collection_state"]) {
          await changedPosture(
            `ALTER TABLE public.${relation} DISABLE ROW LEVEL SECURITY`,
            `ALTER TABLE public.${relation} ENABLE ROW LEVEL SECURITY`,
          );
        }
        await changedPosture(
          "ALTER TABLE public.trader_account_collection_state NO FORCE ROW LEVEL SECURITY",
          "ALTER TABLE public.trader_account_collection_state FORCE ROW LEVEL SECURITY",
        );
        const bits =
          await admin`SELECT relforcerowsecurity FROM pg_class WHERE oid='public.exchange_credentials'::regclass`;
        expect(bits[0].relforcerowsecurity).toBe(false);
      });

      it("refuses ownership of the current database for either identity", async () => {
        for (const owner of [login, parent]) {
          await changedPosture(
            `ALTER DATABASE "${database}" OWNER TO ${owner}`,
            `ALTER DATABASE "${database}" OWNER TO waia_local_admin`,
          );
        }
      });

      it("refuses object ownership and non-database direct ACL even in another database", async () => {
        const otherDatabase = "dee1127_acl_" + randomUUID().replaceAll("-", "");
        await root.unsafe(`CREATE DATABASE "${otherDatabase}"`);
        const other = postgres(url.replace("/waia_dee960_local", "/" + otherDatabase), {
          max: 1,
          prepare: false,
        });
        try {
          await other`CREATE TABLE public.startup_owned (id int)`;
          try {
            await other.unsafe(`GRANT SELECT ON public.startup_owned TO ${login}`);
            await expect(probeObservationCredentialPool(open("credential"))).rejects.toThrow();
          } finally {
            await other.unsafe(`REVOKE SELECT ON public.startup_owned FROM ${login}`);
          }
          for (const owner of [login, parent]) {
            try {
              await other.unsafe(`ALTER TABLE public.startup_owned OWNER TO ${owner}`);
              await expect(probeObservationCredentialPool(open("credential"))).rejects.toThrow();
            } finally {
              await other.unsafe("ALTER TABLE public.startup_owned OWNER TO waia_local_admin");
            }
          }
        } finally {
          await other.end({ timeout: 2 });
        }
        await expect(probeObservationCredentialPool(open("credential"))).resolves.toBe(login);
      });

      it.each(["probe", "provider"])(
        "actual CLI cancels a late %s completion and eventually closes all real SQL sessions",
        async (stage) => {
          for (const client of clients.values()) await client.end({ timeout: 2 });
          clients.clear();
          const manifest = sealManifest();
          const controller = new AbortController();
          const events: string[] = [];
          const fetchImpl = vi.fn<typeof fetch>();
          let reached!: () => void;
          let deliver!: () => void;
          const entered = new Promise<void>((resolve) => {
            reached = resolve;
          });
          const pending = new Promise<void>((resolve) => {
            deliver = resolve;
          });
          // Both execute their real native/crypto operation before holding only the returned promise.
          // This is a lifecycle barrier, not fabricated SQL posture or a fabricated provider.
          const originalProbe = credentialProbe.probeObservationCredentialPool;
          const originalCreate = SecretsStoreMasterKeyProvider.create;
          const probe = vi.spyOn(credentialProbe, "probeObservationCredentialPool");
          const create = vi.spyOn(SecretsStoreMasterKeyProvider, "create");
          if (stage === "probe")
            probe.mockImplementation(async (sql) => {
              const result = await originalProbe(sql);
              reached();
              await pending;
              return result;
            });
          else
            create.mockImplementation(async (input) => {
              const result = await originalCreate(input);
              reached();
              await pending;
              return result;
            });
          let run: Promise<void> | undefined;
          let deadline: ReturnType<typeof setTimeout> | undefined;
          try {
            run = runAccountObservationCollector({
              env: {
                WAIA_TRADER_CLI: "1",
                WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA,
                WAIA_OBSERVATION_OWNER_ID: "dee1127-cancel",
                WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "/synthetic/native-manifest.json",
                WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: manifest.digest,
                WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: runtimeUrl("collector"),
                WAIA_OBSERVATION_READER_DATABASE_URL: runtimeUrl("reader"),
                WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: runtimeUrl("credential"),
                WAIA_OBSERVATION_MASTER_KEY: MASTER_KEY,
              },
              signal: controller.signal,
              readManifest: () => manifest.text,
              fetchImpl,
              report: (event) => {
                events.push(event);
              },
            });
            await Promise.race([
              entered,
              run.then(() => {
                throw new Error("EARLY_NATIVE_STOP");
              }),
              new Promise<never>((_, reject) => {
                deadline = setTimeout(() => reject(new Error("NATIVE_BARRIER_TIMEOUT")), 10000);
              }),
            ]);
            controller.abort();
            await run;
            expect(events).not.toContain("HOST_STARTED");
            expect(fetchImpl).not.toHaveBeenCalled();
            if (stage === "probe") expect(create).not.toHaveBeenCalled();
            const held = await admin`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=${database} AND application_name='waia-account-observation-credential'`;
            expect(held[0].count).toBe(1); // abort alone has not yet disposed the unreturned resource
            deliver();
            const until = Date.now() + 5000;
            let remaining = 1;
            while (remaining && Date.now() < until) {
              const sessions = await admin`SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE datname=${database} AND application_name LIKE 'waia-account-observation-%'`;
              remaining = sessions[0].count;
              if (remaining) await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(remaining).toBe(0);
            expect(events).not.toContain("HOST_STARTED");
            if (stage === "probe") expect(create).not.toHaveBeenCalled();
          } finally {
            if (deadline) clearTimeout(deadline);
            controller.abort();
            deliver();
            await run?.catch(() => {});
            probe.mockRestore();
            create.mockRestore();
          }
        },
        20000,
      );

      it("the real private CLI factory refuses unsafe SQL before provider/HOST_STARTED/transport, then restarts", async () => {
        for (const client of clients.values()) await client.end({ timeout: 2 });
        clients.clear();
        const manifest = sealManifest();
        const controller = new AbortController();
        const events: string[] = [];
        const fetchImpl = vi.fn<typeof fetch>();
        const create = vi.spyOn(SecretsStoreMasterKeyProvider, "create");
        try {
          await admin.unsafe(`ALTER ROLE ${login} INHERIT`);
          await expect(
            runAccountObservationCollector({
              env: {
                WAIA_TRADER_CLI: "1",
                WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA,
                WAIA_OBSERVATION_OWNER_ID: "dee1127-refusal",
                WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "/synthetic/native-manifest.json",
                WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: manifest.digest,
                WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: runtimeUrl("collector"),
                WAIA_OBSERVATION_READER_DATABASE_URL: runtimeUrl("reader"),
                WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: runtimeUrl("credential"),
                WAIA_OBSERVATION_MASTER_KEY: MASTER_KEY,
              },
              signal: controller.signal,
              readManifest: () => manifest.text,
              fetchImpl,
              report: (event) => {
                events.push(event);
              },
            }),
          ).rejects.toThrow(/^ACCOUNT_OBSERVATION_HOST_FAILED$/);
          expect(create).not.toHaveBeenCalled();
          expect(fetchImpl).not.toHaveBeenCalled();
          expect(events).not.toContain("HOST_STARTED");
          const sessions = await admin`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=${database} AND application_name LIKE 'waia-account-observation-%'`;
          expect(sessions[0].count).toBe(0);
        } finally {
          controller.abort();
          create.mockRestore();
          await admin.unsafe(`ALTER ROLE ${login} NOINHERIT`);
        }
        await expect(probeObservationCredentialPool(open("credential"))).resolves.toBe(login);
        for (const client of clients.values()) await client.end({ timeout: 2 });
        clients.clear();
        const restart = new AbortController();
        await runAccountObservationCollector({
          env: {
            WAIA_TRADER_CLI: "1",
            WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA,
            WAIA_OBSERVATION_OWNER_ID: "dee1127-restart",
            WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "/synthetic/native-manifest.json",
            WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: manifest.digest,
            WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: runtimeUrl("collector"),
            WAIA_OBSERVATION_READER_DATABASE_URL: runtimeUrl("reader"),
            WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: runtimeUrl("credential"),
            WAIA_OBSERVATION_MASTER_KEY: MASTER_KEY,
          },
          signal: restart.signal,
          readManifest: () => manifest.text,
          fetchImpl,
          report: (event) => {
            events.push(event);
            if (event === "HOST_STARTED") restart.abort();
          },
        });
        expect(events).toContain("HOST_STARTED");
        expect(events).toContain("HOST_STOPPED");
        expect(fetchImpl).not.toHaveBeenCalled();
      }, 30000);
    });

    describe("operator refusals", () => {
      /** A private cluster-role sandbox: never the three real runtime identities. */
      async function provisionSandbox(
        plan: Readonly<{ loginRole: string; parentRole: string }>,
        password = "dee1015_sandbox_password_000000000000001",
      ) {
        const { provisionAccountObservationLoginsV1: run } =
          await import("@/scripts/ops/provision-account-observation-logins.mjs");
        return run(
          {
            WAIA_POSTGRES_ADMIN_SESSION_URL: adminSessionUrl,
            SANDBOX_PASSWORD: password,
          },
          {
            plan: [
              {
                purpose: "sandbox",
                loginRole: plan.loginRole,
                parentRole: plan.parentRole,
                passwordEnv: "SANDBOX_PASSWORD",
              },
            ],
          },
        );
      }

      const suffix = () => randomUUID().replaceAll("-", "").slice(0, 12);

      it("refuses an absent parent role", async () => {
        await expect(
          provisionSandbox({
            loginRole: `dee1015_sbx_${suffix()}`,
            parentRole: `dee1015_absent_${suffix()}`,
          }),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:PARENT_ABSENT");
      });

      it("refuses a privileged parent role", async () => {
        const parentRole = `dee1015_priv_parent_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${parentRole}" NOLOGIN NOSUPERUSER CREATEDB`);
        await expect(
          provisionSandbox({ loginRole: `dee1015_sbx_${suffix()}`, parentRole }),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:PARENT_PRIVILEGED");
      });

      it("refuses a parent that can log in or inherits other roles", async () => {
        const canLogin = `dee1015_login_parent_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${canLogin}" LOGIN NOSUPERUSER NOBYPASSRLS`);
        await expect(
          provisionSandbox({ loginRole: `dee1015_sbx_${suffix()}`, parentRole: canLogin }),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:PARENT_CAN_LOGIN");

        const nested = `dee1015_nested_parent_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${nested}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
        await admin.unsafe(`GRANT waia_account_observer TO "${nested}"`);
        await expect(
          provisionSandbox({ loginRole: `dee1015_sbx_${suffix()}`, parentRole: nested }),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:PARENT_MEMBERSHIP");
      });

      it("refuses a login that is not separate from its NOLOGIN parent", async () => {
        await expect(
          provisionSandbox({
            loginRole: "waia_account_observer",
            parentRole: "waia_account_observer",
          }),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:LOGIN_NOT_SEPARATE");
      });

      it("refuses an overprivileged existing login", async () => {
        const parentRole = `dee1015_ok_parent_${suffix()}`;
        const loginRole = `dee1015_priv_login_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${parentRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
        await admin.unsafe(`CREATE ROLE "${loginRole}" LOGIN NOSUPERUSER CREATEROLE`);
        await expect(provisionSandbox({ loginRole, parentRole })).rejects.toThrow(
          "ACCOUNT_OBSERVATION_LOGIN_REFUSED:LOGIN_PRIVILEGED",
        );
      });

      it("refuses an unexpected membership, unsafe options, a direct grant and ownership", async () => {
        const parentRole = `dee1015_ok_parent_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${parentRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);

        const foreign = `dee1015_foreign_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${foreign}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
        const extraMembership = `dee1015_extra_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${extraMembership}" LOGIN NOINHERIT NOSUPERUSER`);
        await admin.unsafe(`GRANT "${foreign}" TO "${extraMembership}"`);
        await expect(provisionSandbox({ loginRole: extraMembership, parentRole })).rejects.toThrow(
          "ACCOUNT_OBSERVATION_LOGIN_REFUSED:UNEXPECTED_MEMBERSHIP",
        );

        const unsafeOptions = `dee1015_unsafe_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${unsafeOptions}" LOGIN NOINHERIT NOSUPERUSER`);
        await admin.unsafe(
          `GRANT "${parentRole}" TO "${unsafeOptions}" WITH ADMIN OPTION, INHERIT TRUE, SET TRUE`,
        );
        await expect(provisionSandbox({ loginRole: unsafeOptions, parentRole })).rejects.toThrow(
          "ACCOUNT_OBSERVATION_LOGIN_REFUSED:MEMBERSHIP_OPTIONS",
        );

        const granted = `dee1015_granted_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${granted}" LOGIN NOINHERIT NOSUPERUSER`);
        await admin.unsafe(`GRANT SELECT ON public.exchange_credentials TO "${granted}"`);
        await expect(provisionSandbox({ loginRole: granted, parentRole })).rejects.toThrow(
          "ACCOUNT_OBSERVATION_LOGIN_REFUSED:DIRECT_GRANT",
        );

        const owner = `dee1015_owner_${suffix()}`;
        const owned = `dee1015_owned_${suffix()}`;
        await admin.unsafe(`CREATE ROLE "${owner}" LOGIN NOINHERIT NOSUPERUSER`);
        await admin.unsafe(`CREATE TABLE public."${owned}" (id int)`);
        await admin.unsafe(`ALTER TABLE public."${owned}" OWNER TO "${owner}"`);
        await expect(provisionSandbox({ loginRole: owner, parentRole })).rejects.toThrow(
          "ACCOUNT_OBSERVATION_LOGIN_REFUSED:OBJECT_OWNERSHIP",
        );
      });

      it("refuses a malformed login name, a weak password and a reused password", async () => {
        await expect(
          provisionSandbox({
            loginRole: 'bad"; DROP TABLE public.exchange_credentials; --',
            parentRole: "waia_account_observer",
          }),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:ROLE_NAME");
        await expect(
          provisionSandbox(
            { loginRole: `dee1015_sbx_${suffix()}`, parentRole: "waia_account_observer" },
            "too-short",
          ),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:PASSWORD_STRENGTH");
        await expect(
          provisionAccountObservationLoginsV1({
            WAIA_POSTGRES_ADMIN_SESSION_URL: adminSessionUrl,
            WAIA_OBSERVATION_COLLECTOR_DB_PASSWORD: PASSWORDS.collector,
            WAIA_OBSERVATION_READER_DB_PASSWORD: PASSWORDS.collector,
            WAIA_OBSERVATION_CREDENTIAL_DB_PASSWORD: PASSWORDS.credential,
          }),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:PASSWORD_REUSE");
      });

      it("refuses a provisioning session that is itself a runtime identity", async () => {
        await expect(
          provisionAccountObservationLoginsV1({
            WAIA_POSTGRES_ADMIN_SESSION_URL: `postgres://waia_account_observer_login:${PASSWORDS.collector}@${HOST}/${database}`,
            WAIA_OBSERVATION_COLLECTOR_DB_PASSWORD: PASSWORDS.collector,
            WAIA_OBSERVATION_READER_DB_PASSWORD: PASSWORDS.reader,
            WAIA_OBSERVATION_CREDENTIAL_DB_PASSWORD: PASSWORDS.credential,
          }),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_LOGIN_REFUSED:ADMIN_ROLE");
      });
    });
  },
);
