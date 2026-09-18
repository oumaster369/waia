/**
 * DEE-1022: fail-closed leftover `org_scope` hygiene operator.
 *
 * One Human-authorized invocation DROPs the frozen leftover permissive ALL policies and
 * nothing else. The Drizzle journal must remain exact `0000..0205`. H2 0206 is a later,
 * separate ceremony.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import postgres from "postgres";

import {
  assertExactJournal,
  loadH2CanonicalSource,
  type H2AppliedMigration,
} from "./postgres-h2-migration-manifest-v1";
import {
  EXACT_RUN_RELATIONS,
  KEEP_ORG_SELECT_V2_RELATIONS,
  LEFTOVER_ORG_SCOPE_POLICY_NAME,
  LEFTOVER_ORG_SCOPE_RELATIONS,
  LIFECYCLE_EVENTS_RELATION,
  leftoverOrgScopeInventoryIdentity,
  ORG_SELECT_V2_POLICY_NAME,
  RUNNER_EXACT_INSERT_POLICY,
  RUNNER_EXACT_SELECT_POLICY,
  RUNNER_EXACT_UPDATE_POLICY,
} from "./postgres-h2-leftover-org-scope-policy-v1";
import {
  H2_ORG_SCOPE_HYGIENE_RECEIPT_SCHEMA,
  H2_ORG_SCOPE_HYGIENE_STEP,
  H2OrgScopeHygieneOperatorError,
  canonicalJson,
  loadHygieneCeremonyEvidence,
  leftoverOrgScopeRelationDigest,
  parseHygieneStep,
  readHygieneApprovedHumanKeySha256,
  refuseHygiene,
  semanticDigest,
  type H2OrgScopeHygieneCeremonyEvidence,
  type H2OrgScopeHygieneStep,
} from "./postgres-h2-org-scope-hygiene-manifest-v1";

const LOCK_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 120_000;
const ADVISORY_LOCK_KEY = "waia.trader.h2.org-scope-hygiene-operator.v1";
const APPLICATION_NAME = "waia-h2-org-scope-hygiene-operator-v1";
const TARGET_FINGERPRINT = /^[0-9a-f]{64}$/;
const SAFE_RELATION = /^[A-Za-z0-9_]+$/;

type Sql = postgres.Sql;

export type HygieneTargetIdentity = Readonly<{
  databaseName: string;
  databaseOid: string;
  systemIdentifier: string;
  currentUser: string;
  serverAddress: string;
  serverPort: string;
  serverVersionNum: string;
  journalOwner: string;
  transactionReadOnly: boolean;
  inRecovery: boolean;
  publicSchemaUsage: boolean;
  publicSchemaCreate: boolean;
}>;

export type HygieneLeftoverPolicyRow = Readonly<{
  relationName: string;
  policyName: string;
  command: string;
  permissive: boolean;
  roles: readonly string[];
  usingExpression: string | null;
  checkExpression: string | null;
}>;

export type HygieneOperationReceipt = Readonly<{
  schemaVersion: typeof H2_ORG_SCOPE_HYGIENE_RECEIPT_SCHEMA;
  mode: "APPLY" | "VERIFY_ONLY";
  classification: "SELECTED_STEP_COMMITTED" | "LEFTOVER_ORG_SCOPE_PRESENT";
  targetFingerprint: string;
  selectedStep: H2OrgScopeHygieneStep;
  leftoverPolicyName: typeof LEFTOVER_ORG_SCOPE_POLICY_NAME;
  leftoverRelationDigest: string;
  leftoverCountBefore: number;
  leftoverCountAfter: number;
  liveJournalDigestBefore: string;
  restorePointAttestationDigest: string;
  quiescenceAttestationDigest: string;
  targetAttestationDigest: string;
  ceremonyAttestationDigest: string;
  humanSigningKeySha256: string;
  ceremonyId: string;
  requestId: string;
  operatorIdentity: string;
  transactionIdentity: string | null;
  catalogVerificationDigest: string | null;
  journalDigestAfter: string;
  commitTimestamp: string | null;
  postCommitVerification: Readonly<{
    readOnlyConnection: true;
    exactJournal: true;
    journalUnchanged: boolean;
    leftoverDropped: boolean;
    policiesCreated: false;
    genericMigratorUsed: false;
  }>;
  nextStepExecuted: false;
  contentDigestHex: string;
}>;

export type HygieneOperationInput = Readonly<{
  step: H2OrgScopeHygieneStep;
  expectedTargetFingerprint: string;
  databaseUrl: string;
  repoRoot: string;
  verifyOnly: boolean;
  confirmedStep?: H2OrgScopeHygieneStep;
  trustedHumanPublicKeyPath: string;
  restorePointAttestationPath: string;
  writerQuiescenceAttestationPath: string;
  targetIdentityAttestationPath: string;
  ceremonyAuthorizationAttestationPath: string;
}>;

export type HygieneOperatorDependencies = Readonly<{
  connect?(url: string, readOnly: boolean): Sql;
  approvedHumanKeySha256?: string;
  testHooks?: Readonly<{
    afterCommit?(): Promise<void>;
  }>;
}>;

function openPostgres(url: string, readOnly: boolean): Sql {
  return postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
    max_lifetime: null,
    connection: {
      application_name: APPLICATION_NAME,
      ...(readOnly ? { default_transaction_read_only: true } : {}),
    },
    onnotice: () => {},
  });
}

function assertDirectPostgresUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    refuseHygiene("DATABASE_URL_INVALID", "session/direct PostgreSQL URL required");
  }
  const poolMode = (parsed.searchParams.get("pool_mode") ?? parsed.searchParams.get("poolmode"))
    ?.trim()
    .toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol.toLowerCase()) ||
    !parsed.hostname ||
    !parsed.username ||
    parsed.port === "6543" ||
    parsed.port === "6432" ||
    poolMode === "transaction" ||
    poolMode === "statement"
  ) {
    refuseHygiene("DATABASE_URL_UNSAFE", "transaction pooling and incomplete URLs are forbidden");
  }
}

function quoteRelation(relation: string): string {
  if (!SAFE_RELATION.test(relation)) {
    refuseHygiene("CATALOG_INTERNAL_NAME", relation);
  }
  return `public.${relation}`;
}

export function computeHygieneTargetFingerprint(identity: HygieneTargetIdentity): string {
  return semanticDigest({
    databaseName: identity.databaseName,
    databaseOid: identity.databaseOid,
    systemIdentifier: identity.systemIdentifier,
    currentUser: identity.currentUser,
    serverAddress: identity.serverAddress,
    serverPort: identity.serverPort,
    serverVersionNum: identity.serverVersionNum,
  });
}

export async function readHygieneTargetIdentity(sql: Sql): Promise<HygieneTargetIdentity> {
  const rows = await sql<
    Readonly<{
      database_name: string;
      database_oid: string;
      system_identifier: string;
      current_user_name: string;
      server_address: string | null;
      server_port: string | null;
      server_version_num: string;
      journal_owner: string | null;
      transaction_read_only: string;
      in_recovery: boolean;
      public_schema_usage: boolean;
      public_schema_create: boolean;
    }>[]
  >`
    SELECT current_database() AS database_name,
      database.oid::text AS database_oid,
      control.system_identifier::text AS system_identifier,
      current_user AS current_user_name,
      inet_server_addr()::text AS server_address,
      inet_server_port()::text AS server_port,
      current_setting('server_version_num') AS server_version_num,
      pg_get_userbyid(journal.relowner) AS journal_owner,
      current_setting('transaction_read_only') AS transaction_read_only,
      pg_is_in_recovery() AS in_recovery,
      has_schema_privilege(current_user, 'public', 'USAGE') AS public_schema_usage,
      has_schema_privilege(current_user, 'public', 'CREATE') AS public_schema_create
    FROM pg_database database
    CROSS JOIN pg_control_system() control
    JOIN pg_roles role ON role.rolname=current_user
    LEFT JOIN pg_class journal ON journal.oid='drizzle.__drizzle_migrations'::regclass
    WHERE database.datname=current_database()
  `;
  const row = rows[0];
  if (!row || !row.journal_owner || !row.server_address || !row.server_port) {
    refuseHygiene("TARGET_IDENTITY_UNAVAILABLE", "journal owner and TCP endpoint required");
  }
  return Object.freeze({
    databaseName: row.database_name,
    databaseOid: row.database_oid,
    systemIdentifier: row.system_identifier,
    currentUser: row.current_user_name,
    serverAddress: row.server_address,
    serverPort: row.server_port,
    serverVersionNum: row.server_version_num,
    journalOwner: row.journal_owner,
    transactionReadOnly: row.transaction_read_only === "on",
    inRecovery: row.in_recovery,
    publicSchemaUsage: row.public_schema_usage,
    publicSchemaCreate: row.public_schema_create,
  });
}

export async function readHygieneLiveJournal(sql: Sql): Promise<H2AppliedMigration[]> {
  const rows = await sql<Readonly<{ hash: string; created_at: string }>[]>`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at, id
  `;
  return rows.map((row) => Object.freeze({ hash: row.hash, createdAt: row.created_at }));
}

export async function readLeftoverOrgScopePolicies(sql: Sql): Promise<HygieneLeftoverPolicyRow[]> {
  const rows = await sql<
    Readonly<{
      relation_name: string;
      policy_name: string;
      command: string;
      permissive: boolean;
      roles: string[];
      using_expression: string | null;
      check_expression: string | null;
    }>[]
  >`
    SELECT class.relname AS relation_name,
      policy.polname AS policy_name,
      policy.polcmd AS command,
      policy.polpermissive AS permissive,
      ARRAY(
        SELECT role.rolname FROM pg_roles role
        WHERE role.oid=ANY(policy.polroles)
        ORDER BY role.rolname
      ) AS roles,
      pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
      pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression
    FROM pg_policy policy
    JOIN pg_class class ON class.oid=policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public'
      AND policy.polname=${LEFTOVER_ORG_SCOPE_POLICY_NAME}
    ORDER BY class.relname
  `;
  return rows.map((row) =>
    Object.freeze({
      relationName: row.relation_name,
      policyName: row.policy_name,
      command: row.command,
      permissive: row.permissive,
      roles: Object.freeze([...row.roles]),
      usingExpression: row.using_expression,
      checkExpression: row.check_expression,
    }),
  );
}

async function policyExists(sql: Sql, relation: string, policyName: string): Promise<boolean> {
  if (!SAFE_RELATION.test(relation) || !SAFE_RELATION.test(policyName)) {
    refuseHygiene("CATALOG_INTERNAL_NAME", `${relation}.${policyName}`);
  }
  const rows = await sql<Readonly<{ present: boolean }>[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_policy policy
      JOIN pg_class class ON class.oid=policy.polrelid
      JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
      WHERE namespace.nspname='public'
        AND class.relname=${relation}
        AND policy.polname=${policyName}
    ) AS present
  `;
  return Boolean(rows[0]?.present);
}

export async function assertRemainingLawfulRunnerPolicies(sql: Sql): Promise<string> {
  const leftover = await readLeftoverOrgScopePolicies(sql);
  if (leftover.length > 0) {
    refuseHygiene(
      "LEFTOVER_ORG_SCOPE_REMAINING",
      leftover.map((row) => row.relationName).join(","),
    );
  }
  for (const relation of KEEP_ORG_SELECT_V2_RELATIONS) {
    if (!(await policyExists(sql, relation, ORG_SELECT_V2_POLICY_NAME))) {
      refuseHygiene("ORG_SELECT_V2_MISSING", relation);
    }
  }
  if (await policyExists(sql, LIFECYCLE_EVENTS_RELATION, ORG_SELECT_V2_POLICY_NAME)) {
    refuseHygiene("ORG_SELECT_V2_INVENTED", LIFECYCLE_EVENTS_RELATION);
  }
  for (const relation of EXACT_RUN_RELATIONS) {
    if (!(await policyExists(sql, relation, RUNNER_EXACT_SELECT_POLICY))) {
      refuseHygiene("EXACT_SELECT_MISSING", relation);
    }
    if (!(await policyExists(sql, relation, RUNNER_EXACT_INSERT_POLICY))) {
      refuseHygiene("EXACT_INSERT_MISSING", relation);
    }
  }
  if (!(await policyExists(sql, "trader_orders", RUNNER_EXACT_UPDATE_POLICY))) {
    refuseHygiene("EXACT_UPDATE_MISSING", "trader_orders");
  }
  return semanticDigest({
    leftoverCount: 0,
    keepOrgSelectV2: [...KEEP_ORG_SELECT_V2_RELATIONS],
    exactRunRelations: [...EXACT_RUN_RELATIONS],
    lifecycleSelectInvented: false,
  });
}

function journal0205Prefix(repoRoot: string): readonly H2AppliedMigration[] {
  return loadH2CanonicalSource(repoRoot, "0205").expectedAppliedPrefix;
}

async function assertHygieneAuthority(
  sql: Sql,
  target: HygieneTargetIdentity,
  evidence: H2OrgScopeHygieneCeremonyEvidence,
  expectedTargetFingerprint: string,
  requireWritable: boolean,
): Promise<string> {
  const targetFingerprint = computeHygieneTargetFingerprint(target);
  const attestation = evidence.targetIdentity;
  if (
    !TARGET_FINGERPRINT.test(expectedTargetFingerprint) ||
    targetFingerprint !== expectedTargetFingerprint ||
    targetFingerprint !== attestation.targetFingerprint ||
    target.databaseName !== attestation.expectedDatabaseName ||
    target.currentUser !== attestation.expectedMigrationAuthority ||
    target.journalOwner !== target.currentUser ||
    target.inRecovery ||
    target.transactionReadOnly === requireWritable ||
    !target.publicSchemaUsage ||
    !target.publicSchemaCreate
  ) {
    refuseHygiene("TARGET_IDENTITY_OR_AUTHORITY", H2_ORG_SCOPE_HYGIENE_STEP);
  }
  for (const relation of LEFTOVER_ORG_SCOPE_RELATIONS) {
    const identity = quoteRelation(relation);
    const rows = await sql<Readonly<{ relation: string | null; owner: string | null }>[]>`
      SELECT to_regclass(${identity})::text AS relation,
        pg_get_userbyid(class.relowner) AS owner
      FROM pg_class class
      WHERE class.oid=to_regclass(${identity})
    `;
    if (!rows[0]?.relation || rows[0].owner !== target.currentUser) {
      refuseHygiene("MIGRATION_AUTHORITY_RELATION", identity);
    }
  }
  return targetFingerprint;
}

async function assertRelevantWritersQuiesced(sql: Sql): Promise<void> {
  const rows = await sql<Readonly<{ pid: number }>[]>`
    SELECT pid
    FROM pg_stat_activity
    WHERE datname=current_database()
      AND pid<>pg_backend_pid()
      AND backend_type='client backend'
      AND application_name<>${APPLICATION_NAME}
      AND (
        usename IN ('waia_historical_runner_login','waia_account_observer_login')
        OR application_name ~* '(waia|trader|historical|forecast|execution|account.?observation)'
        OR (
          state IS DISTINCT FROM 'idle'
          AND query ~* '(exchange_credentials|trader_account_|trader_scientific_|trader_historical_)'
        )
      )
  `;
  if (rows.length > 0) refuseHygiene("WRITERS_NOT_QUIESCED", String(rows.length));
}

async function acquireHygieneLocks(sql: Sql): Promise<void> {
  await sql.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await sql.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
  await sql.unsafe("SET LOCAL idle_in_transaction_session_timeout = '15000ms'");
  await sql.unsafe("SET LOCAL synchronous_commit = on");
  await sql.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
  for (const relation of LEFTOVER_ORG_SCOPE_RELATIONS) {
    await sql.unsafe(`LOCK TABLE ${quoteRelation(relation)} IN ACCESS EXCLUSIVE MODE`);
  }
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${ADVISORY_LOCK_KEY},0))`;
  const durability = await sql<Readonly<{ synchronous_commit: string }>[]>`
    SELECT current_setting('synchronous_commit') AS synchronous_commit
  `;
  if (durability[0]?.synchronous_commit !== "on") {
    refuseHygiene("SYNCHRONOUS_COMMIT_REQUIRED", H2_ORG_SCOPE_HYGIENE_STEP);
  }
}

async function dropFrozenLeftoverPolicies(sql: Sql): Promise<void> {
  for (const relation of LEFTOVER_ORG_SCOPE_RELATIONS) {
    await sql.unsafe(`DROP POLICY ${LEFTOVER_ORG_SCOPE_POLICY_NAME} ON ${quoteRelation(relation)}`);
  }
}

function buildReceipt(
  input: Omit<HygieneOperationReceipt, "schemaVersion" | "contentDigestHex">,
): HygieneOperationReceipt {
  const body = Object.freeze({ schemaVersion: H2_ORG_SCOPE_HYGIENE_RECEIPT_SCHEMA, ...input });
  return Object.freeze({ ...body, contentDigestHex: semanticDigest(body) });
}

function receiptAttestationFields(evidence: H2OrgScopeHygieneCeremonyEvidence) {
  return {
    restorePointAttestationDigest: evidence.restorePoint.contentDigestHex,
    quiescenceAttestationDigest: evidence.writerQuiescence.contentDigestHex,
    targetAttestationDigest: evidence.targetIdentity.contentDigestHex,
    ceremonyAttestationDigest: evidence.ceremonyAuthorization.contentDigestHex,
    humanSigningKeySha256: evidence.ceremonyAuthorization.signingKeySha256,
    ceremonyId: evidence.ceremonyAuthorization.ceremonyId,
    requestId: evidence.ceremonyAuthorization.requestId,
    operatorIdentity: evidence.ceremonyAuthorization.operatorIdentity,
  };
}

function classifyLeftoverInventory(rows: readonly HygieneLeftoverPolicyRow[]): {
  classification: HygieneOperationReceipt["classification"];
} {
  if (rows.length === 0) {
    return { classification: "SELECTED_STEP_COMMITTED" };
  }
  const identity = leftoverOrgScopeInventoryIdentity(rows);
  if (!identity.matchesFrozenInventory) {
    refuseHygiene("INVENTORY_MISMATCH", identity.relationNames.join(",") || "empty-mismatch");
  }
  return { classification: "LEFTOVER_ORG_SCOPE_PRESENT" };
}

async function verifyReadOnly(
  input: HygieneOperationInput,
  evidence: H2OrgScopeHygieneCeremonyEvidence,
  dependencies: HygieneOperatorDependencies,
  liveJournalDigestBefore: string,
  applyMetadata?: Readonly<{
    transactionIdentity: string;
    catalogVerificationDigest: string;
    commitTimestamp: string;
    leftoverCountBefore: number;
  }>,
): Promise<HygieneOperationReceipt> {
  const connect = dependencies.connect ?? openPostgres;
  const pool = connect(input.databaseUrl, true);
  const reserved = await pool.reserve();
  const sql = reserved as unknown as Sql;
  let transactionOpen = false;
  try {
    await sql.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const target = await readHygieneTargetIdentity(sql);
    const targetFingerprint = await assertHygieneAuthority(
      sql,
      target,
      evidence,
      input.expectedTargetFingerprint,
      false,
    );
    const journal = await readHygieneLiveJournal(sql);
    const journalDigestAfter = assertExactJournal(
      journal,
      journal0205Prefix(input.repoRoot),
      "hygiene:verify-journal-0205",
    );
    const leftover = await readLeftoverOrgScopePolicies(sql);
    const { classification } = classifyLeftoverInventory(leftover);
    let catalogVerificationDigest: string | null = null;
    if (classification === "SELECTED_STEP_COMMITTED") {
      catalogVerificationDigest = await assertRemainingLawfulRunnerPolicies(sql);
    }
    if (applyMetadata && catalogVerificationDigest !== applyMetadata.catalogVerificationDigest) {
      refuseHygiene("POST_COMMIT_CATALOG_MISMATCH", H2_ORG_SCOPE_HYGIENE_STEP);
    }
    const leftoverCountAfter = leftover.length;
    const leftoverCountBefore = applyMetadata?.leftoverCountBefore ?? leftoverCountAfter;
    const receipt = buildReceipt({
      mode: input.verifyOnly ? "VERIFY_ONLY" : "APPLY",
      classification,
      targetFingerprint,
      selectedStep: H2_ORG_SCOPE_HYGIENE_STEP,
      leftoverPolicyName: LEFTOVER_ORG_SCOPE_POLICY_NAME,
      leftoverRelationDigest: leftoverOrgScopeRelationDigest(),
      leftoverCountBefore,
      leftoverCountAfter,
      liveJournalDigestBefore: liveJournalDigestBefore || journalDigestAfter,
      ...receiptAttestationFields(evidence),
      transactionIdentity: applyMetadata?.transactionIdentity ?? null,
      catalogVerificationDigest,
      journalDigestAfter,
      commitTimestamp: applyMetadata?.commitTimestamp ?? null,
      postCommitVerification: Object.freeze({
        readOnlyConnection: true as const,
        exactJournal: true as const,
        journalUnchanged: journalDigestAfter === (liveJournalDigestBefore || journalDigestAfter),
        leftoverDropped: classification === "SELECTED_STEP_COMMITTED",
        policiesCreated: false as const,
        genericMigratorUsed: false as const,
      }),
      nextStepExecuted: false as const,
    });
    await sql.unsafe("COMMIT");
    transactionOpen = false;
    return receipt;
  } catch (error) {
    if (transactionOpen) await sql.unsafe("ROLLBACK").catch(() => undefined);
    if (error instanceof H2OrgScopeHygieneOperatorError) throw error;
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "UNKNOWN")
        : "UNKNOWN";
    refuseHygiene("READ_ONLY_VERIFICATION_FAILED", code);
  } finally {
    reserved.release();
    await pool.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function runHygieneOperation(
  input: HygieneOperationInput,
  dependencies: HygieneOperatorDependencies = {},
): Promise<HygieneOperationReceipt> {
  assertDirectPostgresUrl(input.databaseUrl);
  if (
    (dependencies.testHooks || dependencies.approvedHumanKeySha256) &&
    process.env.NODE_ENV !== "test"
  ) {
    refuseHygiene("TEST_HOOK_FORBIDDEN", "test hooks require NODE_ENV=test");
  }
  if (input.step !== H2_ORG_SCOPE_HYGIENE_STEP) {
    refuseHygiene("CLI_STEP", input.step);
  }
  if (!input.verifyOnly && input.confirmedStep !== H2_ORG_SCOPE_HYGIENE_STEP) {
    refuseHygiene("EXACT_STEP_CONFIRMATION_REQUIRED", H2_ORG_SCOPE_HYGIENE_STEP);
  }
  const approvedHumanKeySha256 =
    dependencies.approvedHumanKeySha256 ?? readHygieneApprovedHumanKeySha256();
  const evidence = loadHygieneCeremonyEvidence({
    step: H2_ORG_SCOPE_HYGIENE_STEP,
    trustedHumanPublicKeyPath: input.trustedHumanPublicKeyPath,
    expectedHumanSigningKeySha256: approvedHumanKeySha256,
    restorePointPath: input.restorePointAttestationPath,
    writerQuiescencePath: input.writerQuiescenceAttestationPath,
    targetIdentityPath: input.targetIdentityAttestationPath,
    ceremonyAuthorizationPath: input.ceremonyAuthorizationAttestationPath,
  });
  if (evidence.ceremonyAuthorization.targetFingerprint !== input.expectedTargetFingerprint) {
    refuseHygiene("COMMAND_ATTESTATION_TARGET_MISMATCH", H2_ORG_SCOPE_HYGIENE_STEP);
  }
  const connect = dependencies.connect ?? openPostgres;
  if (input.verifyOnly) {
    return verifyReadOnly(input, evidence, dependencies, "");
  }

  const pool = connect(input.databaseUrl, false);
  const reserved = await pool.reserve();
  const sql = reserved as unknown as Sql;
  let liveJournalDigestBefore = "";
  let leftoverCountBefore = 0;
  let transactionIdentity = "";
  let catalogVerificationDigest = "";
  let commitTimestamp = "";
  let transactionOpen = false;
  try {
    const target = await readHygieneTargetIdentity(sql);
    await assertHygieneAuthority(sql, target, evidence, input.expectedTargetFingerprint, true);
    await assertRelevantWritersQuiesced(sql);
    const before = await readHygieneLiveJournal(sql);
    liveJournalDigestBefore = assertExactJournal(
      before,
      journal0205Prefix(input.repoRoot),
      "hygiene:predecessor-journal-0205",
    );
    const beforeLeftover = await readLeftoverOrgScopePolicies(sql);
    leftoverCountBefore = beforeLeftover.length;
    if (!leftoverOrgScopeInventoryIdentity(beforeLeftover).matchesFrozenInventory) {
      refuseHygiene(
        leftoverCountBefore === 0 ? "LEFTOVER_ALREADY_ABSENT" : "INVENTORY_MISMATCH",
        beforeLeftover.map((row) => row.relationName).join(",") || "none",
      );
    }

    await sql.unsafe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    try {
      await acquireHygieneLocks(sql);
      const lockedTarget = await readHygieneTargetIdentity(sql);
      await assertHygieneAuthority(
        sql,
        lockedTarget,
        evidence,
        input.expectedTargetFingerprint,
        true,
      );
      await assertRelevantWritersQuiesced(sql);
      const lockedJournal = await readHygieneLiveJournal(sql);
      assertExactJournal(
        lockedJournal,
        journal0205Prefix(input.repoRoot),
        "hygiene:locked-journal-0205",
      );
      const lockedLeftover = await readLeftoverOrgScopePolicies(sql);
      if (!leftoverOrgScopeInventoryIdentity(lockedLeftover).matchesFrozenInventory) {
        refuseHygiene(
          "INVENTORY_MISMATCH",
          lockedLeftover.map((row) => row.relationName).join(",") || "none",
        );
      }
      await dropFrozenLeftoverPolicies(sql);
      catalogVerificationDigest = await assertRemainingLawfulRunnerPolicies(sql);
      const stillJournal = await readHygieneLiveJournal(sql);
      assertExactJournal(
        stillJournal,
        journal0205Prefix(input.repoRoot),
        "hygiene:pre-commit-journal-unchanged",
      );
      const transactionRows = await sql<Readonly<{ transaction_id: string }>[]>`
        SELECT txid_current()::text AS transaction_id
      `;
      const transaction = transactionRows[0];
      if (!transaction) refuseHygiene("TRANSACTION_IDENTITY_MISSING", H2_ORG_SCOPE_HYGIENE_STEP);
      transactionIdentity = transaction.transaction_id;
    } catch (error) {
      if (transactionOpen) {
        await sql.unsafe("ROLLBACK").catch(() => undefined);
        transactionOpen = false;
      }
      throw error;
    }

    try {
      await sql.unsafe("COMMIT");
      transactionOpen = false;
      commitTimestamp = new Date().toISOString();
      await dependencies.testHooks?.afterCommit?.();
    } catch {
      transactionOpen = false;
      refuseHygiene(
        "COMMIT_RESULT_UNCERTAIN",
        "do not retry; run --verify-only --step DROP_ORG_SCOPE",
      );
    }
  } catch (error) {
    if (error instanceof H2OrgScopeHygieneOperatorError) throw error;
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "UNKNOWN")
        : "UNKNOWN";
    if (code === "55P03" || code === "57014") {
      refuseHygiene("LOCK_TIMEOUT", H2_ORG_SCOPE_HYGIENE_STEP);
    }
    refuseHygiene("TRANSACTION_FAILED", `${H2_ORG_SCOPE_HYGIENE_STEP}:${code}`);
  } finally {
    if (transactionOpen) await sql.unsafe("ROLLBACK").catch(() => undefined);
    reserved.release();
    await pool.end({ timeout: 5 }).catch(() => undefined);
  }
  return verifyReadOnly(input, evidence, dependencies, liveJournalDigestBefore, {
    transactionIdentity,
    catalogVerificationDigest,
    commitTimestamp,
    leftoverCountBefore,
  });
}

type CliArguments = Omit<HygieneOperationInput, "databaseUrl" | "repoRoot">;

export function parseHygieneCliArguments(argv: readonly string[]): CliArguments {
  const values = new Map<string, string>();
  let verifyOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--verify-only") {
      if (verifyOnly) refuseHygiene("CLI_DUPLICATE_OPTION", argument);
      verifyOnly = true;
      continue;
    }
    const allowed = new Set([
      "--step",
      "--confirm-exact-step",
      "--expected-target-fingerprint",
      "--trusted-human-public-key",
      "--restore-point-attestation",
      "--writer-quiescence-attestation",
      "--target-identity-attestation",
      "--ceremony-authorization-attestation",
    ]);
    if (!allowed.has(argument) || values.has(argument)) {
      refuseHygiene("CLI_OPTION", argument);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) refuseHygiene("CLI_OPTION_VALUE", argument);
    values.set(argument, value);
    index += 1;
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) refuseHygiene("CLI_REQUIRED_OPTION", name);
    return value;
  };
  const step = parseHygieneStep(required("--step"));
  const confirmed = values.get("--confirm-exact-step");
  if (verifyOnly && confirmed) refuseHygiene("VERIFY_ONLY_CONFIRMATION_FORBIDDEN", confirmed);
  return Object.freeze({
    step,
    verifyOnly,
    confirmedStep: confirmed ? parseHygieneStep(confirmed) : undefined,
    expectedTargetFingerprint: required("--expected-target-fingerprint"),
    trustedHumanPublicKeyPath: required("--trusted-human-public-key"),
    restorePointAttestationPath: required("--restore-point-attestation"),
    writerQuiescenceAttestationPath: required("--writer-quiescence-attestation"),
    targetIdentityAttestationPath: required("--target-identity-attestation"),
    ceremonyAuthorizationAttestationPath: required("--ceremony-authorization-attestation"),
  });
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    refuseHygiene("CLI_ENVIRONMENT", "WAIA_TRADER_CLI=1 required");
  }
  const databaseUrl = process.env.DATABASE_URL_POSTGRES_SESSION?.trim();
  if (!databaseUrl) {
    refuseHygiene("DATABASE_URL_REQUIRED", "DATABASE_URL_POSTGRES_SESSION");
  }
  const args = parseHygieneCliArguments(process.argv.slice(2));
  const receipt = await runHygieneOperation({
    ...args,
    databaseUrl,
    repoRoot: process.cwd(),
  });
  process.stdout.write(canonicalJson(receipt) + "\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    if (error instanceof H2OrgScopeHygieneOperatorError) {
      process.stderr.write(error.message + "\n");
    } else {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code ?? "UNKNOWN")
          : "UNKNOWN";
      process.stderr.write(`H2_ORG_SCOPE_HYGIENE_REFUSED:UNEXPECTED:${code}\n`);
    }
    process.exitCode = 1;
  });
}
