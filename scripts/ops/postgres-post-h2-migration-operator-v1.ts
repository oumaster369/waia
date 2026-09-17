/**
 * DEE-1018: fail-closed post-H2 exact-one-step migration operator.
 *
 * The ratified production journal order is `0205 -> 0206 -> 0207 -> 0208 -> 0209 -> 0210`. The H2
 * operator owns `0205..0208` and is untouched; this operator owns exactly `0209` and `0210`.
 *
 * It never uses Drizzle's generic migrator. Drizzle applies every journal entry above a single
 * `max(created_at)` high-water mark, which would silently apply AI-TWIN 0209 together with Trader
 * 0210 and, if 0210 were ever recorded first, would silently skip 0209 forever. This operator
 * instead executes exactly the one pinned migration named by `--step`, requires the live journal to
 * equal the canonical predecessor prefix exactly, and commits SQL plus its single journal row
 * atomically. One invocation applies one step; 0210 requires a second Human ceremony.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import postgres from "postgres";

import {
  POST_H2_MIGRATION_RECEIPT_SCHEMA,
  PostH2MigrationOperatorError,
  assertExactPostH2Journal,
  canonicalJson,
  classifyPostH2VerifyOnlyJournal,
  loadPostH2CanonicalSource,
  loadPostH2CeremonyEvidence,
  parsePostH2Step,
  readPostH2ApprovedHumanKeySha256,
  refusePostH2,
  semanticDigest,
  type PostH2AppliedMigration,
  type PostH2CanonicalSource,
  type PostH2CeremonyEvidence,
  type PostH2Step,
} from "./postgres-post-h2-migration-manifest-v1";

const LOCK_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 120_000;
const ADVISORY_LOCK_KEY = "waia.trader.post-h2.migration-operator.v1";
const TARGET_FINGERPRINT = /^[0-9a-f]{64}$/;

type Sql = postgres.Sql;

/** The exact additive surface DEE-871 migration 0209 creates. Nothing else may appear. */
const AI_TWIN_0209_TABLES = Object.freeze([
  "ai_twin_claim_revisions",
  "ai_twin_command_receipts",
  "ai_twin_consent_grants",
  "ai_twin_consent_issuance_receipts",
  "ai_twin_dynamic_relations",
  "ai_twin_evidence_links",
  "ai_twin_human_corrections",
  "ai_twin_knowledge_needs",
  "ai_twin_model_endorsements",
  "ai_twin_necessity_reviews",
  "ai_twin_object_versions",
  "ai_twin_observations",
  "ai_twin_rights_completion_evidence",
  "ai_twin_rights_operation_attempts",
  "ai_twin_rights_operation_effects",
  "ai_twin_rights_operation_events",
  "ai_twin_rights_operations",
  "ai_twin_working_hypotheses",
]);

const AI_TWIN_0209_FUNCTIONS = Object.freeze([
  "ai_twin_hypothesis_alternatives_valid_v1",
  "ai_twin_nonempty_text_array_valid_v1",
  "ai_twin_observation_sources_valid_v1",
  "ai_twin_projection_risks_valid_v1",
]);

/**
 * The indexes DEE-871 declares explicitly. Constraint-backed indexes are not listed because
 * PostgreSQL truncates their generated names; every index is instead required to belong to one of
 * the 18 tables above, and the pinned catalog digest covers each index definition exactly.
 */
const AI_TWIN_0209_INDEXES = Object.freeze([
  "ai_twin_claim_revisions_scope_claim_version_idx",
  "ai_twin_claim_revisions_scope_id_version_uq",
  "ai_twin_consent_grants_scope_grant_version_idx",
  "ai_twin_consent_grants_scope_purpose_idx",
  "ai_twin_evidence_links_source_idx",
  "ai_twin_evidence_links_target_idx",
  "ai_twin_human_corrections_scope_id_uq",
  "ai_twin_necessity_reviews_target_idx",
  "ai_twin_object_versions_scope_kind_id_version_idx",
  "ai_twin_object_versions_scope_purpose_created_idx",
  "ai_twin_observations_grant_idx",
  "ai_twin_observations_scope_purpose_recorded_idx",
  "ai_twin_rights_operations_scope_type_requested_idx",
  "ai_twin_rights_operations_target_digest_idx",
]);

/** Exactly the columns DEE-1015 grants migration 0210's credential role. */
const OBSERVATION_CREDENTIAL_COLUMNS = Object.freeze([
  "encrypted_payload",
  "exchange_account_id",
  "id",
  "organization_id",
  "payload_key_version",
  "status",
  "wrapped_dek_key",
  "wrapped_dek_key_version",
]);

const OBSERVATION_CREDENTIAL_WITHHELD_COLUMNS = Object.freeze([
  "api_key_masked",
  "created_at",
  "observation_revision",
  "permission_metadata",
  "revoked_at",
  "updated_at",
  "venue",
]);

export type PostH2TargetIdentity = Readonly<{
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
  roleSuperuser: boolean;
  roleCreateRole: boolean;
  publicSchemaUsage: boolean;
  publicSchemaCreate: boolean;
}>;

export type PostH2OperationReceipt = Readonly<{
  schemaVersion: typeof POST_H2_MIGRATION_RECEIPT_SCHEMA;
  mode: "APPLY" | "VERIFY_ONLY";
  classification: "SELECTED_STEP_COMMITTED" | "PREDECESSOR_NOT_APPLIED";
  targetFingerprint: string;
  selectedStep: PostH2Step;
  sourceCommit: string;
  sourceBlob: string;
  sourceSha256: string;
  predecessorMigration: string;
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
    exactCatalog: boolean;
    genericMigratorUsed: false;
    aiTwinRuntimeActivated: false;
  }>;
  nextStepExecuted: false;
  contentDigestHex: string;
}>;

export type PostH2OperationInput = Readonly<{
  step: PostH2Step;
  expectedTargetFingerprint: string;
  databaseUrl: string;
  repoRoot: string;
  verifyOnly: boolean;
  confirmedStep?: PostH2Step;
  trustedHumanPublicKeyPath: string;
  restorePointAttestationPath: string;
  writerQuiescenceAttestationPath: string;
  targetIdentityAttestationPath: string;
  ceremonyAuthorizationAttestationPath: string;
}>;

export type PostH2OperatorTestHooks = Readonly<{
  beforeCatalogVerification?(sql: Sql, source: PostH2CanonicalSource): Promise<void>;
  afterCommit?(): Promise<void>;
}>;

export type PostH2OperatorDependencies = Readonly<{
  connect?(url: string, readOnly: boolean): Sql;
  approvedHumanKeySha256?: string;
  testHooks?: PostH2OperatorTestHooks;
}>;

function openPostgres(url: string, readOnly: boolean): Sql {
  return postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
    max_lifetime: null,
    connection: {
      application_name: "waia-post-h2-migration-operator-v1",
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
    refusePostH2("DATABASE_URL_INVALID", "session/direct PostgreSQL URL required");
  }
  const poolMode = parsed.searchParams.get("pool_mode") ?? parsed.searchParams.get("poolmode");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol.toLowerCase()) ||
    !parsed.hostname ||
    !parsed.username ||
    parsed.port === "6543" ||
    poolMode?.toLowerCase() === "transaction"
  ) {
    refusePostH2("DATABASE_URL_UNSAFE", "transaction pooling and incomplete URLs are forbidden");
  }
}

export async function readPostH2TargetIdentity(sql: Sql): Promise<PostH2TargetIdentity> {
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
      role_superuser: boolean;
      role_create_role: boolean;
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
      role.rolsuper AS role_superuser,
      role.rolcreaterole AS role_create_role,
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
    refusePostH2("TARGET_IDENTITY_UNAVAILABLE", "journal owner and TCP endpoint required");
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
    roleSuperuser: row.role_superuser,
    roleCreateRole: row.role_create_role,
    publicSchemaUsage: row.public_schema_usage,
    publicSchemaCreate: row.public_schema_create,
  });
}

export function computePostH2TargetFingerprint(identity: PostH2TargetIdentity): string {
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

async function assertMigrationAuthority(
  sql: Sql,
  source: PostH2CanonicalSource,
  target: PostH2TargetIdentity,
  evidence: PostH2CeremonyEvidence,
  expectedTargetFingerprint: string,
  requireWritable: boolean,
): Promise<string> {
  const targetFingerprint = computePostH2TargetFingerprint(target);
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
    !target.publicSchemaCreate ||
    // 0210 creates a role, which requires CREATEROLE or superuser.
    (source.selected.step === "0210" && !target.roleSuperuser && !target.roleCreateRole)
  ) {
    refusePostH2("TARGET_IDENTITY_OR_AUTHORITY", source.selected.step);
  }
  for (const relation of source.selected.ownerRelations) {
    const rows = await sql<Readonly<{ relation: string | null; owner: string | null }>[]>`
      SELECT to_regclass(${relation})::text AS relation,
        pg_get_userbyid(class.relowner) AS owner
      FROM pg_class class
      WHERE class.oid=to_regclass(${relation})
    `;
    if (!rows[0]?.relation || rows[0].owner !== target.currentUser) {
      refusePostH2("MIGRATION_AUTHORITY_RELATION", relation);
    }
  }
  return targetFingerprint;
}

export async function readPostH2LiveJournal(sql: Sql): Promise<PostH2AppliedMigration[]> {
  const rows = await sql<Readonly<{ hash: string; created_at: string }>[]>`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at, id
  `;
  return rows.map((row) => Object.freeze({ hash: row.hash, createdAt: row.created_at }));
}

async function countAiTwin0209Relations(sql: Sql): Promise<number> {
  const rows = await sql<Readonly<{ total: string }>[]>`
    SELECT count(*)::text AS total
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relname LIKE 'ai_twin_%'
  `;
  return Number(rows[0]?.total ?? "-1");
}

/**
 * Catalog preconditions the journal alone cannot express: a step must not already be half-present,
 * and 0210 must observe the objects 0209 actually created rather than trusting its journal row.
 */
async function assertCatalogPrecondition(sql: Sql, step: PostH2Step): Promise<void> {
  if (step === "0209") {
    if ((await countAiTwin0209Relations(sql)) !== 0) {
      refusePostH2("CATALOG_PRECONDITION", "public.ai_twin_* objects already exist");
    }
    return;
  }
  const rows = await sql<
    Readonly<{
      twin_tables: string;
      credential_policies: string;
    }>[]
  >`
    SELECT
      (
        SELECT count(*)::text FROM pg_class class
        JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
        WHERE namespace.nspname='public' AND class.relkind='r'
          AND class.relname = ANY(${AI_TWIN_0209_TABLES as unknown as string[]})
      ) AS twin_tables,
      (
        SELECT count(*)::text FROM pg_policy
        WHERE polname IN ('trader_observation_credential_assignment',
          'trader_observation_credential_read')
      ) AS credential_policies
  `;
  const row = rows[0];
  if (!row) refusePostH2("CATALOG_PRECONDITION", step);
  // A journal row for 0209 with no AI-TWIN tables would mean the recorded history is a forgery.
  if (Number(row.twin_tables) !== AI_TWIN_0209_TABLES.length) {
    refusePostH2("CATALOG_PRECONDITION", "migration 0209 objects are not present");
  }
  // The role is cluster-wide, so its mere presence is not proof of application; the two
  // database-scoped policies are. An unsafely pre-existing role is refused by 0210's own guard and
  // re-proven by `verify0210` before commit.
  if (Number(row.credential_policies) !== 0) {
    refusePostH2("CATALOG_PRECONDITION", "migration 0210 objects already exist");
  }
}

async function assertRelevantWritersQuiesced(sql: Sql): Promise<void> {
  const rows = await sql<Readonly<{ pid: number }>[]>`
    SELECT pid
    FROM pg_stat_activity
    WHERE datname=current_database()
      AND pid<>pg_backend_pid()
      AND backend_type='client backend'
      AND application_name<>'waia-post-h2-migration-operator-v1'
      AND (
        usename IN ('waia_historical_runner_login','waia_account_observer_login',
          'waia_account_observation_reader_login','waia_account_observation_credential_login')
        OR application_name ~* '(waia|trader|historical|forecast|execution|account.?observation|twin)'
        OR (
          state IS DISTINCT FROM 'idle'
          AND query ~* '(exchange_credentials|trader_account_|trader_scientific_|trader_historical_|ai_twin_)'
        )
      )
  `;
  if (rows.length > 0) refusePostH2("WRITERS_NOT_QUIESCED", String(rows.length));
}

async function policySnapshot(sql: Sql, policyName: string) {
  const rows = await sql<
    Readonly<{
      policy_name: string;
      command: string;
      permissive: boolean;
      roles: string[];
      using_expression: string | null;
      check_expression: string | null;
    }>[]
  >`
    SELECT policy.polname AS policy_name, policy.polcmd AS command,
      policy.polpermissive AS permissive,
      ARRAY(
        SELECT role.rolname FROM pg_roles role
        WHERE role.oid=ANY(policy.polroles)
        ORDER BY role.rolname
      ) AS roles,
      pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
      pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression
    FROM pg_policy policy
    WHERE policy.polname=${policyName}
  `;
  if (rows.length !== 1) refusePostH2("CATALOG_POLICY", policyName);
  return rows[0]!;
}

/**
 * DEE-871 contract: exactly the additive AI-TWIN surface, owned by the migration authority, with
 * no grant to any browser or public role. Proving the absence of grants is what proves that
 * journaling 0209 does not activate AI-TWIN: no runtime identity can reach these tables.
 */
async function verify0209(sql: Sql): Promise<unknown> {
  const relations = await sql<
    Readonly<{
      relname: string;
      relkind: string;
      indexed_table: string | null;
      owner_is_current_user: boolean;
    }>[]
  >`
    SELECT class.relname, class.relkind, indexed.relname AS indexed_table,
      pg_get_userbyid(class.relowner)=current_user AS owner_is_current_user
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    LEFT JOIN pg_index index_item ON index_item.indexrelid=class.oid
    LEFT JOIN pg_class indexed ON indexed.oid=index_item.indrelid
    WHERE namespace.nspname='public' AND class.relname LIKE 'ai_twin_%'
    ORDER BY class.relname
  `;
  const tables = relations.filter((item) => item.relkind === "r").map((item) => item.relname);
  const indexes = relations.filter((item) => item.relkind === "i");
  if (
    canonicalJson(tables) !== canonicalJson(AI_TWIN_0209_TABLES) ||
    relations.length !== tables.length + indexes.length ||
    relations.some((item) => !item.owner_is_current_user) ||
    // No view, sequence or foreign table, and no index over anything but the declared tables.
    indexes.some((item) => !AI_TWIN_0209_TABLES.includes(item.indexed_table ?? "")) ||
    !AI_TWIN_0209_INDEXES.every((name) => indexes.some((item) => item.relname === name))
  ) {
    refusePostH2("CATALOG_0209_RELATIONS", "exact AI-TWIN additive surface required");
  }
  const functions = await sql<
    Readonly<{
      proname: string;
      volatility: string;
      security_definer: boolean;
      owner_is_current_user: boolean;
    }>[]
  >`
    SELECT procedure.proname, procedure.provolatile AS volatility,
      procedure.prosecdef AS security_definer,
      pg_get_userbyid(procedure.proowner)=current_user AS owner_is_current_user
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public' AND procedure.proname LIKE 'ai_twin_%'
    ORDER BY procedure.proname
  `;
  if (
    canonicalJson(functions.map((item) => item.proname)) !==
      canonicalJson(AI_TWIN_0209_FUNCTIONS) ||
    functions.some((item) => item.security_definer || !item.owner_is_current_user)
  ) {
    refusePostH2("CATALOG_0209_FUNCTIONS", "exact immutable validator set required");
  }
  const exposure = await sql<
    Readonly<{
      grantee: string;
      table_name: string;
      privilege_type: string;
    }>[]
  >`
    SELECT grantee, table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema='public' AND table_name LIKE 'ai_twin_%' AND grantee<>current_user
    ORDER BY grantee, table_name, privilege_type
  `;
  if (exposure.length !== 0) {
    refusePostH2("CATALOG_0209_GRANTS", "AI-TWIN tables must grant nothing");
  }
  const reachability = (
    await sql<
      Readonly<{
        authenticated_reach: boolean;
        anon_reach: boolean;
        public_reach: boolean;
      }>[]
    >`
    SELECT
      bool_or(has_table_privilege('authenticated', class.oid, 'SELECT')) AS authenticated_reach,
      bool_or(has_table_privilege('anon', class.oid, 'SELECT')) AS anon_reach,
      bool_or(has_table_privilege('public', class.oid, 'SELECT')) AS public_reach
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relkind='r'
      AND class.relname = ANY(${AI_TWIN_0209_TABLES as unknown as string[]})
  `
  )[0];
  if (
    !reachability ||
    reachability.authenticated_reach ||
    reachability.anon_reach ||
    reachability.public_reach
  ) {
    refusePostH2("CATALOG_0209_REACHABILITY", "no browser or public role may reach AI-TWIN");
  }
  // 0209 must leave the Trader observation surface this lane later depends on exactly intact.
  const traderUntouched = (
    await sql<
      Readonly<{
        observation_revision_present: boolean;
        observation_policies: string;
        credential_column_grants: string;
      }>[]
    >`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='exchange_credentials'
          AND column_name='observation_revision'
      ) AS observation_revision_present,
      (
        SELECT count(*)::text FROM pg_policy
        WHERE polname IN ('trader_observer_state','trader_observation_reader_state',
          'trader_observer_credential_read','trader_observer_credential_lock',
          'trader_observation_reader_credential')
      ) AS observation_policies,
      (
        SELECT count(*)::text FROM information_schema.column_privileges
        WHERE table_schema='public' AND table_name='exchange_credentials'
          AND grantee='waia_account_observation_credential'
      ) AS credential_column_grants
  `
  )[0];
  if (
    !traderUntouched ||
    !traderUntouched.observation_revision_present ||
    Number(traderUntouched.observation_policies) !== 5 ||
    // 0209 must not have opened any credential authority in this database.
    Number(traderUntouched.credential_column_grants) !== 0
  ) {
    refusePostH2("CATALOG_0209_TRADER_BOUNDARY", "Trader surface must be unchanged by 0209");
  }
  return { relations, functions, exposure, reachability, traderUntouched };
}

/** DEE-1015 contract: the narrow, assignment-bound credential authority and nothing more. */
async function verify0210(sql: Sql): Promise<unknown> {
  const roles = await sql<
    Readonly<{
      rolname: string;
      rolcanlogin: boolean;
      rolinherit: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      memberships: string[];
    }>[]
  >`
    SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
      rolreplication,
      COALESCE((
        SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
        FROM pg_auth_members membership
        JOIN pg_roles parent ON parent.oid=membership.roleid
        WHERE membership.member=role.oid
      ), ARRAY[]::text[]) AS memberships
    FROM pg_roles role
    WHERE rolname='waia_account_observation_credential'
  `;
  const credential = roles[0];
  if (
    roles.length !== 1 ||
    !credential ||
    credential.rolcanlogin ||
    credential.rolinherit ||
    credential.rolsuper ||
    credential.rolbypassrls ||
    credential.rolcreatedb ||
    credential.rolcreaterole ||
    credential.rolreplication ||
    credential.memberships.length !== 0
  ) {
    refusePostH2("CATALOG_0210_ROLE", "unsafe credential role posture");
  }
  const grants = await sql<Readonly<{ column_name: string; privilege_type: string }>[]>`
    SELECT column_name, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='exchange_credentials'
      AND grantee='waia_account_observation_credential'
    ORDER BY column_name, privilege_type
  `;
  if (
    canonicalJson(grants.map((item) => item.column_name)) !==
      canonicalJson(OBSERVATION_CREDENTIAL_COLUMNS) ||
    grants.some((item) => item.privilege_type !== "SELECT")
  ) {
    refusePostH2("CATALOG_0210_COLUMN_GRANTS", "exact narrow credential projection required");
  }
  const privileges = (
    await sql<
      Readonly<{
        whole_table_select: boolean;
        withheld_reachable: boolean;
        credential_insert: boolean;
        credential_update: boolean;
        credential_delete: boolean;
        observer_secret: boolean;
        reader_secret: boolean;
        observer_wrapped: boolean;
        reader_wrapped: boolean;
        state_columns: string;
      }>[]
    >`
    SELECT
      has_table_privilege('waia_account_observation_credential',
        'public.exchange_credentials','SELECT') AS whole_table_select,
      bool_or(has_column_privilege('waia_account_observation_credential',
        'public.exchange_credentials', withheld, 'SELECT')) AS withheld_reachable,
      has_table_privilege('waia_account_observation_credential',
        'public.exchange_credentials','INSERT') AS credential_insert,
      has_table_privilege('waia_account_observation_credential',
        'public.exchange_credentials','UPDATE') AS credential_update,
      has_table_privilege('waia_account_observation_credential',
        'public.exchange_credentials','DELETE') AS credential_delete,
      has_column_privilege('waia_account_observer','public.exchange_credentials',
        'encrypted_payload','SELECT') AS observer_secret,
      has_column_privilege('waia_account_observation_reader','public.exchange_credentials',
        'encrypted_payload','SELECT') AS reader_secret,
      has_column_privilege('waia_account_observer','public.exchange_credentials',
        'wrapped_dek_key','SELECT') AS observer_wrapped,
      has_column_privilege('waia_account_observation_reader','public.exchange_credentials',
        'wrapped_dek_key','SELECT') AS reader_wrapped,
      (
        SELECT count(*)::text FROM information_schema.column_privileges
        WHERE table_schema='public' AND table_name='trader_account_collection_state'
          AND grantee='waia_account_observation_credential'
      ) AS state_columns
    FROM unnest(${OBSERVATION_CREDENTIAL_WITHHELD_COLUMNS as unknown as string[]}::text[]) withheld
  `
  )[0];
  if (
    !privileges ||
    // `has_table_privilege(...,'SELECT')` is true only for whole-table SELECT, never for a
    // column-level grant, so this is the exact full-table check DEE-1015 forbids.
    privileges.whole_table_select ||
    privileges.withheld_reachable ||
    privileges.credential_insert ||
    privileges.credential_update ||
    privileges.credential_delete ||
    privileges.observer_secret ||
    privileges.reader_secret ||
    privileges.observer_wrapped ||
    privileges.reader_wrapped ||
    Number(privileges.state_columns) !== 3
  ) {
    refusePostH2("CATALOG_0210_GRANTS", "restricted credential grants");
  }
  const policies = await Promise.all(
    ["trader_observation_credential_assignment", "trader_observation_credential_read"].map((name) =>
      policySnapshot(sql, name),
    ),
  );
  for (const policy of policies) {
    const expression = policy.using_expression ?? "";
    if (
      policy.command !== "r" ||
      !policy.permissive ||
      canonicalJson(policy.roles) !== canonicalJson(["waia_account_observation_credential"]) ||
      policy.check_expression !== null ||
      // Assignment-bound, never USING (true): the transaction-local context must be consulted.
      !expression.includes("waia.observation_org") ||
      !expression.includes("waia.observation_credential") ||
      !expression.includes("waia.observation_account") ||
      expression.trim() === "true"
    ) {
      refusePostH2("CATALOG_0210_POLICY", policy.policy_name);
    }
  }
  const credentialRead = policies.find(
    (policy) => policy.policy_name === "trader_observation_credential_read",
  );
  const readExpression = credentialRead?.using_expression ?? "";
  if (
    !readExpression.includes("trader_account_collection_state") ||
    !readExpression.includes("'active'")
  ) {
    refusePostH2("CATALOG_0210_POLICY", "credential read must be assignment and status bound");
  }
  const forceRls = (
    await sql<Readonly<{ force_row_security: boolean }>[]>`
    SELECT relforcerowsecurity AS force_row_security
    FROM pg_class WHERE oid='public.exchange_credentials'::regclass
  `
  )[0];
  if (forceRls?.force_row_security !== false) {
    refusePostH2("CATALOG_0210_FORCE_RLS", "0007 owner semantics must be preserved");
  }
  return { roles, grants, privileges, policies, forceRls };
}

const EXPECTED_POST_H2_CATALOG_DIGESTS: Readonly<Record<PostH2Step, string>> = Object.freeze({
  "0209": "937acae0d98a7a9c180966f8f0ff9b584ed24c7ee88800eb9c7ca6f082939426",
  "0210": "2d2ccd3c64d1dcfebe5daa8bc300fc9d93edc2379be782e666243ab9f2996d4d",
});

function quotedCatalogNames(names: readonly string[]): string {
  if (names.some((name) => !/^[A-Za-z0-9_]+$/.test(name))) {
    refusePostH2("CATALOG_INTERNAL_NAME", "unsafe verifier identity");
  }
  return names.map((name) => `'${name}'`).join(",");
}

async function collectExactPostH2CatalogSnapshot(sql: Sql, step: PostH2Step): Promise<unknown> {
  const profile =
    step === "0209"
      ? {
          relations: AI_TWIN_0209_TABLES,
          functions: AI_TWIN_0209_FUNCTIONS,
          // No role attributes are pinned here: `anon`/`authenticated` carry environment-specific
          // attributes, so 0209's isolation is proven by the grant and reachability checks instead.
          roles: [] as readonly string[],
        }
      : {
          relations: ["exchange_credentials", "trader_account_collection_state"],
          functions: [] as readonly string[],
          roles: [
            "waia_account_observation_credential",
            "waia_account_observation_reader",
            "waia_account_observer",
          ],
        };
  const relations = quotedCatalogNames(profile.relations);
  const functions = profile.functions.length > 0 ? quotedCatalogNames(profile.functions) : "''";
  const roles = profile.roles.length > 0 ? quotedCatalogNames(profile.roles) : "''";

  const relationRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,class.relname AS relation_name,
      class.relkind AS relation_kind,class.relrowsecurity AS row_security,
      class.relforcerowsecurity AS force_row_security,
      pg_get_userbyid(class.relowner)=current_user AS owner_is_current_user
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relname IN (${relations})
    ORDER BY schema_name,relation_name
  `);
  const columnRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,class.relname AS relation_name,
      attribute.attname AS column_name,
      format_type(attribute.atttypid,attribute.atttypmod) AS data_type,
      attribute.attnotnull AS not_null,attribute.attidentity AS identity_kind,
      attribute.attgenerated AS generated_kind,
      COALESCE(pg_get_expr(default_value.adbin,default_value.adrelid),'') AS default_expression
    FROM pg_attribute attribute
    JOIN pg_class class ON class.oid=attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    LEFT JOIN pg_attrdef default_value
      ON default_value.adrelid=attribute.attrelid AND default_value.adnum=attribute.attnum
    WHERE namespace.nspname='public' AND attribute.attnum>0 AND NOT attribute.attisdropped
      AND class.relname IN (${relations})
    ORDER BY schema_name,relation_name,attribute.attnum
  `);
  const constraintRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,class.relname AS relation_name,
      item.contype AS constraint_type,pg_get_constraintdef(item.oid,true) AS definition
    FROM pg_constraint item
    JOIN pg_class class ON class.oid=item.conrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relname IN (${relations})
    ORDER BY schema_name,relation_name,constraint_type,definition
  `);
  const indexRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,class.relname AS relation_name,
      pg_get_indexdef(index_item.indexrelid,0,true) AS definition
    FROM pg_index index_item
    JOIN pg_class class ON class.oid=index_item.indrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relname IN (${relations})
    ORDER BY schema_name,relation_name,definition
  `);
  const policyRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,class.relname AS relation_name,
      policy.polname AS policy_name,policy.polcmd AS command,
      policy.polpermissive AS permissive,
      ARRAY(
        SELECT CASE WHEN role_id=0 THEN 'PUBLIC' ELSE role.rolname END
        FROM unnest(policy.polroles) role_id
        LEFT JOIN pg_roles role ON role.oid=role_id
        ORDER BY CASE WHEN role_id=0 THEN 'PUBLIC' ELSE role.rolname END
      ) AS roles,
      COALESCE(pg_get_expr(policy.polqual,policy.polrelid),'') AS using_expression,
      COALESCE(pg_get_expr(policy.polwithcheck,policy.polrelid),'') AS check_expression
    FROM pg_policy policy
    JOIN pg_class class ON class.oid=policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relname IN (${relations})
    ORDER BY schema_name,relation_name,policy_name
  `);
  const triggerRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,class.relname AS relation_name,
      trigger.tgname AS trigger_name,trigger.tgenabled AS enabled,
      pg_get_triggerdef(trigger.oid,true) AS definition
    FROM pg_trigger trigger
    JOIN pg_class class ON class.oid=trigger.tgrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE NOT trigger.tgisinternal AND namespace.nspname='public'
      AND class.relname IN (${relations})
    ORDER BY schema_name,relation_name,trigger_name
  `);
  const functionRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,procedure.proname AS function_name,
      pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
      pg_get_function_result(procedure.oid) AS result_type,
      language.lanname AS language,procedure.provolatile AS volatility,
      procedure.prosecdef AS security_definer,
      COALESCE(procedure.proconfig,ARRAY[]::text[]) AS config,
      pg_get_userbyid(procedure.proowner)=current_user AS owner_is_current_user,
      pg_get_functiondef(procedure.oid) AS definition
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    JOIN pg_language language ON language.oid=procedure.prolang
    WHERE namespace.nspname='public' AND procedure.proname IN (${functions})
    ORDER BY schema_name,function_name,identity_arguments
  `);
  const roleRows = await sql.unsafe(`
    SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
      rolreplication,rolbypassrls,rolconnlimit
    FROM pg_roles WHERE rolname IN (${roles}) ORDER BY rolname
  `);
  // Only the authority these roles inherit is pinned. Which LOGIN identities are members of them
  // is provisioning state that legitimately differs per environment and is verified by the
  // DEE-1015 provisioning operator, not by a migration digest.
  const membershipRows = await sql.unsafe(`
    SELECT member.rolname AS member_name,granted.rolname AS granted_role,
      membership.admin_option,membership.inherit_option,membership.set_option
    FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid=membership.member
    JOIN pg_roles granted ON granted.oid=membership.roleid
    WHERE member.rolname IN (${roles})
    ORDER BY member_name,granted_role
  `);
  const tableGrantRows = await sql.unsafe(`
    SELECT table_schema,table_name,grantee,privilege_type,is_grantable
    FROM information_schema.table_privileges
    WHERE table_schema='public' AND table_name IN (${relations}) AND grantee<>current_user
    ORDER BY table_schema,table_name,grantee,privilege_type
  `);
  const columnGrantRows = await sql.unsafe(`
    SELECT table_schema,table_name,column_name,grantee,privilege_type,is_grantable
    FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name IN (${relations}) AND grantee<>current_user
    ORDER BY table_schema,table_name,column_name,grantee,privilege_type
  `);
  return Object.freeze({
    relationRows,
    columnRows,
    constraintRows,
    indexRows,
    policyRows,
    triggerRows,
    functionRows,
    roleRows,
    membershipRows,
    tableGrantRows,
    columnGrantRows,
  });
}

export async function verifyPostH2MigrationCatalog(sql: Sql, step: PostH2Step): Promise<string> {
  if (step === "0209") {
    await verify0209(sql);
  } else {
    await verify0210(sql);
  }
  const digest = semanticDigest(await collectExactPostH2CatalogSnapshot(sql, step));
  const expected = EXPECTED_POST_H2_CATALOG_DIGESTS[step];
  if (digest !== expected) {
    refusePostH2("CATALOG_DIGEST_MISMATCH", `${step}:${digest}`);
  }
  return digest;
}

async function acquirePostH2Locks(sql: Sql, source: PostH2CanonicalSource): Promise<void> {
  await sql.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await sql.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
  await sql.unsafe("SET LOCAL idle_in_transaction_session_timeout = '15000ms'");
  await sql.unsafe("SET LOCAL synchronous_commit = on");
  // First snapshot-relevant operation: waiting on the journal before any SELECT means a
  // SERIALIZABLE snapshot cannot predate a generic migrator that commits while we block.
  await sql.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
  for (const relation of source.selected.lockRelations) {
    await sql.unsafe(`LOCK TABLE ${relation} IN ACCESS EXCLUSIVE MODE`);
  }
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${ADVISORY_LOCK_KEY},0))`;
  const durability = await sql<Readonly<{ synchronous_commit: string }>[]>`
    SELECT current_setting('synchronous_commit') AS synchronous_commit
  `;
  if (durability[0]?.synchronous_commit !== "on") {
    refusePostH2("SYNCHRONOUS_COMMIT_REQUIRED", source.selected.step);
  }
}

function buildReceipt(
  input: Omit<PostH2OperationReceipt, "schemaVersion" | "contentDigestHex">,
): PostH2OperationReceipt {
  const body = Object.freeze({ schemaVersion: POST_H2_MIGRATION_RECEIPT_SCHEMA, ...input });
  return Object.freeze({ ...body, contentDigestHex: semanticDigest(body) });
}

function receiptAttestationFields(evidence: PostH2CeremonyEvidence) {
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

async function verifyReadOnly(
  input: PostH2OperationInput,
  source: PostH2CanonicalSource,
  evidence: PostH2CeremonyEvidence,
  dependencies: PostH2OperatorDependencies,
  liveJournalDigestBefore: string,
  applyMetadata?: Readonly<{
    transactionIdentity: string;
    catalogVerificationDigest: string;
    commitTimestamp: string;
  }>,
): Promise<PostH2OperationReceipt> {
  const connect = dependencies.connect ?? openPostgres;
  const pool = connect(input.databaseUrl, true);
  const reserved = await pool.reserve();
  const sql = reserved as unknown as Sql;
  let transactionOpen = false;
  try {
    await sql.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const target = await readPostH2TargetIdentity(sql);
    const targetFingerprint = await assertMigrationAuthority(
      sql,
      source,
      target,
      evidence,
      input.expectedTargetFingerprint,
      false,
    );
    const rows = await readPostH2LiveJournal(sql);
    let classification: PostH2OperationReceipt["classification"];
    let journalDigestAfter: string;
    let catalogVerificationDigest: string | null = null;
    if (applyMetadata) {
      journalDigestAfter = assertExactPostH2Journal(
        rows,
        source.expectedAppliedPrefix,
        `${input.step}:applied`,
      );
      classification = "SELECTED_STEP_COMMITTED";
      catalogVerificationDigest = await verifyPostH2MigrationCatalog(sql, input.step);
    } else {
      const classified = classifyPostH2VerifyOnlyJournal(rows, source);
      classification = classified.classification;
      journalDigestAfter = classified.journalDigest;
      if (classification === "SELECTED_STEP_COMMITTED") {
        catalogVerificationDigest = await verifyPostH2MigrationCatalog(sql, input.step);
      }
    }
    if (applyMetadata && catalogVerificationDigest !== applyMetadata.catalogVerificationDigest) {
      refusePostH2("POST_COMMIT_CATALOG_MISMATCH", input.step);
    }
    const receipt = buildReceipt({
      mode: input.verifyOnly ? "VERIFY_ONLY" : "APPLY",
      classification,
      targetFingerprint,
      selectedStep: input.step,
      sourceCommit: source.selected.sourceCommit,
      sourceBlob: source.selected.sourceBlob,
      sourceSha256: source.selected.sha256,
      predecessorMigration: source.selected.predecessor,
      liveJournalDigestBefore: liveJournalDigestBefore || journalDigestAfter,
      ...receiptAttestationFields(evidence),
      transactionIdentity: applyMetadata?.transactionIdentity ?? null,
      catalogVerificationDigest,
      journalDigestAfter,
      commitTimestamp: applyMetadata?.commitTimestamp ?? null,
      postCommitVerification: Object.freeze({
        readOnlyConnection: true,
        exactJournal: true,
        exactCatalog: classification === "SELECTED_STEP_COMMITTED",
        genericMigratorUsed: false,
        aiTwinRuntimeActivated: false,
      }),
      nextStepExecuted: false,
    });
    await sql.unsafe("COMMIT");
    transactionOpen = false;
    return receipt;
  } catch (error) {
    if (transactionOpen) await sql.unsafe("ROLLBACK").catch(() => undefined);
    if (error instanceof PostH2MigrationOperatorError) throw error;
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "UNKNOWN")
        : "UNKNOWN";
    refusePostH2("READ_ONLY_VERIFICATION_FAILED", code);
  } finally {
    reserved.release();
    await pool.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function runPostH2MigrationOperation(
  input: PostH2OperationInput,
  dependencies: PostH2OperatorDependencies = {},
): Promise<PostH2OperationReceipt> {
  assertDirectPostgresUrl(input.databaseUrl);
  if (
    (dependencies.testHooks || dependencies.approvedHumanKeySha256) &&
    process.env.NODE_ENV !== "test"
  ) {
    refusePostH2("TEST_HOOK_FORBIDDEN", "test hooks require NODE_ENV=test");
  }
  if (!input.verifyOnly && input.confirmedStep !== input.step) {
    refusePostH2("EXACT_STEP_CONFIRMATION_REQUIRED", input.step);
  }
  const source = loadPostH2CanonicalSource(input.repoRoot, input.step);
  const approvedHumanKeySha256 =
    dependencies.approvedHumanKeySha256 ?? readPostH2ApprovedHumanKeySha256();
  const evidence = loadPostH2CeremonyEvidence({
    step: input.step,
    trustedHumanPublicKeyPath: input.trustedHumanPublicKeyPath,
    expectedHumanSigningKeySha256: approvedHumanKeySha256,
    restorePointPath: input.restorePointAttestationPath,
    writerQuiescencePath: input.writerQuiescenceAttestationPath,
    targetIdentityPath: input.targetIdentityAttestationPath,
    ceremonyAuthorizationPath: input.ceremonyAuthorizationAttestationPath,
  });
  if (evidence.ceremonyAuthorization.targetFingerprint !== input.expectedTargetFingerprint) {
    refusePostH2("COMMAND_ATTESTATION_TARGET_MISMATCH", input.step);
  }
  const connect = dependencies.connect ?? openPostgres;
  if (input.verifyOnly) {
    return verifyReadOnly(input, source, evidence, dependencies, "");
  }

  const pool = connect(input.databaseUrl, false);
  const reserved = await pool.reserve();
  const sql = reserved as unknown as Sql;
  let liveJournalDigestBefore = "";
  let transactionIdentity = "";
  let catalogVerificationDigest = "";
  let commitTimestamp = "";
  let transactionOpen = false;
  try {
    const target = await readPostH2TargetIdentity(sql);
    await assertMigrationAuthority(
      sql,
      source,
      target,
      evidence,
      input.expectedTargetFingerprint,
      true,
    );
    await assertRelevantWritersQuiesced(sql);
    // The journal is the authoritative state machine, so it is consulted before the catalog
    // cross-check: an unlawful predecessor must be reported as such, not as catalog drift.
    const before = await readPostH2LiveJournal(sql);
    liveJournalDigestBefore = assertExactPostH2Journal(
      before,
      source.expectedPredecessorPrefix,
      `${input.step}:predecessor`,
    );
    await assertCatalogPrecondition(sql, input.step);

    await sql.unsafe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    try {
      await acquirePostH2Locks(sql, source);
      const lockedTarget = await readPostH2TargetIdentity(sql);
      await assertMigrationAuthority(
        sql,
        source,
        lockedTarget,
        evidence,
        input.expectedTargetFingerprint,
        true,
      );
      await assertRelevantWritersQuiesced(sql);
      const lockedJournal = await readPostH2LiveJournal(sql);
      assertExactPostH2Journal(
        lockedJournal,
        source.expectedPredecessorPrefix,
        `${input.step}:locked-predecessor`,
      );
      await assertCatalogPrecondition(sql, input.step);
      // Exactly the one pinned migration; never a Drizzle high-water walk.
      await sql.unsafe(source.sql.toString("utf8")).simple();
      await sql`
        INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
        VALUES (${source.selected.sha256},${source.selected.when})
      `;
      await dependencies.testHooks?.beforeCatalogVerification?.(sql, source);
      const applied = await readPostH2LiveJournal(sql);
      assertExactPostH2Journal(applied, source.expectedAppliedPrefix, `${input.step}:pre-commit`);
      catalogVerificationDigest = await verifyPostH2MigrationCatalog(sql, input.step);
      const transactionRows = await sql<Readonly<{ transaction_id: string }>[]>`
        SELECT txid_current()::text AS transaction_id
      `;
      const transaction = transactionRows[0];
      if (!transaction) refusePostH2("TRANSACTION_IDENTITY_MISSING", input.step);
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
      refusePostH2(
        "COMMIT_RESULT_UNCERTAIN",
        `do not retry; run --verify-only --step ${input.step}`,
      );
    }
  } catch (error) {
    if (error instanceof PostH2MigrationOperatorError) throw error;
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "UNKNOWN")
        : "UNKNOWN";
    if (code === "55P03" || code === "57014") {
      refusePostH2("LOCK_TIMEOUT", input.step);
    }
    refusePostH2("TRANSACTION_FAILED", `${input.step}:${code}`);
  } finally {
    if (transactionOpen) await sql.unsafe("ROLLBACK").catch(() => undefined);
    reserved.release();
    await pool.end({ timeout: 5 }).catch(() => undefined);
  }
  // Exactly one step per invocation: 0210 needs a new Human packet and a second invocation.
  return verifyReadOnly(input, source, evidence, dependencies, liveJournalDigestBefore, {
    transactionIdentity,
    catalogVerificationDigest,
    commitTimestamp,
  });
}

type CliArguments = Omit<PostH2OperationInput, "databaseUrl" | "repoRoot">;

export function parsePostH2CliArguments(argv: readonly string[]): CliArguments {
  const values = new Map<string, string>();
  let verifyOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--verify-only") {
      if (verifyOnly) refusePostH2("CLI_DUPLICATE_OPTION", argument);
      verifyOnly = true;
      continue;
    }
    // No --latest, --all, --continue or --next exists: there is nothing to opt into.
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
      refusePostH2("CLI_OPTION", argument);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) refusePostH2("CLI_OPTION_VALUE", argument);
    values.set(argument, value);
    index += 1;
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) refusePostH2("CLI_REQUIRED_OPTION", name);
    return value;
  };
  const step = parsePostH2Step(required("--step"));
  const confirmed = values.get("--confirm-exact-step");
  if (verifyOnly && confirmed) refusePostH2("VERIFY_ONLY_CONFIRMATION_FORBIDDEN", confirmed);
  return Object.freeze({
    step,
    verifyOnly,
    confirmedStep: confirmed ? parsePostH2Step(confirmed) : undefined,
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
    refusePostH2("CLI_ENVIRONMENT", "WAIA_TRADER_CLI=1 required");
  }
  const databaseUrl = process.env.DATABASE_URL_POSTGRES_SESSION?.trim();
  if (!databaseUrl) {
    refusePostH2("DATABASE_URL_REQUIRED", "DATABASE_URL_POSTGRES_SESSION");
  }
  const args = parsePostH2CliArguments(process.argv.slice(2));
  const receipt = await runPostH2MigrationOperation({
    ...args,
    databaseUrl,
    repoRoot: process.cwd(),
  });
  process.stdout.write(canonicalJson(receipt) + "\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    if (error instanceof PostH2MigrationOperatorError) {
      process.stderr.write(error.message + "\n");
    } else {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code ?? "UNKNOWN")
          : "UNKNOWN";
      process.stderr.write(`POST_H2_MIGRATION_REFUSED:UNEXPECTED:${code}\n`);
    }
    process.exitCode = 1;
  });
}
