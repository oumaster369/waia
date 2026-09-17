import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
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

import { H2_MIGRATION_MANIFEST } from "@/scripts/ops/postgres-h2-migration-manifest-v1";
import {
  POST_H2_HUMAN_ATTESTATION_SCHEMA,
  POST_H2_MIGRATION_MANIFEST,
  semanticDigest,
  sha256,
  type PostH2AttestationKind,
  type PostH2Step,
} from "@/scripts/ops/postgres-post-h2-migration-manifest-v1";
import {
  computePostH2TargetFingerprint,
  readPostH2LiveJournal,
  readPostH2TargetIdentity,
  runPostH2MigrationOperation,
  type PostH2OperationInput,
  type PostH2OperatorDependencies,
} from "@/scripts/ops/postgres-post-h2-migration-operator-v1";

const adminUrl = process.env.WAIA_TEST_DEE1018_PG_ADMIN_URL?.trim();
const enabled = Boolean(adminUrl);
const migrationRoot = "db/migrations_postgres";
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "waia-post-h2-integration-")));
const prelude = readFileSync("scripts/postgres-validation/prelude-auth-stub.sql", "utf8");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const templateDatabase = `waia_posth2_1018_template_${suffix}`;
const createdDatabases = new Set<string>();
const humanKeys = generateKeyPairSync("ed25519");
const humanPublicKey = Buffer.from(humanKeys.publicKey.export({ format: "pem", type: "spki" }));
const humanPublicKeySha256 = sha256(humanPublicKey);
const humanPublicKeyPath = join(scratch, "human-public-key.pem");
writeFileSync(humanPublicKeyPath, humanPublicKey, { mode: 0o600 });
/** The exact journal length after 0000..0208, i.e. the state the frozen H2 lane leaves behind. */
const JOURNAL_ROWS_THROUGH_0208 = 209;
let admin: Sql | undefined;

type Journal = Readonly<{
  entries: readonly Readonly<{
    idx: number;
    when: number;
    tag: string;
    version: string;
    breakpoints: boolean;
  }>[];
}>;

function assertOwnedLocalUrl(value: string): URL {
  const parsed = new URL(value);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("DEE1018_OWNED_LOOPBACK_POSTGRES_REQUIRED");
  }
  return parsed;
}

function databaseUrl(name: string): string {
  const parsed = assertOwnedLocalUrl(adminUrl!);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createDatabase(name: string, template?: string): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(name) || (template && !/^[a-z0-9_]+$/.test(template))) {
    throw new Error("DEE1018_UNSAFE_TEST_IDENTIFIER");
  }
  // PostgreSQL truncates at NAMEDATALEN-1, which would silently break target-identity binding.
  if (Buffer.byteLength(name, "utf8") > 63) {
    throw new Error("DEE1018_TEST_DATABASE_NAME_TOO_LONG");
  }
  await admin!.unsafe(
    template ? `CREATE DATABASE "${name}" TEMPLATE "${template}"` : `CREATE DATABASE "${name}"`,
  );
  createdDatabases.add(name);
}

async function cloneDatabase(label: string): Promise<string> {
  const name = `waia_posth2_1018_${label}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  await createDatabase(name, templateDatabase);
  return name;
}

/**
 * Application names deliberately avoid the operator's quiescence vocabulary so that harness
 * connections are never mistaken for Trader or AI-TWIN writers.
 */
async function connectDatabase(name: string, applicationName = "dee1018-test"): Promise<Sql> {
  return postgres(databaseUrl(name), {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    connection: { application_name: applicationName },
    onnotice: () => {},
  });
}

function attestationPath(
  kind: PostH2AttestationKind,
  step: PostH2Step,
  targetFingerprint: string,
  databaseName: string,
  migrationAuthority: string,
  ceremonyId: string,
  requestId: string,
): string {
  const assertion = {
    RESTORE_POINT: "APPROVED_RESTORE_POINT_AVAILABLE",
    WRITER_QUIESCENCE: "WRITERS_QUIESCED",
    TARGET_IDENTITY: "TARGET_IDENTITY_APPROVED",
    CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_POST_H2_STEP",
  } as const;
  const body = {
    schemaVersion: POST_H2_HUMAN_ATTESTATION_SCHEMA,
    kind,
    assertion: assertion[kind],
    ceremonyId,
    requestId,
    selectedStep: step,
    targetFingerprint,
    expectedDatabaseName: databaseName,
    expectedMigrationAuthority: migrationAuthority,
    operatorIdentity: "dee1018-local-operator",
    humanApproverIdentity: "dee1018-local-human-fixture",
    evidenceDigestHex:
      kind === "TARGET_IDENTITY"
        ? targetFingerprint
        : createHash("sha256").update(`${kind}:${ceremonyId}`).digest("hex"),
    signingKeySha256: humanPublicKeySha256,
    issuedAt: new Date().toISOString(),
  } as const;
  const contentDigestHex = semanticDigest(body);
  const evidence = {
    ...body,
    contentDigestHex,
    signatureBase64: sign(
      null,
      Buffer.from(contentDigestHex, "utf8"),
      humanKeys.privateKey,
    ).toString("base64"),
  };
  const path = join(scratch, `${ceremonyId}-${kind.toLowerCase()}.json`);
  writeFileSync(path, JSON.stringify(evidence), { mode: 0o600 });
  return path;
}

async function operationInput(
  databaseName: string,
  step: PostH2Step,
  verifyOnly = false,
): Promise<PostH2OperationInput> {
  const probe = await connectDatabase(databaseName, "dee1018-identity-probe");
  let identity;
  try {
    identity = await readPostH2TargetIdentity(probe);
  } finally {
    await probe.end({ timeout: 3 });
  }
  const targetFingerprint = computePostH2TargetFingerprint(identity);
  const ceremonyId = randomUUID();
  const requestId = randomUUID();
  const mint = (kind: PostH2AttestationKind): string =>
    attestationPath(
      kind,
      step,
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    );
  return Object.freeze({
    step,
    expectedTargetFingerprint: targetFingerprint,
    databaseUrl: databaseUrl(databaseName),
    repoRoot: process.cwd(),
    verifyOnly,
    confirmedStep: verifyOnly ? undefined : step,
    trustedHumanPublicKeyPath: humanPublicKeyPath,
    restorePointAttestationPath: mint("RESTORE_POINT"),
    writerQuiescenceAttestationPath: mint("WRITER_QUIESCENCE"),
    targetIdentityAttestationPath: mint("TARGET_IDENTITY"),
    ceremonyAuthorizationAttestationPath: mint("CEREMONY_AUTHORIZATION"),
  });
}

function runOperation(
  input: PostH2OperationInput,
  dependencies: PostH2OperatorDependencies = {},
): ReturnType<typeof runPostH2MigrationOperation> {
  return runPostH2MigrationOperation(input, {
    ...dependencies,
    approvedHumanKeySha256: humanPublicKeySha256,
  });
}

async function journal(databaseName: string) {
  const sql = await connectDatabase(databaseName);
  try {
    return await readPostH2LiveJournal(sql);
  } finally {
    await sql.end({ timeout: 3 });
  }
}

async function withSql<T>(databaseName: string, run: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = await connectDatabase(databaseName);
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 3 });
  }
}

async function insertJournalRow(
  databaseName: string,
  hash: string,
  createdAt: number,
): Promise<void> {
  await withSql(databaseName, async (sql) => {
    await sql`
      INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES (${hash},${createdAt})
    `;
  });
}

/**
 * Migration 0210's role is cluster-wide and outlives a dropped database, so application is asserted
 * through its two database-scoped policies.
 */
async function credentialPolicyCount(databaseName: string): Promise<number> {
  return withSql(databaseName, async (sql) => {
    const rows = await sql<Readonly<{ total: string }>[]>`
      SELECT count(*)::text AS total FROM pg_policy
      WHERE polname IN ('trader_observation_credential_assignment',
        'trader_observation_credential_read')
    `;
    return Number(rows[0]?.total ?? "-1");
  });
}

async function apply0209(label: string): Promise<string> {
  const database = await cloneDatabase(label);
  const receipt = await runOperation(await operationInput(database, "0209"));
  expect(receipt.classification).toBe("SELECTED_STEP_COMMITTED");
  return database;
}

describe.skipIf(!enabled)("DEE-1018 ordered post-H2 exact-one-step PostgreSQL operator", () => {
  beforeAll(async () => {
    assertOwnedLocalUrl(adminUrl!);
    admin = postgres(adminUrl!, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      connection: { application_name: "dee1018-test-admin" },
      onnotice: () => {},
    });
    await createDatabase(templateDatabase);
    const template = await connectDatabase(templateDatabase);
    try {
      await template.unsafe(prelude).simple();
      const sourceJournal = JSON.parse(
        readFileSync(join(migrationRoot, "meta/_journal.json"), "utf8"),
      ) as Journal;
      // The lawful entry state for this lane: exactly what H2 leaves at 0208, and nothing after.
      const baseline = {
        ...sourceJournal,
        entries: sourceJournal.entries.filter((entry) => entry.idx <= 208),
      };
      const baselineRoot = join(scratch, "baseline-0208");
      mkdirSync(join(baselineRoot, "meta"), { recursive: true });
      writeFileSync(join(baselineRoot, "meta/_journal.json"), JSON.stringify(baseline));
      for (const entry of baseline.entries) {
        copyFileSync(
          join(migrationRoot, `${entry.tag}.sql`),
          join(baselineRoot, `${entry.tag}.sql`),
        );
      }
      await migrate(drizzle(template), { migrationsFolder: baselineRoot });
      const rows = await readPostH2LiveJournal(template);
      expect(rows).toHaveLength(JOURNAL_ROWS_THROUGH_0208);
      expect(rows.at(-1)).toEqual({
        hash: H2_MIGRATION_MANIFEST["0208"].sha256,
        createdAt: String(H2_MIGRATION_MANIFEST["0208"].when),
      });
    } finally {
      await template.end({ timeout: 3 });
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
      await admin.end({ timeout: 3 });
    }
    rmSync(scratch, { recursive: true, force: true });
  }, 120_000);

  it("advances 0208→0209→0210 only through two separate authorized invocations", async () => {
    const database = await cloneDatabase("ordered");
    const first = await runOperation(await operationInput(database, "0209"));
    expect(first).toMatchObject({
      mode: "APPLY",
      classification: "SELECTED_STEP_COMMITTED",
      selectedStep: "0209",
      predecessorMigration: "0208",
      sourceCommit: POST_H2_MIGRATION_MANIFEST["0209"].sourceCommit,
      sourceBlob: POST_H2_MIGRATION_MANIFEST["0209"].sourceBlob,
      sourceSha256: POST_H2_MIGRATION_MANIFEST["0209"].sha256,
      nextStepExecuted: false,
      postCommitVerification: {
        readOnlyConnection: true,
        exactJournal: true,
        exactCatalog: true,
        genericMigratorUsed: false,
        aiTwinRuntimeActivated: false,
      },
    });
    const afterFirst = await journal(database);
    expect(afterFirst).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
    expect(afterFirst.at(-1)).toEqual({
      hash: POST_H2_MIGRATION_MANIFEST["0209"].sha256,
      createdAt: String(POST_H2_MIGRATION_MANIFEST["0209"].when),
    });
    // The 0209 receipt must not have carried 0210 with it.
    await expect(credentialPolicyCount(database)).resolves.toBe(0);

    const second = await runOperation(await operationInput(database, "0210"));
    expect(second).toMatchObject({
      mode: "APPLY",
      classification: "SELECTED_STEP_COMMITTED",
      selectedStep: "0210",
      predecessorMigration: "0209",
      sourceSha256: POST_H2_MIGRATION_MANIFEST["0210"].sha256,
      nextStepExecuted: false,
    });
    const afterSecond = await journal(database);
    expect(afterSecond).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 2);
    expect(afterSecond.at(-1)).toEqual({
      hash: POST_H2_MIGRATION_MANIFEST["0210"].sha256,
      createdAt: String(POST_H2_MIGRATION_MANIFEST["0210"].when),
    });
    expect(new Set(afterSecond.map((row) => row.createdAt)).size).toBe(afterSecond.length);
  }, 300_000);

  it("refuses sparse 0210 while 0209 is unapplied", async () => {
    const database = await cloneDatabase("sparse");
    await expect(runOperation(await operationInput(database, "0210"))).rejects.toThrow(
      "LIVE_JOURNAL_GAP",
    );
    expect(await journal(database)).toHaveLength(JOURNAL_ROWS_THROUGH_0208);
    await expect(credentialPolicyCount(database)).resolves.toBe(0);
  }, 120_000);

  it("refuses a journal where 0210 is recorded but 0209 is absent", async () => {
    const database = await cloneDatabase("absent_0209");
    await insertJournalRow(
      database,
      POST_H2_MIGRATION_MANIFEST["0210"].sha256,
      POST_H2_MIGRATION_MANIFEST["0210"].when,
    );
    await expect(runOperation(await operationInput(database, "0209"))).rejects.toThrow(
      "LIVE_JOURNAL_EXTRA",
    );
    await expect(runOperation(await operationInput(database, "0210"))).rejects.toThrow(
      "LIVE_JOURNAL_CREATED_AT_MISMATCH",
    );
  }, 120_000);

  it("refuses wrong 0209 and wrong 0210 journal identities", async () => {
    const wrongHash = await cloneDatabase("wrong_0209_hash");
    await insertJournalRow(wrongHash, "a".repeat(64), POST_H2_MIGRATION_MANIFEST["0209"].when);
    await expect(runOperation(await operationInput(wrongHash, "0210"))).rejects.toThrow(
      "LIVE_JOURNAL_HASH_MISMATCH",
    );

    const wrongWhen = await cloneDatabase("wrong_0209_when");
    await insertJournalRow(wrongWhen, POST_H2_MIGRATION_MANIFEST["0209"].sha256, 1780000000299);
    await expect(runOperation(await operationInput(wrongWhen, "0210"))).rejects.toThrow(
      "LIVE_JOURNAL_CREATED_AT_MISMATCH",
    );

    const wrong0210 = await apply0209("wrong_0210_identity");
    await insertJournalRow(wrong0210, "b".repeat(64), POST_H2_MIGRATION_MANIFEST["0210"].when);
    await expect(runOperation(await operationInput(wrong0210, "0210"))).rejects.toThrow(
      "LIVE_JOURNAL_EXTRA",
    );
  }, 300_000);

  it("refuses unknown, later and duplicate journal identities", async () => {
    const later = await cloneDatabase("later");
    await insertJournalRow(later, "c".repeat(64), 1780000000211);
    await expect(runOperation(await operationInput(later, "0209"))).rejects.toThrow(
      "LIVE_JOURNAL_EXTRA",
    );

    const unknown = await cloneDatabase("unknown");
    await insertJournalRow(unknown, "d".repeat(64), 1770000000000);
    await expect(runOperation(await operationInput(unknown, "0209"))).rejects.toThrow(
      /LIVE_JOURNAL_(CREATED_AT_MISMATCH|EXTRA)/,
    );

    const duplicate = await cloneDatabase("duplicate");
    await insertJournalRow(
      duplicate,
      H2_MIGRATION_MANIFEST["0208"].sha256,
      H2_MIGRATION_MANIFEST["0208"].when,
    );
    await expect(runOperation(await operationInput(duplicate, "0209"))).rejects.toThrow(
      "LIVE_JOURNAL_DUPLICATE",
    );
  }, 180_000);

  it("refuses partial catalog state that the journal alone cannot express", async () => {
    const halfApplied = await cloneDatabase("half_0209");
    await withSql(halfApplied, async (sql) => {
      await sql.unsafe("CREATE TABLE public.ai_twin_observations(id uuid PRIMARY KEY)");
    });
    await expect(runOperation(await operationInput(halfApplied, "0209"))).rejects.toThrow(
      "CATALOG_PRECONDITION",
    );

    // A journal row for 0209 whose objects do not exist is a forged history, not a lawful state.
    const forged = await cloneDatabase("forged_0209");
    await insertJournalRow(
      forged,
      POST_H2_MIGRATION_MANIFEST["0209"].sha256,
      POST_H2_MIGRATION_MANIFEST["0209"].when,
    );
    await expect(runOperation(await operationInput(forged, "0210"))).rejects.toThrow(
      "CATALOG_PRECONDITION",
    );

    const halfApplied0210 = await apply0209("half_0210");
    await withSql(halfApplied0210, async (sql) => {
      await sql.unsafe(`
        CREATE POLICY trader_observation_credential_assignment
          ON public.trader_account_collection_state
          FOR SELECT TO waia_account_observer USING (true)
      `);
    });
    await expect(runOperation(await operationInput(halfApplied0210, "0210"))).rejects.toThrow(
      "CATALOG_PRECONDITION",
    );
  }, 300_000);

  it("refuses a second invocation of an already applied step", async () => {
    const database = await apply0209("idempotence");
    await expect(runOperation(await operationInput(database, "0209"))).rejects.toThrow(
      "LIVE_JOURNAL_EXTRA",
    );
    expect(await journal(database)).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
  }, 180_000);

  it("executes the pinned Git blob and ignores mutated checkout content", async () => {
    const database = await cloneDatabase("pinned_source");
    const path = join(migrationRoot, "0209_ai_twin_epistemic_persistence_v1.sql");
    const original = readFileSync(path);
    writeFileSync(path, Buffer.concat([original, Buffer.from("\nSELECT 1/0;\n")]));
    try {
      const receipt = await runOperation(await operationInput(database, "0209"));
      expect(receipt.sourceSha256).toBe(POST_H2_MIGRATION_MANIFEST["0209"].sha256);
      expect((await journal(database)).at(-1)?.hash).toBe(
        POST_H2_MIGRATION_MANIFEST["0209"].sha256,
      );
    } finally {
      writeFileSync(path, original);
    }
  }, 180_000);

  it("classifies uncertain COMMIT only through read-only verify-only recovery", async () => {
    const database = await cloneDatabase("uncertain");
    const applyInput = await operationInput(database, "0209");
    await expect(
      runOperation(applyInput, {
        testHooks: {
          async afterCommit() {
            throw new Error("DEE1018_SYNTHETIC_COMMIT_ACK_LOSS");
          },
        },
      }),
    ).rejects.toThrow("COMMIT_RESULT_UNCERTAIN");
    expect(
      await runOperation({ ...applyInput, verifyOnly: true, confirmedStep: undefined }),
    ).toMatchObject({
      mode: "VERIFY_ONLY",
      classification: "SELECTED_STEP_COMMITTED",
      selectedStep: "0209",
      transactionIdentity: null,
      nextStepExecuted: false,
      postCommitVerification: { exactCatalog: true, genericMigratorUsed: false },
    });
    expect(await journal(database)).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
  }, 180_000);

  it("classifies a still-unapplied step and refuses a contradictory journal", async () => {
    const pending = await cloneDatabase("verify_pending");
    expect(await runOperation(await operationInput(pending, "0209", true))).toMatchObject({
      mode: "VERIFY_ONLY",
      classification: "PREDECESSOR_NOT_APPLIED",
      catalogVerificationDigest: null,
      transactionIdentity: null,
    });

    const contradiction = await cloneDatabase("verify_contradiction");
    await insertJournalRow(contradiction, "e".repeat(64), 1780000000298);
    await expect(runOperation(await operationInput(contradiction, "0209", true))).rejects.toThrow(
      /LIVE_JOURNAL_/,
    );
    expect(await journal(contradiction)).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
  }, 180_000);

  it("rolls back SQL and journal together when pre-commit verification refuses", async () => {
    const database = await cloneDatabase("rollback");
    await expect(
      runOperation(await operationInput(database, "0209"), {
        testHooks: {
          async beforeCatalogVerification(sql) {
            expect((await sql`SHOW synchronous_commit`)[0]?.synchronous_commit).toBe("on");
            await sql.unsafe("GRANT SELECT ON public.ai_twin_observations TO authenticated");
          },
        },
      }),
    ).rejects.toThrow("CATALOG_0209_GRANTS");
    expect(await journal(database)).toHaveLength(JOURNAL_ROWS_THROUGH_0208);
    await withSql(database, async (sql) => {
      const rows = await sql`SELECT to_regclass('public.ai_twin_observations')::text AS name`;
      expect(rows[0]?.name).toBeNull();
    });
  }, 180_000);

  it("rolls back 0210 when its DEE-1015 security contract is violated in flight", async () => {
    const widened = await apply0209("security_rollback_full_table");
    await expect(
      runOperation(await operationInput(widened, "0210"), {
        testHooks: {
          async beforeCatalogVerification(sql) {
            await sql.unsafe(
              "GRANT SELECT ON public.exchange_credentials TO waia_account_observation_credential",
            );
          },
        },
      }),
    ).rejects.toThrow(/CATALOG_0210_(COLUMN_)?GRANTS/);
    expect(await journal(widened)).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
    await expect(credentialPolicyCount(widened)).resolves.toBe(0);

    // The observer must never gain ciphertext access, even as a side effect of this lane.
    const ciphertext = await apply0209("security_rollback_ciphertext");
    await expect(
      runOperation(await operationInput(ciphertext, "0210"), {
        testHooks: {
          async beforeCatalogVerification(sql) {
            await sql.unsafe(`
              GRANT SELECT (encrypted_payload) ON public.exchange_credentials
                TO waia_account_observer
            `);
          },
        },
      }),
    ).rejects.toThrow("CATALOG_0210_GRANTS");
    await expect(credentialPolicyCount(ciphertext)).resolves.toBe(0);
  }, 420_000);

  it("rolls back 0210 when the credential authority is granted to a foreign role", async () => {
    const database = await apply0209("reverse_membership");
    await expect(
      runOperation(await operationInput(database, "0210"), {
        testHooks: {
          async beforeCatalogVerification(sql) {
            // A CREATEROLE actor's lateral path: the role posture, policies, column grants and the
            // pinned membership digest all still match, because none of them look at who holds
            // this authority. Created inside the operator transaction, so rollback removes it.
            await sql.unsafe("CREATE ROLE waia_dee1018_probe_consumer NOLOGIN");
            await sql.unsafe(
              "GRANT waia_account_observation_credential TO waia_dee1018_probe_consumer",
            );
          },
        },
      }),
    ).rejects.toThrow("CATALOG_0210_ROLE_GRANTEES");
    expect(await journal(database)).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
    await expect(credentialPolicyCount(database)).resolves.toBe(0);
    await withSql(database, async (sql) => {
      const rows = await sql<Readonly<{ total: string }>[]>`
        SELECT count(*)::text AS total FROM pg_roles
        WHERE rolname='waia_dee1018_probe_consumer'
      `;
      expect(rows[0]?.total).toBe("0");
    });
  }, 420_000);

  it("rolls back 0210 when row-level security is disabled on the credential table", async () => {
    const database = await apply0209("security_rollback_row_security");
    await expect(
      runOperation(await operationInput(database, "0210"), {
        testHooks: {
          async beforeCatalogVerification(sql) {
            // Without RLS the narrow eight-column grant reads every tenant's ciphertext row, so the
            // assignment-bound policies this lane just created would be inert.
            await sql.unsafe("ALTER TABLE public.exchange_credentials DISABLE ROW LEVEL SECURITY");
          },
        },
      }),
    ).rejects.toThrow("CATALOG_0210_ROW_SECURITY");
    expect(await journal(database)).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
    await expect(credentialPolicyCount(database)).resolves.toBe(0);
    await withSql(database, async (sql) => {
      const rows = await sql<Readonly<{ row_security: boolean }>[]>`
        SELECT relrowsecurity AS row_security FROM pg_class
        WHERE oid='public.exchange_credentials'::regclass
      `;
      expect(rows[0]?.row_security).toBe(true);
    });
  }, 420_000);

  it("refuses verify-only recovery when the catalog contradicts a lawful predecessor journal", async () => {
    // Journal exactly through 0208, so 0209 is genuinely unapplied — but a stray AI-TWIN object
    // means this target is not cleanly awaiting 0209 and must not be receipted as if it were.
    const stray = await cloneDatabase("verify_only_stray_twin");
    await withSql(stray, async (sql) => {
      await sql.unsafe("CREATE TABLE public.ai_twin_stray_probe(id uuid PRIMARY KEY)");
    });
    await expect(runOperation(await operationInput(stray, "0209", true))).rejects.toThrow(
      "CATALOG_PRECONDITION",
    );

    // Journal exactly through 0209, so 0210 is genuinely unapplied — but the recorded 0209 history
    // is contradicted by a missing table, which the journal alone cannot express.
    const forged = await apply0209("verify_only_missing_twin_table");
    await withSql(forged, async (sql) => {
      await sql.unsafe("DROP TABLE public.ai_twin_working_hypotheses");
    });
    await expect(runOperation(await operationInput(forged, "0210", true))).rejects.toThrow(
      "CATALOG_PRECONDITION",
    );
  }, 420_000);

  it("fails closed under concurrent invocations without duplicating a journal identity", async () => {
    const database = await cloneDatabase("concurrent");
    const input = await operationInput(database, "0209");
    const results = await Promise.allSettled([runOperation(input), runOperation(input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rows = await journal(database);
    expect(rows).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
    expect(new Set(rows.map((row) => row.createdAt)).size).toBe(rows.length);
  }, 300_000);

  it("observes and refuses a generic high-water journal commit made while waiting for the lock", async () => {
    const database = await cloneDatabase("generic_migrator");
    const blocker = await connectDatabase(database, "dee1018-generic-migrator-probe");
    await blocker.unsafe("BEGIN");
    try {
      // Exactly what `drizzle-kit migrate` would do from a 0208 journal: apply 0209 and 0210.
      await blocker`
        INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
        VALUES (${POST_H2_MIGRATION_MANIFEST["0210"].sha256},1780000000210)
      `;
      const operation = runOperation(await operationInput(database, "0209"));
      let waiting = false;
      for (let attempt = 0; attempt < 25 && !waiting; attempt += 1) {
        const rows = await admin!<Readonly<{ waiting: boolean }>[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity activity
            JOIN pg_locks lock ON lock.pid=activity.pid
            WHERE activity.datname=${database}
              AND activity.application_name='waia-post-h2-migration-operator-v1'
              AND NOT lock.granted
          ) AS waiting
        `;
        waiting = rows[0]?.waiting ?? false;
        if (!waiting) await new Promise((done) => setTimeout(done, 100));
      }
      expect(waiting).toBe(true);
      await blocker.unsafe("COMMIT");
      await expect(operation).rejects.toThrow("LIVE_JOURNAL_EXTRA");
    } catch (error) {
      await blocker.unsafe("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await blocker.end({ timeout: 3 });
    }
    expect(await journal(database)).toHaveLength(JOURNAL_ROWS_THROUGH_0208 + 1);
  }, 180_000);

  it("refuses a bounded advisory-lock timeout without touching the journal", async () => {
    const database = await cloneDatabase("lock_timeout");
    const blocker = await connectDatabase(database, "dee1018-lock-probe");
    try {
      await blocker`
        SELECT pg_advisory_lock(
          hashtextextended('waia.trader.post-h2.migration-operator.v1',0)
        )
      `;
      await expect(runOperation(await operationInput(database, "0209"))).rejects.toThrow(
        "LOCK_TIMEOUT",
      );
    } finally {
      await blocker`
        SELECT pg_advisory_unlock(
          hashtextextended('waia.trader.post-h2.migration-operator.v1',0)
        )
      `;
      await blocker.end({ timeout: 3 });
    }
    expect(await journal(database)).toHaveLength(JOURNAL_ROWS_THROUGH_0208);
  }, 180_000);

  it("proves the DEE-1015 credential boundary and DEE-871 isolation after the ordered lane", async () => {
    const database = await cloneDatabase("contracts");
    await runOperation(await operationInput(database, "0209"));
    await runOperation(await operationInput(database, "0210"));
    await withSql(database, async (sql) => {
      const security = (
        await sql<
          Readonly<{
            whole_table_select: boolean;
            credential_insert: boolean;
            credential_update: boolean;
            credential_delete: boolean;
            observer_ciphertext: boolean;
            reader_ciphertext: boolean;
            observer_wrapped: boolean;
            reader_wrapped: boolean;
            credential_memberships: string;
            twin_reachable_by_authenticated: boolean;
            force_rls: boolean;
          }>[]
        >`
        SELECT
          has_table_privilege('waia_account_observation_credential',
            'public.exchange_credentials','SELECT') AS whole_table_select,
          has_table_privilege('waia_account_observation_credential',
            'public.exchange_credentials','INSERT') AS credential_insert,
          has_table_privilege('waia_account_observation_credential',
            'public.exchange_credentials','UPDATE') AS credential_update,
          has_table_privilege('waia_account_observation_credential',
            'public.exchange_credentials','DELETE') AS credential_delete,
          has_column_privilege('waia_account_observer','public.exchange_credentials',
            'encrypted_payload','SELECT') AS observer_ciphertext,
          has_column_privilege('waia_account_observation_reader','public.exchange_credentials',
            'encrypted_payload','SELECT') AS reader_ciphertext,
          has_column_privilege('waia_account_observer','public.exchange_credentials',
            'wrapped_dek_key','SELECT') AS observer_wrapped,
          has_column_privilege('waia_account_observation_reader','public.exchange_credentials',
            'wrapped_dek_key','SELECT') AS reader_wrapped,
          (
            SELECT count(*)::text FROM pg_auth_members membership
            JOIN pg_roles member ON member.oid=membership.member
            WHERE member.rolname='waia_account_observation_credential'
          ) AS credential_memberships,
          has_table_privilege('authenticated','public.ai_twin_observations','SELECT')
            AS twin_reachable_by_authenticated,
          (
            SELECT relforcerowsecurity FROM pg_class
            WHERE oid='public.exchange_credentials'::regclass
          ) AS force_rls
      `
      )[0];
      expect(security).toEqual({
        whole_table_select: false,
        credential_insert: false,
        credential_update: false,
        credential_delete: false,
        observer_ciphertext: false,
        reader_ciphertext: false,
        observer_wrapped: false,
        reader_wrapped: false,
        credential_memberships: "0",
        twin_reachable_by_authenticated: false,
        force_rls: false,
      });
      const policies = await sql<Readonly<{ polname: string; expression: string }>[]>`
        SELECT policy.polname, pg_get_expr(policy.polqual,policy.polrelid) AS expression
        FROM pg_policy policy
        WHERE policy.polname IN ('trader_observation_credential_assignment',
          'trader_observation_credential_read')
        ORDER BY policy.polname
      `;
      expect(policies).toHaveLength(2);
      for (const policy of policies) {
        expect(policy.expression).toContain("waia.observation_org");
        expect(policy.expression.trim()).not.toBe("true");
      }
    });
  }, 300_000);
});
