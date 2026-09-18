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

import {
  H2_MIGRATION_MANIFEST,
  H2_HUMAN_ATTESTATION_SCHEMA,
  semanticDigest,
  sha256,
  type H2AttestationKind,
  type H2Step,
} from "@/scripts/ops/postgres-h2-migration-manifest-v1";
import {
  computeH2TargetFingerprint,
  readH2LiveJournal,
  readH2TargetIdentity,
  runH2MigrationOperation,
  type H2OperationInput,
  type H2OperatorDependencies,
} from "@/scripts/ops/postgres-h2-migration-operator-v1";
import {
  AUTHORIZED_PARTNER_ALPHA0_ORG_ID,
  LEFTOVER_ORG_SCOPE_POLICY_NAME,
  LEFTOVER_ORG_SCOPE_RELATIONS,
  LEFTOVER_ORG_SCOPE_USING_EXPRESSION,
} from "@/scripts/ops/postgres-h2-leftover-org-scope-policy-v1";
import {
  H2_ORG_SCOPE_HYGIENE_HUMAN_ATTESTATION_SCHEMA,
  leftoverOrgScopeRelationDigest,
  type H2OrgScopeHygieneAttestationKind,
} from "@/scripts/ops/postgres-h2-org-scope-hygiene-manifest-v1";
import {
  computeHygieneTargetFingerprint,
  readHygieneLiveJournal,
  readHygieneTargetIdentity,
  readLeftoverOrgScopePolicies,
  runHygieneOperation,
  type HygieneOperationInput,
} from "@/scripts/ops/postgres-h2-org-scope-hygiene-operator-v1";

const adminUrl = process.env.WAIA_TEST_DEE1010_PG_ADMIN_URL?.trim();
const enabled = Boolean(adminUrl);
const migrationRoot = "db/migrations_postgres";
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "waia-h2-integration-")));
const prelude = readFileSync("scripts/postgres-validation/prelude-auth-stub.sql", "utf8");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const templateDatabase = `waia_h2_1010_template_${suffix}`;
const createdDatabases = new Set<string>();
const humanKeys = generateKeyPairSync("ed25519");
const humanPublicKey = Buffer.from(humanKeys.publicKey.export({ format: "pem", type: "spki" }));
const humanPublicKeySha256 = sha256(humanPublicKey);
const humanPublicKeyPath = join(scratch, "human-public-key.pem");
writeFileSync(humanPublicKeyPath, humanPublicKey, { mode: 0o600 });
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
    throw new Error("DEE1010_OWNED_LOOPBACK_POSTGRES_REQUIRED");
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
    throw new Error("DEE1010_UNSAFE_TEST_IDENTIFIER");
  }
  await admin!.unsafe(
    template ? `CREATE DATABASE "${name}" TEMPLATE "${template}"` : `CREATE DATABASE "${name}"`,
  );
  createdDatabases.add(name);
}

async function cloneDatabase(label: string): Promise<string> {
  const name = `waia_h2_1010_${label}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  await createDatabase(name, templateDatabase);
  return name;
}

async function connectDatabase(name: string, applicationName = "dee1010-test"): Promise<Sql> {
  return postgres(databaseUrl(name), {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    connection: { application_name: applicationName },
    onnotice: () => {},
  });
}

function attestationPath(
  kind: H2AttestationKind,
  step: H2Step,
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
    CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_H2_STEP",
  } as const;
  const body = {
    schemaVersion: H2_HUMAN_ATTESTATION_SCHEMA,
    kind,
    assertion: assertion[kind],
    ceremonyId,
    requestId,
    selectedStep: step,
    targetFingerprint,
    expectedDatabaseName: databaseName,
    expectedMigrationAuthority: migrationAuthority,
    operatorIdentity: "dee1010-local-operator",
    humanApproverIdentity: "dee1010-local-human-fixture",
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
  step: H2Step,
  verifyOnly = false,
): Promise<H2OperationInput> {
  const probe = await connectDatabase(databaseName, "dee1010-identity-probe");
  let identity;
  try {
    identity = await readH2TargetIdentity(probe);
  } finally {
    await probe.end({ timeout: 3 });
  }
  const targetFingerprint = computeH2TargetFingerprint(identity);
  const ceremonyId = randomUUID();
  const requestId = randomUUID();
  return Object.freeze({
    step,
    expectedTargetFingerprint: targetFingerprint,
    databaseUrl: databaseUrl(databaseName),
    repoRoot: process.cwd(),
    verifyOnly,
    confirmedStep: verifyOnly ? undefined : step,
    trustedHumanPublicKeyPath: humanPublicKeyPath,
    restorePointAttestationPath: attestationPath(
      "RESTORE_POINT",
      step,
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    ),
    writerQuiescenceAttestationPath: attestationPath(
      "WRITER_QUIESCENCE",
      step,
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    ),
    targetIdentityAttestationPath: attestationPath(
      "TARGET_IDENTITY",
      step,
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    ),
    ceremonyAuthorizationAttestationPath: attestationPath(
      "CEREMONY_AUTHORIZATION",
      step,
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    ),
  });
}

function runOperation(input: H2OperationInput, dependencies: H2OperatorDependencies = {}) {
  return runH2MigrationOperation(input, {
    ...dependencies,
    approvedHumanKeySha256: humanPublicKeySha256,
  });
}

function hygieneAttestationPath(
  kind: H2OrgScopeHygieneAttestationKind,
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
    CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_ORG_SCOPE_HYGIENE",
  } as const;
  const leftoverDigest = leftoverOrgScopeRelationDigest();
  const body = {
    schemaVersion: H2_ORG_SCOPE_HYGIENE_HUMAN_ATTESTATION_SCHEMA,
    kind,
    assertion: assertion[kind],
    ceremonyId,
    requestId,
    selectedStep: "DROP_ORG_SCOPE" as const,
    targetFingerprint,
    expectedDatabaseName: databaseName,
    expectedMigrationAuthority: migrationAuthority,
    operatorIdentity: "dee1022-local-operator",
    humanApproverIdentity: "dee1022-local-human-fixture",
    leftoverPolicyName: LEFTOVER_ORG_SCOPE_POLICY_NAME,
    leftoverRelationDigest: leftoverDigest,
    authorizedOrganizationId: AUTHORIZED_PARTNER_ALPHA0_ORG_ID,
    evidenceDigestHex:
      kind === "TARGET_IDENTITY"
        ? targetFingerprint
        : kind === "CEREMONY_AUTHORIZATION"
          ? leftoverDigest
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
  const path = join(scratch, `${ceremonyId}-hygiene-${kind.toLowerCase()}.json`);
  writeFileSync(path, JSON.stringify(evidence), { mode: 0o600 });
  return path;
}

async function hygieneOperationInput(databaseName: string): Promise<HygieneOperationInput> {
  const probe = await connectDatabase(databaseName, "dee1022-identity-probe");
  let identity;
  try {
    identity = await readHygieneTargetIdentity(probe);
  } finally {
    await probe.end({ timeout: 3 });
  }
  const targetFingerprint = computeHygieneTargetFingerprint(identity);
  const ceremonyId = randomUUID();
  const requestId = randomUUID();
  return Object.freeze({
    step: "DROP_ORG_SCOPE",
    expectedTargetFingerprint: targetFingerprint,
    databaseUrl: databaseUrl(databaseName),
    repoRoot: process.cwd(),
    verifyOnly: false,
    confirmedStep: "DROP_ORG_SCOPE",
    trustedHumanPublicKeyPath: humanPublicKeyPath,
    restorePointAttestationPath: hygieneAttestationPath(
      "RESTORE_POINT",
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    ),
    writerQuiescenceAttestationPath: hygieneAttestationPath(
      "WRITER_QUIESCENCE",
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    ),
    targetIdentityAttestationPath: hygieneAttestationPath(
      "TARGET_IDENTITY",
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    ),
    ceremonyAuthorizationAttestationPath: hygieneAttestationPath(
      "CEREMONY_AUTHORIZATION",
      targetFingerprint,
      databaseName,
      identity.currentUser,
      ceremonyId,
      requestId,
    ),
  });
}

async function journal(databaseName: string) {
  const sql = await connectDatabase(databaseName);
  try {
    return await readH2LiveJournal(sql);
  } finally {
    await sql.end({ timeout: 3 });
  }
}

describe.skipIf(!enabled)("DEE-1010 owned-local H2 one-step PostgreSQL operator", () => {
  beforeAll(async () => {
    assertOwnedLocalUrl(adminUrl!);
    admin = postgres(adminUrl!, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      connection: { application_name: "dee1010-test-admin" },
      onnotice: () => {},
    });
    await createDatabase(templateDatabase);
    const template = await connectDatabase(templateDatabase);
    try {
      await template.unsafe(prelude).simple();
      const sourceJournal = JSON.parse(
        readFileSync(join(migrationRoot, "meta/_journal.json"), "utf8"),
      ) as Journal;
      const baseline = {
        ...sourceJournal,
        entries: sourceJournal.entries.filter((entry) => entry.idx <= 204),
      };
      const baselineRoot = join(scratch, "baseline-0204");
      mkdirSync(join(baselineRoot, "meta"), { recursive: true });
      writeFileSync(join(baselineRoot, "meta/_journal.json"), JSON.stringify(baseline));
      for (const entry of baseline.entries) {
        copyFileSync(
          join(migrationRoot, `${entry.tag}.sql`),
          join(baselineRoot, `${entry.tag}.sql`),
        );
      }
      await migrate(drizzle(template), { migrationsFolder: baselineRoot });
      await template
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
      expect(await readH2LiveJournal(template)).toHaveLength(205);
    } finally {
      await template.end({ timeout: 3 });
    }
    await admin.unsafe(`ALTER DATABASE "${templateDatabase}" WITH IS_TEMPLATE true`);
  }, 180_000);

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
  }, 60_000);

  it("applies 0205→0208 only through four explicit, separately receipted invocations", async () => {
    const database = await cloneDatabase("ladder");
    let expectedRows = 205;
    for (const step of ["0205", "0206", "0207", "0208"] as const) {
      const receipt = await runOperation(await operationInput(database, step));
      expectedRows += 1;
      expect(receipt).toMatchObject({
        mode: "APPLY",
        classification: "SELECTED_STEP_COMMITTED",
        selectedStep: step,
        nextStepExecuted: false,
        postCommitVerification: {
          readOnlyConnection: true,
          exactJournal: true,
          exactCatalog: true,
          migration0209Observed: false,
        },
      });
      expect(await journal(database)).toHaveLength(expectedRows);
    }
    expect((await journal(database)).at(-1)).toEqual({
      hash: H2_MIGRATION_MANIFEST["0208"].sha256,
      createdAt: String(H2_MIGRATION_MANIFEST["0208"].when),
    });
  }, 180_000);

  it("rolls back exact SQL and journal together when SQL fails", async () => {
    const database = await cloneDatabase("sql_failure");
    const sql = await connectDatabase(database);
    try {
      await sql.unsafe(
        "ALTER TABLE public.exchange_credentials ADD COLUMN observation_revision bigint",
      );
    } finally {
      await sql.end({ timeout: 3 });
    }
    await expect(runOperation(await operationInput(database, "0205"))).rejects.toThrow(
      "TRANSACTION_FAILED",
    );
    expect(await journal(database)).toHaveLength(205);
  }, 60_000);

  it("rolls back SQL and journal when pre-commit catalog verification refuses", async () => {
    const database = await cloneDatabase("catalog_rollback");
    await expect(
      runOperation(await operationInput(database, "0205"), {
        testHooks: {
          async beforeCatalogVerification(sql) {
            expect((await sql`SHOW synchronous_commit`)[0]?.synchronous_commit).toBe("on");
            await sql.unsafe(
              "DROP POLICY trader_observer_state ON public.trader_account_collection_state",
            );
          },
        },
      }),
    ).rejects.toThrow("CATALOG_POLICY");
    expect(await journal(database)).toHaveLength(205);
    const sql = await connectDatabase(database);
    try {
      expect(
        (await sql`SELECT to_regclass('public.trader_account_observations')::text AS name`)[0].name,
      ).toBeNull();
    } finally {
      await sql.end({ timeout: 3 });
    }
  }, 60_000);

  it("fails closed under concurrent operator attempts without duplicate journal identity", async () => {
    const database = await cloneDatabase("concurrent");
    const input = await operationInput(database, "0205");
    const results = await Promise.allSettled([runOperation(input), runOperation(input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rows = await journal(database);
    expect(rows).toHaveLength(206);
    expect(new Set(rows.map((row) => row.createdAt)).size).toBe(rows.length);
  }, 90_000);

  it("observes and refuses a generic 0209 journal commit made while waiting for the lock", async () => {
    const database = await cloneDatabase("concurrent_0209");
    const blocker = await connectDatabase(database, "dee1010-generic-migrator-test");
    await blocker.unsafe("BEGIN");
    try {
      await blocker`
        INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
        VALUES (${"9".repeat(64)},1780000000209)
      `;
      const operation = runOperation(await operationInput(database, "0205"));
      let waitingOnLock = false;
      for (let attempt = 0; attempt < 25 && !waitingOnLock; attempt += 1) {
        const rows = await admin!<Readonly<{ waiting: boolean }>[]>`
          SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity activity
            JOIN pg_locks lock ON lock.pid=activity.pid
            WHERE activity.datname=${database}
              AND activity.application_name='waia-h2-migration-operator-v1'
              AND NOT lock.granted
          ) AS waiting
        `;
        waitingOnLock = rows[0]?.waiting ?? false;
        if (!waitingOnLock) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(waitingOnLock).toBe(true);
      await blocker.unsafe("COMMIT");
      await expect(operation).rejects.toThrow("0209_FORBIDDEN");
    } catch (error) {
      await blocker.unsafe("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await blocker.end({ timeout: 3 });
    }
    expect(await journal(database)).toHaveLength(206);
  }, 90_000);

  it("refuses bounded advisory-lock timeout", async () => {
    const database = await cloneDatabase("lock_timeout");
    const blocker = await connectDatabase(database, "dee1010-lock-test");
    try {
      await blocker`
        SELECT pg_advisory_lock(
          hashtextextended('waia.trader.h2.migration-operator.v1',0)
        )
      `;
      await expect(runOperation(await operationInput(database, "0205"))).rejects.toThrow(
        "LOCK_TIMEOUT",
      );
    } finally {
      await blocker`
        SELECT pg_advisory_unlock(
          hashtextextended('waia.trader.h2.migration-operator.v1',0)
        )
      `;
      await blocker.end({ timeout: 3 });
    }
    expect(await journal(database)).toHaveLength(205);
  }, 60_000);

  it("refuses partial ladders and unknown later journal rows before SQL", async () => {
    const partial = await cloneDatabase("partial");
    const partialSql = await connectDatabase(partial);
    try {
      await partialSql`
        INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
        VALUES (
          ${H2_MIGRATION_MANIFEST["0205"].sha256},
          ${H2_MIGRATION_MANIFEST["0205"].when}
        )
      `;
    } finally {
      await partialSql.end({ timeout: 3 });
    }
    await expect(runOperation(await operationInput(partial, "0207"))).rejects.toThrow(
      "LIVE_JOURNAL_GAP",
    );

    const unknown = await cloneDatabase("unknown");
    const unknownSql = await connectDatabase(unknown);
    try {
      await unknownSql`
        INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
        VALUES (${"f".repeat(64)},1780000000999)
      `;
    } finally {
      await unknownSql.end({ timeout: 3 });
    }
    await expect(runOperation(await operationInput(unknown, "0205"))).rejects.toThrow(
      "LIVE_JOURNAL_EXTRA",
    );
  }, 90_000);

  it("classifies uncertain COMMIT only through read-only verify-only recovery", async () => {
    const database = await cloneDatabase("uncertain");
    const applyInput = await operationInput(database, "0205");
    await expect(
      runOperation(applyInput, {
        testHooks: {
          async afterCommit() {
            throw new Error("DEE1010_SYNTHETIC_COMMIT_ACK_LOSS");
          },
        },
      }),
    ).rejects.toThrow("COMMIT_RESULT_UNCERTAIN");
    const verification = await runOperation({
      ...applyInput,
      verifyOnly: true,
      confirmedStep: undefined,
    });
    expect(verification).toMatchObject({
      mode: "VERIFY_ONLY",
      classification: "SELECTED_STEP_COMMITTED",
      selectedStep: "0205",
      transactionIdentity: null,
      nextStepExecuted: false,
      postCommitVerification: {
        readOnlyConnection: true,
        exactJournal: true,
        exactCatalog: true,
        migration0209Observed: false,
      },
    });
    expect(await journal(database)).toHaveLength(206);
  }, 90_000);

  it("refuses 0206 by named extra-INSERT when leftover org_scope remains", async () => {
    const database = await cloneDatabase("leftover_insert");
    await runOperation(await operationInput(database, "0205"));
    const sql = await connectDatabase(database);
    try {
      await sql.unsafe(`
        CREATE POLICY ${LEFTOVER_ORG_SCOPE_POLICY_NAME}
          ON public.trader_scientific_admission_receipt_v1
          FOR ALL TO waia_historical_runner
          USING ${LEFTOVER_ORG_SCOPE_USING_EXPRESSION}
          WITH CHECK ${LEFTOVER_ORG_SCOPE_USING_EXPRESSION}
      `);
    } finally {
      await sql.end({ timeout: 3 });
    }
    await expect(runOperation(await operationInput(database, "0206"))).rejects.toThrow(
      "CATALOG_0206_EXTRA_INSERT_POLICY",
    );
    expect(await journal(database)).toHaveLength(206);
  }, 90_000);

  it("drops frozen leftover org_scope without advancing the journal, then admits 0206", async () => {
    const database = await cloneDatabase("hygiene");
    await runOperation(await operationInput(database, "0205"));
    const sql = await connectDatabase(database);
    try {
      for (const relation of LEFTOVER_ORG_SCOPE_RELATIONS) {
        await sql.unsafe(`
          CREATE POLICY ${LEFTOVER_ORG_SCOPE_POLICY_NAME}
            ON public.${relation}
            FOR ALL TO waia_historical_runner
            USING ${LEFTOVER_ORG_SCOPE_USING_EXPRESSION}
            WITH CHECK ${LEFTOVER_ORG_SCOPE_USING_EXPRESSION}
        `);
      }
    } finally {
      await sql.end({ timeout: 3 });
    }

    const hygieneInput = await hygieneOperationInput(database);
    const preview = await runHygieneOperation(
      {
        ...hygieneInput,
        verifyOnly: true,
        confirmedStep: undefined,
      },
      { approvedHumanKeySha256: humanPublicKeySha256 },
    );
    expect(preview).toMatchObject({
      mode: "VERIFY_ONLY",
      classification: "LEFTOVER_ORG_SCOPE_PRESENT",
      leftoverCountAfter: 28,
    });

    const receipt = await runHygieneOperation(hygieneInput, {
      approvedHumanKeySha256: humanPublicKeySha256,
    });
    expect(receipt).toMatchObject({
      mode: "APPLY",
      classification: "SELECTED_STEP_COMMITTED",
      leftoverCountBefore: 28,
      leftoverCountAfter: 0,
      nextStepExecuted: false,
      postCommitVerification: {
        leftoverDropped: true,
        journalUnchanged: true,
        policiesCreated: false,
        genericMigratorUsed: false,
      },
    });
    expect(await journal(database)).toHaveLength(206);
    const after = await connectDatabase(database);
    try {
      expect(await readLeftoverOrgScopePolicies(after)).toEqual([]);
      expect(await readHygieneLiveJournal(after)).toHaveLength(206);
    } finally {
      await after.end({ timeout: 3 });
    }

    const step0206 = await runOperation(await operationInput(database, "0206"));
    expect(step0206).toMatchObject({
      classification: "SELECTED_STEP_COMMITTED",
      selectedStep: "0206",
    });
    expect(await journal(database)).toHaveLength(207);
  }, 180_000);
});
