import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import postgres from "postgres";

import {
  H2_MIGRATION_RECEIPT_SCHEMA,
  H2MigrationOperatorError,
  assertExactJournal,
  canonicalJson,
  classifyH2VerifyOnlyJournal,
  loadH2CanonicalSource,
  loadH2CeremonyEvidence,
  parseH2Step,
  readH2ApprovedHumanKeySha256,
  refuseH2,
  semanticDigest,
  type H2AppliedMigration,
  type H2CanonicalSource,
  type H2CeremonyEvidence,
  type H2Step,
} from "./postgres-h2-migration-manifest-v1";
import {
  extraInsertApplicableRunnerPolicies,
  LEFTOVER_ORG_SCOPE_POLICY_NAME,
} from "./postgres-h2-leftover-org-scope-policy-v1";
import {
  assertRoutineExecuteBounded,
  collectCanonicalRelationAuthority,
  collectCanonicalSchemaAuthority,
  partitionCreatorMemberships,
  sortCatalogRows,
  type MembershipRow,
} from "./postgres-migration-catalog-authority-v1";

const LOCK_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 120_000;
const ADVISORY_LOCK_KEY = "waia.trader.h2.migration-operator.v1";
const TARGET_FINGERPRINT = /^[0-9a-f]{64}$/;

type Sql = postgres.Sql;

export type H2TargetIdentity = Readonly<{
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

export type H2OperationReceipt = Readonly<{
  schemaVersion: typeof H2_MIGRATION_RECEIPT_SCHEMA;
  mode: "APPLY" | "VERIFY_ONLY";
  classification: "SELECTED_STEP_COMMITTED" | "PREDECESSOR_NOT_APPLIED";
  targetFingerprint: string;
  selectedStep: H2Step;
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
    migration0209Observed: false;
  }>;
  nextStepExecuted: false;
  contentDigestHex: string;
}>;

export type H2OperationInput = Readonly<{
  step: H2Step;
  expectedTargetFingerprint: string;
  databaseUrl: string;
  repoRoot: string;
  verifyOnly: boolean;
  confirmedStep?: H2Step;
  trustedHumanPublicKeyPath: string;
  restorePointAttestationPath: string;
  writerQuiescenceAttestationPath: string;
  targetIdentityAttestationPath: string;
  ceremonyAuthorizationAttestationPath: string;
}>;

export type H2OperatorTestHooks = Readonly<{
  beforeCatalogVerification?(sql: Sql, source: H2CanonicalSource): Promise<void>;
  afterCommit?(): Promise<void>;
}>;

export type H2OperatorDependencies = Readonly<{
  connect?(url: string, readOnly: boolean): Sql;
  approvedHumanKeySha256?: string;
  testHooks?: H2OperatorTestHooks;
}>;

function openPostgres(url: string, readOnly: boolean): Sql {
  return postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
    max_lifetime: null,
    connection: {
      application_name: "waia-h2-migration-operator-v1",
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
    refuseH2("DATABASE_URL_INVALID", "session/direct PostgreSQL URL required");
  }
  const poolMode = parsed.searchParams.get("pool_mode") ?? parsed.searchParams.get("poolmode");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol.toLowerCase()) ||
    !parsed.hostname ||
    !parsed.username ||
    parsed.port === "6543" ||
    poolMode?.toLowerCase() === "transaction"
  ) {
    refuseH2("DATABASE_URL_UNSAFE", "transaction pooling and incomplete URLs are forbidden");
  }
}

export async function readH2TargetIdentity(sql: Sql): Promise<H2TargetIdentity> {
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
    refuseH2("TARGET_IDENTITY_UNAVAILABLE", "journal owner and TCP endpoint required");
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

export function computeH2TargetFingerprint(identity: H2TargetIdentity): string {
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
  source: H2CanonicalSource,
  target: H2TargetIdentity,
  evidence: H2CeremonyEvidence,
  expectedTargetFingerprint: string,
  requireWritable: boolean,
): Promise<string> {
  const targetFingerprint = computeH2TargetFingerprint(target);
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
    (source.selected.step === "0205" && !target.roleSuperuser && !target.roleCreateRole)
  ) {
    refuseH2("TARGET_IDENTITY_OR_AUTHORITY", source.selected.step);
  }
  for (const relation of source.selected.ownerRelations) {
    const rows = await sql<Readonly<{ relation: string | null; owner: string | null }>[]>`
      SELECT to_regclass(${relation})::text AS relation,
        pg_get_userbyid(class.relowner) AS owner
      FROM pg_class class
      WHERE class.oid=to_regclass(${relation})
    `;
    if (!rows[0]?.relation || rows[0].owner !== target.currentUser) {
      refuseH2("MIGRATION_AUTHORITY_RELATION", relation);
    }
  }
  return targetFingerprint;
}

export async function readH2LiveJournal(sql: Sql): Promise<H2AppliedMigration[]> {
  const rows = await sql<Readonly<{ hash: string; created_at: string }>[]>`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at, id
  `;
  return rows.map((row) => Object.freeze({ hash: row.hash, createdAt: row.created_at }));
}

async function assertNo0209Objects(sql: Sql): Promise<void> {
  const rows = await sql<Readonly<{ identity: string }>[]>`
    SELECT namespace.nspname || '.' || class.relname AS identity
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relname LIKE 'ai_twin_%'
    UNION ALL
    SELECT namespace.nspname || '.' || procedure.proname AS identity
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public' AND procedure.proname LIKE 'ai_twin_%'
    ORDER BY identity
  `;
  if (rows.length > 0) refuseH2("0209_FORBIDDEN", "AI-TWIN 0209 catalog objects observed");
}

async function assertRelevantWritersQuiesced(sql: Sql): Promise<void> {
  const rows = await sql<Readonly<{ pid: number }>[]>`
    SELECT pid
    FROM pg_stat_activity
    WHERE datname=current_database()
      AND pid<>pg_backend_pid()
      AND backend_type='client backend'
      AND application_name<>'waia-h2-migration-operator-v1'
      AND (
        usename IN ('waia_historical_runner_login','waia_account_observer_login')
        OR application_name ~* '(waia|trader|historical|forecast|execution|account.?observation)'
        OR (
          state IS DISTINCT FROM 'idle'
          AND query ~* '(exchange_credentials|trader_account_|trader_scientific_|trader_historical_)'
        )
      )
  `;
  if (rows.length > 0) refuseH2("WRITERS_NOT_QUIESCED", String(rows.length));
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
  if (rows.length !== 1) refuseH2("CATALOG_POLICY", policyName);
  return rows[0]!;
}

async function verify0205(sql: Sql): Promise<unknown> {
  const roles = await sql<
    Readonly<{
      rolname: string;
      rolcanlogin: boolean;
      rolinherit: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>[]
  >`
    SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole
    FROM pg_roles
    WHERE rolname IN ('waia_account_observer','waia_account_observation_reader')
    ORDER BY rolname
  `;
  if (
    roles.length !== 2 ||
    roles.some(
      (role) =>
        role.rolcanlogin ||
        role.rolsuper ||
        role.rolbypassrls ||
        role.rolcreatedb ||
        role.rolcreaterole ||
        (role.rolname === "waia_account_observation_reader" && role.rolinherit),
    )
  ) {
    refuseH2("CATALOG_0205_ROLES", "unsafe role posture");
  }
  const tables = await sql<
    Readonly<{
      relname: string;
      row_security: boolean;
      force_row_security: boolean;
    }>[]
  >`
    SELECT relname,relrowsecurity AS row_security,relforcerowsecurity AS force_row_security
    FROM pg_class
    WHERE oid IN (
      'public.trader_account_collection_state'::regclass,
      'public.trader_account_observations'::regclass
    )
    ORDER BY relname
  `;
  if (
    tables.length !== 2 ||
    tables.some((table) => !table.row_security || !table.force_row_security)
  ) {
    refuseH2("CATALOG_0205_RLS", "table posture");
  }
  const columns = await sql<Readonly<{ column_name: string; is_nullable: string }>[]>`
    SELECT column_name,is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exchange_credentials'
      AND column_name='observation_revision'
  `;
  if (columns.length !== 1 || columns[0]?.is_nullable !== "NO") {
    refuseH2("CATALOG_0205_REVISION", "column");
  }
  const triggerRows = await sql<Readonly<{ trigger_name: string; enabled: string }>[]>`
    SELECT trigger.tgname AS trigger_name,trigger.tgenabled AS enabled
    FROM pg_trigger trigger
    WHERE NOT trigger.tgisinternal
      AND trigger.tgname IN (
        'trader_observation_credential_revision',
        'trader_observation_immutable'
      )
    ORDER BY trigger.tgname
  `;
  if (triggerRows.length !== 2 || triggerRows.some((trigger) => trigger.enabled === "D")) {
    refuseH2("CATALOG_0205_TRIGGERS", "trigger posture");
  }
  const policyNames = [
    "trader_observation_reader_credential",
    "trader_observation_reader_records",
    "trader_observation_reader_state",
    "trader_observer_credential_lock",
    "trader_observer_credential_read",
    "trader_observer_records",
    "trader_observer_state",
  ];
  const policies = await Promise.all(policyNames.map((name) => policySnapshot(sql, name)));
  const privileges = (
    await sql<
      Readonly<{
        reader_secret: boolean;
        reader_insert: boolean;
        observer_secret: boolean;
        observer_revision_update: boolean;
        public_immutable_execute: boolean;
        public_revision_execute: boolean;
      }>[]
    >`
    SELECT
      has_column_privilege('waia_account_observation_reader','public.exchange_credentials',
        'encrypted_payload','SELECT') AS reader_secret,
      has_table_privilege('waia_account_observation_reader',
        'public.trader_account_observations','INSERT') AS reader_insert,
      has_column_privilege('waia_account_observer','public.exchange_credentials',
        'encrypted_payload','SELECT') AS observer_secret,
      has_column_privilege('waia_account_observer','public.exchange_credentials',
        'observation_revision','UPDATE') AS observer_revision_update,
      has_function_privilege('public','public.trader_observation_immutable()',
        'EXECUTE') AS public_immutable_execute,
      has_function_privilege('public','public.trader_observation_credential_revision()',
        'EXECUTE') AS public_revision_execute
  `
  )[0];
  if (
    !privileges ||
    privileges.reader_secret ||
    privileges.reader_insert ||
    privileges.observer_secret ||
    !privileges.observer_revision_update ||
    privileges.public_immutable_execute ||
    privileges.public_revision_execute
  ) {
    refuseH2("CATALOG_0205_GRANTS", "restricted grants");
  }
  return { roles, tables, columns, triggerRows, policies, privileges };
}

async function verifyAdmissionPolicy(sql: Sql, step: "0206" | "0207"): Promise<unknown> {
  const policy = await policySnapshot(sql, "historical_scientific_admission_runner_insert_v2");
  const expression = policy.check_expression ?? "";
  const common = [
    "multiclass-brier-reward/v1",
    "terminal-multiclass-brier-reward/v1",
    "694d625c2120d3e5410a7395646bd0bae728ea08e08fc8ea93043061cdb8d8de",
    "REQUEST_EXACT_PRE_HOLDOUT_TECHNICAL_PROPOSAL",
  ];
  const versionTokens =
    step === "0206"
      ? [
          "scientific-admission-receipt/v3",
          "predictive-terminal-receipt/v2",
          "research-harness-admission/v4",
        ]
      : [
          "scientific-admission-receipt/v4",
          "predictive-terminal-receipt/v3",
          "research-harness-admission/v5",
          "cdf-erf-cody715/v2",
          "7b8dfb5540833d8e915ecf2456594e366e0fc9c11c8e33f9df6a0732f3d8a09f",
        ];
  const forbidden = step === "0206" ? ["cdf-erf-cody715/v2"] : ["scientific-admission-receipt/v3"];
  if (
    policy.command !== "a" ||
    !policy.permissive ||
    canonicalJson(policy.roles) !== canonicalJson(["waia_historical_runner"]) ||
    policy.using_expression !== null ||
    [...common, ...versionTokens].some((token) => !expression.includes(token)) ||
    forbidden.some((token) => expression.includes(token))
  ) {
    refuseH2(`CATALOG_${step}_POLICY`, "admission policy identity");
  }
  const extras = extraInsertApplicableRunnerPolicies(await admissionRunnerPolicies(sql));
  if (extras.length > 0) {
    refuseH2(`CATALOG_${step}_EXTRA_INSERT_POLICY`, extras.join(","));
  }
  return policy;
}

async function admissionRunnerPolicies(sql: Sql) {
  const rows = await sql<
    Readonly<{
      policy_name: string;
      command: string;
      permissive: boolean;
      roles: string[];
    }>[]
  >`
    SELECT policy.polname AS policy_name, policy.polcmd AS command,
      policy.polpermissive AS permissive,
      ARRAY(
        SELECT role.rolname FROM pg_roles role
        WHERE role.oid=ANY(policy.polroles)
        ORDER BY role.rolname
      ) AS roles
    FROM pg_policy policy
    JOIN pg_class class ON class.oid=policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public'
      AND class.relname='trader_scientific_admission_receipt_v1'
    ORDER BY policy.polname
  `;
  return rows.map((row) =>
    Object.freeze({
      policyName: row.policy_name,
      command: row.command,
      permissive: row.permissive,
      roles: Object.freeze([...row.roles]),
    }),
  );
}

async function assertNoLeftoverOrgScopePolicy(sql: Sql, step: H2Step): Promise<void> {
  const rows = await sql<Readonly<{ relation_name: string }>[]>`
    SELECT class.relname AS relation_name
    FROM pg_policy policy
    JOIN pg_class class ON class.oid=policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public'
      AND policy.polname=${LEFTOVER_ORG_SCOPE_POLICY_NAME}
    ORDER BY class.relname
  `;
  if (rows.length > 0) {
    refuseH2(`CATALOG_${step}_LEFTOVER_ORG_SCOPE`, rows.map((row) => row.relation_name).join(","));
  }
}

async function verify0208(sql: Sql): Promise<unknown> {
  const tableNames = [
    "trader_historical_rehearsal_started_v1",
    "trader_historical_scientific_admission_refusal_v1",
  ] as const;
  const tables = await sql<
    Readonly<{
      relname: string;
      row_security: boolean;
      force_row_security: boolean;
    }>[]
  >`
    SELECT relname,relrowsecurity AS row_security,relforcerowsecurity AS force_row_security
    FROM pg_class
    WHERE oid IN (
      'public.trader_historical_rehearsal_started_v1'::regclass,
      'public.trader_historical_scientific_admission_refusal_v1'::regclass
    )
    ORDER BY relname
  `;
  if (
    tables.length !== 2 ||
    tables.some((table) => !table.row_security || !table.force_row_security)
  ) {
    refuseH2("CATALOG_0208_RLS", "table posture");
  }
  const expectedColumns = Object.freeze({
    trader_historical_rehearsal_started_v1: [
      "account_id",
      "admin_observation_binding_digest_hex",
      "consumer_claim_digest_hex",
      "content_digest_hex",
      "created_at",
      "four_surface_authority_content_digest_hex",
      "four_surface_authority_id",
      "id",
      "image_health_binding_digest_hex",
      "lease_digest_hex",
      "lifecycle_content_digest_hex",
      "organization_id",
      "proposal_content_digest_hex",
      "proposal_id",
      "ratification_content_digest_hex",
      "ratification_id",
      "receipt_json",
      "release_sha",
      "run_id",
      "runtime_release_binding_receipt_digest_hex",
      "schema_version",
      "tenant_observation_binding_digest_hex",
    ],
    trader_historical_scientific_admission_refusal_v1: [
      "content_digest_hex",
      "coverage_digest_hex",
      "created_at",
      "holm_family_pass",
      "id",
      "organization_id",
      "reason_code",
      "receipt_json",
      "release_sha",
      "run_id",
      "runtime_release_binding_receipt_digest_hex",
      "schema_version",
    ],
  });
  const columns = await sql<Readonly<{ table_name: string; column_name: string }>[]>`
    SELECT table_name,column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN (
      'trader_historical_rehearsal_started_v1',
      'trader_historical_scientific_admission_refusal_v1'
    )
    ORDER BY table_name,column_name
  `;
  for (const tableName of tableNames) {
    const actual = columns
      .filter((column) => column.table_name === tableName)
      .map((column) => column.column_name);
    if (
      canonicalJson(actual) !==
      canonicalJson(expectedColumns[tableName as keyof typeof expectedColumns])
    ) {
      refuseH2("CATALOG_0208_COLUMNS", tableName);
    }
  }
  const triggers = await sql<Readonly<{ trigger_name: string; enabled: string }>[]>`
    SELECT trigger.tgname AS trigger_name,trigger.tgenabled AS enabled
    FROM pg_trigger trigger
    WHERE NOT trigger.tgisinternal
      AND trigger.tgname IN (
        'historical_rehearsal_started_v1_block_mutation',
        'historical_scientific_admission_refusal_v1_block_mutation'
      )
    ORDER BY trigger.tgname
  `;
  if (triggers.length !== 2 || triggers.some((trigger) => trigger.enabled === "D")) {
    refuseH2("CATALOG_0208_TRIGGERS", "append-only triggers");
  }
  const policyNames = [
    "historical_rehearsal_started_v1_deny_browser",
    "historical_rehearsal_started_v1_owner_read",
    "historical_rehearsal_started_v1_runner_insert",
    "historical_rehearsal_started_v1_runner_read",
    "historical_scientific_admission_refusal_v1_deny_browser",
    "historical_scientific_admission_refusal_v1_owner_read",
    "historical_scientific_admission_refusal_v1_runner_insert",
    "historical_scientific_admission_refusal_v1_runner_read",
  ];
  const policies = await Promise.all(policyNames.map((name) => policySnapshot(sql, name)));
  const constraintRows = await sql<Readonly<{ definition: string }>[]>`
    SELECT pg_get_constraintdef(item.oid, true) AS definition
    FROM pg_constraint item
    WHERE item.conrelid IN (
      'public.trader_historical_rehearsal_started_v1'::regclass,
      'public.trader_historical_scientific_admission_refusal_v1'::regclass
    )
    ORDER BY item.conrelid::regclass::text,item.contype,item.conname
  `;
  const constraints = constraintRows.map((row) => row.definition).join("\n");
  for (const token of [
    "UNIQUE (organization_id, run_id)",
    "FOREIGN KEY (proposal_id, organization_id, run_id, proposal_content_digest_hex)",
    "FOREIGN KEY (four_surface_authority_id, organization_id, run_id",
    "waia.trader.historical_scientific_admission_refusal.v1",
    "waia.trader.historical_rehearsal_started.v1",
  ]) {
    if (!constraints.includes(token)) refuseH2("CATALOG_0208_CONSTRAINTS", token);
  }
  const functionRows = await sql<Readonly<{ name: string; volatility: string }>[]>`
    SELECT procedure.proname AS name,procedure.provolatile AS volatility
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public'
      AND procedure.proname='waia_historical_refusal_comparison_identities_valid_v1'
  `;
  if (functionRows.length !== 1 || functionRows[0]?.volatility !== "i") {
    refuseH2("CATALOG_0208_FUNCTION", "comparison identity validator");
  }
  const privileges = (
    await sql<
      Readonly<{
        runner_refusal_select: boolean;
        runner_refusal_insert: boolean;
        runner_rehearsal_select: boolean;
        runner_rehearsal_insert: boolean;
        browser_refusal_insert: boolean;
        browser_rehearsal_insert: boolean;
      }>[]
    >`
    SELECT
      has_table_privilege('waia_historical_runner',
        'public.trader_historical_scientific_admission_refusal_v1','SELECT')
        AS runner_refusal_select,
      has_any_column_privilege('waia_historical_runner',
        'public.trader_historical_scientific_admission_refusal_v1','INSERT')
        AS runner_refusal_insert,
      has_table_privilege('waia_historical_runner',
        'public.trader_historical_rehearsal_started_v1','SELECT')
        AS runner_rehearsal_select,
      has_any_column_privilege('waia_historical_runner',
        'public.trader_historical_rehearsal_started_v1','INSERT')
        AS runner_rehearsal_insert,
      has_any_column_privilege('authenticated',
        'public.trader_historical_scientific_admission_refusal_v1','INSERT')
        AS browser_refusal_insert,
      has_any_column_privilege('authenticated',
        'public.trader_historical_rehearsal_started_v1','INSERT')
        AS browser_rehearsal_insert
  `
  )[0];
  if (
    !privileges?.runner_refusal_select ||
    !privileges.runner_refusal_insert ||
    !privileges.runner_rehearsal_select ||
    !privileges.runner_rehearsal_insert ||
    privileges.browser_refusal_insert ||
    privileges.browser_rehearsal_insert
  ) {
    refuseH2("CATALOG_0208_GRANTS", "restricted grants");
  }
  return { tables, columns, triggers, policies, constraintRows, functionRows, privileges };
}

/**
 * DEE-1020: re-derived from the canonical authority projection. DEE-1021 re-derived the same
 * values after pinning snapshot row order to bytewise C/JavaScript string order: libc alpine PG17
 * and ICU Supabase PG 17.6 then converge bit-for-bit. None of these constants was fitted to a target.
 */
const EXPECTED_H2_CATALOG_DIGESTS: Readonly<Record<H2Step, string>> = Object.freeze({
  "0205": "66a37ae088833a64eadded9a578fb22411948f3d230034c28b90dfae84858189",
  "0206": "27a38ce544ccce8438f87224fafea6460fb3697cadab55619860ca607387fec4",
  "0207": "acc4776cfbce2b4552522c1bb7abb488ab4ddcb3a34e198dc6c9134333008ef9",
  "0208": "45a30db82cf4ddcce697d215843b5d6b285758f5cc3169e68fd6b5ad71368420",
});

function quotedCatalogNames(names: readonly string[]): string {
  if (names.some((name) => !/^[A-Za-z0-9_]+$/.test(name))) {
    refuseH2("CATALOG_INTERNAL_NAME", "unsafe verifier identity");
  }
  return names.map((name) => `'${name}'`).join(",");
}

async function collectExactH2CatalogSnapshot(sql: Sql, step: H2Step): Promise<unknown> {
  const profile =
    step === "0205"
      ? {
          relations: [
            "exchange_credentials",
            "trader_account_collection_state",
            "trader_account_observations",
          ],
          completeRelations: ["trader_account_collection_state", "trader_account_observations"],
          policies: [
            "trader_observation_reader_credential",
            "trader_observation_reader_records",
            "trader_observation_reader_state",
            "trader_observer_credential_lock",
            "trader_observer_credential_read",
            "trader_observer_records",
            "trader_observer_state",
          ],
          triggers: ["trader_observation_credential_revision", "trader_observation_immutable"],
          functions: ["trader_observation_credential_revision", "trader_observation_immutable"],
          roles: ["waia_account_observation_reader", "waia_account_observer"],
          grantees: [
            "PUBLIC",
            "anon",
            "authenticated",
            "waia_account_observation_reader",
            "waia_account_observer",
          ],
        }
      : step === "0206" || step === "0207"
        ? {
            relations: ["trader_scientific_admission_receipt_v1"],
            completeRelations: [],
            policies: ["historical_scientific_admission_runner_insert_v2"],
            triggers: [],
            functions: [],
            roles: ["waia_historical_runner", "waia_historical_runner_login"],
            grantees: ["PUBLIC", "anon", "authenticated", "waia_historical_runner"],
          }
        : {
            relations: [
              "trader_historical_rehearsal_started_v1",
              "trader_historical_scientific_admission_refusal_v1",
            ],
            completeRelations: [
              "trader_historical_rehearsal_started_v1",
              "trader_historical_scientific_admission_refusal_v1",
            ],
            policies: [
              "historical_rehearsal_started_v1_deny_browser",
              "historical_rehearsal_started_v1_owner_read",
              "historical_rehearsal_started_v1_runner_insert",
              "historical_rehearsal_started_v1_runner_read",
              "historical_scientific_admission_refusal_v1_deny_browser",
              "historical_scientific_admission_refusal_v1_owner_read",
              "historical_scientific_admission_refusal_v1_runner_insert",
              "historical_scientific_admission_refusal_v1_runner_read",
            ],
            triggers: [
              "historical_rehearsal_started_v1_block_mutation",
              "historical_scientific_admission_refusal_v1_block_mutation",
            ],
            functions: ["waia_historical_refusal_comparison_identities_valid_v1"],
            roles: ["waia_historical_runner", "waia_historical_runner_login"],
            grantees: ["PUBLIC", "anon", "authenticated", "waia_historical_runner"],
          };
  const relations = quotedCatalogNames(profile.relations);
  const functions = profile.functions.length > 0 ? quotedCatalogNames(profile.functions) : "''";
  const roles = quotedCatalogNames(profile.roles);
  const completeRelations =
    profile.completeRelations.length > 0 ? quotedCatalogNames(profile.completeRelations) : "''";
  const constraintRelations = step === "0205" ? relations : completeRelations;

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
      attribute.attname AS column_name,format_type(attribute.atttypid,attribute.atttypmod) AS data_type,
      attribute.attnotnull AS not_null,attribute.attidentity AS identity_kind,
      attribute.attgenerated AS generated_kind,
      COALESCE(pg_get_expr(default_value.adbin,default_value.adrelid),'') AS default_expression
    FROM pg_attribute attribute
    JOIN pg_class class ON class.oid=attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    LEFT JOIN pg_attrdef default_value
      ON default_value.adrelid=attribute.attrelid AND default_value.adnum=attribute.attnum
    WHERE namespace.nspname='public' AND attribute.attnum>0 AND NOT attribute.attisdropped
      AND (
        class.relname IN (${completeRelations})
        OR (class.relname='exchange_credentials' AND attribute.attname='observation_revision')
      )
    ORDER BY schema_name,relation_name,attribute.attnum
  `);
  const constraintRows = sortCatalogRows(
    (await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,class.relname AS relation_name,
      item.contype AS constraint_type,pg_get_constraintdef(item.oid,true) AS definition
    FROM pg_constraint item
    JOIN pg_class class ON class.oid=item.conrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relname IN (${constraintRelations})
    ORDER BY schema_name,relation_name,constraint_type,definition
  `)) as Record<string, unknown>[],
    ["schema_name", "relation_name", "constraint_type", "definition"],
  );
  const indexRows = sortCatalogRows(
    (await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,class.relname AS relation_name,
      pg_get_indexdef(index_item.indexrelid,0,true) AS definition
    FROM pg_index index_item
    JOIN pg_class class ON class.oid=index_item.indrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='public' AND class.relname IN (${completeRelations})
    ORDER BY schema_name,relation_name,definition
  `)) as Record<string, unknown>[],
    ["schema_name", "relation_name", "definition"],
  );
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
      pg_get_triggerdef(trigger.oid,true) AS definition,
      function_namespace.nspname AS function_schema,procedure.proname AS function_name
    FROM pg_trigger trigger
    JOIN pg_class class ON class.oid=trigger.tgrelid
    JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    JOIN pg_proc procedure ON procedure.oid=trigger.tgfoid
    JOIN pg_namespace function_namespace ON function_namespace.oid=procedure.pronamespace
    WHERE NOT trigger.tgisinternal AND namespace.nspname='public'
      AND class.relname IN (${relations})
    ORDER BY schema_name,relation_name,trigger_name
  `);
  const functionRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,procedure.proname AS function_name,
      pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
      pg_get_function_result(procedure.oid) AS result_type,
      language.lanname AS language,procedure.provolatile AS volatility,
      procedure.prosecdef AS security_definer,COALESCE(procedure.proconfig,ARRAY[]::text[]) AS config,
      pg_get_userbyid(procedure.proowner)=current_user AS owner_is_current_user,
      pg_get_functiondef(procedure.oid) AS definition
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    JOIN pg_language language ON language.oid=procedure.prolang
    WHERE namespace.nspname='public' AND (
      procedure.proname IN (${functions})
      OR procedure.oid IN (
        SELECT trigger.tgfoid
        FROM pg_trigger trigger
        JOIN pg_class target ON target.oid=trigger.tgrelid
        JOIN pg_namespace target_namespace ON target_namespace.oid=target.relnamespace
        WHERE NOT trigger.tgisinternal AND target_namespace.nspname='public'
          AND target.relname IN (${relations})
      )
    )
    ORDER BY schema_name,function_name,identity_arguments
  `);
  const roleRows = await sql.unsafe(`
    SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
      rolreplication,rolbypassrls,rolconnlimit
    FROM pg_roles WHERE rolname IN (${roles}) ORDER BY rolname
  `);
  // The migration authority's own PostgreSQL 16+ creation grants are partitioned out here, not
  // filtered: `partitionCreatorMemberships` refuses any authority membership that is inheritable or
  // settable, and every other membership stays pinned exactly as before.
  const membershipRows = partitionCreatorMemberships(
    (await sql.unsafe(`
      SELECT member.rolname AS member_name,granted.rolname AS granted_role,
        CASE WHEN grantor.rolname=current_user THEN 'CURRENT_USER' ELSE grantor.rolname END
          AS grantor_name,
        membership.admin_option,membership.inherit_option,membership.set_option,
        member.rolname=current_user AS member_is_current_user
      FROM pg_auth_members membership
      JOIN pg_roles member ON member.oid=membership.member
      JOIN pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_roles grantor ON grantor.oid=membership.grantor
      WHERE member.rolname IN (${roles}) OR granted.rolname IN (${roles})
      ORDER BY member_name,granted_role,grantor_name
    `)) as unknown as readonly MembershipRow[],
    refuseH2,
  );
  const { tableAuthorityRows, columnAuthorityRows } = await collectCanonicalRelationAuthority(sql, {
    relations: profile.relations,
    declaredPrincipals: profile.grantees,
    refuse: refuseH2,
  });
  const schemaAuthorityRows = await collectCanonicalSchemaAuthority(sql, {
    declaredPrincipals: profile.grantees,
    refuse: refuseH2,
  });
  const routineGrantRows = await sql.unsafe(`
    SELECT namespace.nspname AS schema_name,procedure.proname AS function_name,
      pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
      CASE WHEN privilege.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee_name,
      privilege.privilege_type,privilege.is_grantable,
      CASE WHEN grantor.rolname=current_user THEN 'CURRENT_USER' ELSE grantor.rolname END
        AS grantor_name
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure.proacl,acldefault('f',procedure.proowner))
    ) privilege
    LEFT JOIN pg_roles grantee ON grantee.oid=privilege.grantee
    JOIN pg_roles grantor ON grantor.oid=privilege.grantor
    WHERE namespace.nspname='public' AND privilege.grantee<>procedure.proowner AND (
      procedure.proname IN (${functions})
      OR procedure.oid IN (
        SELECT trigger.tgfoid
        FROM pg_trigger trigger
        JOIN pg_class target ON target.oid=trigger.tgrelid
        JOIN pg_namespace target_namespace ON target_namespace.oid=target.relnamespace
        WHERE NOT trigger.tgisinternal AND target_namespace.nspname='public'
          AND target.relname IN (${relations})
      )
    )
    ORDER BY schema_name,function_name,identity_arguments,grantee_name,privilege_type,grantor_name
  `);
  // Named-role EXECUTE is refused. Owner-only and stock PUBLIC EXECUTE both leave
  // `routineGrantRows` empty because the query drops the owner and PUBLIC is not a named role.
  assertRoutineExecuteBounded(
    routineGrantRows as unknown as readonly Readonly<{
      grantee_name: string;
      privilege_type: string;
    }>[],
    refuseH2,
  );
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
    tableAuthorityRows,
    columnAuthorityRows,
    schemaAuthorityRows,
    routineGrantRows,
  });
}

export async function verifyH2MigrationCatalog(sql: Sql, step: H2Step): Promise<string> {
  if (step === "0205") {
    await verify0205(sql);
  } else if (step === "0206" || step === "0207") {
    await verifyAdmissionPolicy(sql, step);
    await assertNoLeftoverOrgScopePolicy(sql, step);
  } else {
    await verify0208(sql);
    await assertNoLeftoverOrgScopePolicy(sql, step);
  }
  const digest = semanticDigest(await collectExactH2CatalogSnapshot(sql, step));
  const expected = EXPECTED_H2_CATALOG_DIGESTS[step];
  if (digest !== expected) {
    refuseH2("CATALOG_DIGEST_MISMATCH", `${step}:${digest}`);
  }
  return digest;
}

async function acquireH2Locks(sql: Sql, source: H2CanonicalSource): Promise<void> {
  await sql.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await sql.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
  await sql.unsafe("SET LOCAL idle_in_transaction_session_timeout = '15000ms'");
  await sql.unsafe("SET LOCAL synchronous_commit = on");
  // This must be the first snapshot-relevant operation. Waiting on the journal
  // before any SELECT ensures a SERIALIZABLE snapshot cannot predate a generic
  // migrator that commits while this operator is blocked.
  await sql.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
  for (const relation of source.selected.lockRelations) {
    await sql.unsafe(`LOCK TABLE ${relation} IN ACCESS EXCLUSIVE MODE`);
  }
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${ADVISORY_LOCK_KEY},0))`;
  const durability = await sql<Readonly<{ synchronous_commit: string }>[]>`
    SELECT current_setting('synchronous_commit') AS synchronous_commit
  `;
  if (durability[0]?.synchronous_commit !== "on") {
    refuseH2("SYNCHRONOUS_COMMIT_REQUIRED", source.selected.step);
  }
}

function buildReceipt(
  input: Omit<H2OperationReceipt, "schemaVersion" | "contentDigestHex">,
): H2OperationReceipt {
  const body = Object.freeze({ schemaVersion: H2_MIGRATION_RECEIPT_SCHEMA, ...input });
  return Object.freeze({ ...body, contentDigestHex: semanticDigest(body) });
}

function receiptAttestationFields(evidence: H2CeremonyEvidence) {
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
  input: H2OperationInput,
  source: H2CanonicalSource,
  evidence: H2CeremonyEvidence,
  dependencies: H2OperatorDependencies,
  liveJournalDigestBefore: string,
  applyMetadata?: Readonly<{
    transactionIdentity: string;
    catalogVerificationDigest: string;
    commitTimestamp: string;
  }>,
): Promise<H2OperationReceipt> {
  const connect = dependencies.connect ?? openPostgres;
  const pool = connect(input.databaseUrl, true);
  const reserved = await pool.reserve();
  const sql = reserved as unknown as Sql;
  let transactionOpen = false;
  try {
    await sql.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const target = await readH2TargetIdentity(sql);
    const targetFingerprint = await assertMigrationAuthority(
      sql,
      source,
      target,
      evidence,
      input.expectedTargetFingerprint,
      false,
    );
    await assertNo0209Objects(sql);
    const rows = await readH2LiveJournal(sql);
    let classification: H2OperationReceipt["classification"];
    let journalDigestAfter: string;
    let catalogVerificationDigest: string | null = null;
    if (applyMetadata) {
      journalDigestAfter = assertExactJournal(
        rows,
        source.expectedAppliedPrefix,
        `${input.step}:applied`,
      );
      classification = "SELECTED_STEP_COMMITTED";
      catalogVerificationDigest = await verifyH2MigrationCatalog(sql, input.step);
    } else {
      const classified = classifyH2VerifyOnlyJournal(rows, source);
      classification = classified.classification;
      journalDigestAfter = classified.journalDigest;
      if (classification === "SELECTED_STEP_COMMITTED") {
        catalogVerificationDigest = await verifyH2MigrationCatalog(sql, input.step);
      }
    }
    if (applyMetadata && catalogVerificationDigest !== applyMetadata.catalogVerificationDigest) {
      refuseH2("POST_COMMIT_CATALOG_MISMATCH", input.step);
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
        migration0209Observed: false,
      }),
      nextStepExecuted: false,
    });
    await sql.unsafe("COMMIT");
    transactionOpen = false;
    return receipt;
  } catch (error) {
    if (transactionOpen) await sql.unsafe("ROLLBACK").catch(() => undefined);
    if (error instanceof H2MigrationOperatorError) throw error;
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "UNKNOWN")
        : "UNKNOWN";
    refuseH2("READ_ONLY_VERIFICATION_FAILED", code);
  } finally {
    reserved.release();
    await pool.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function runH2MigrationOperation(
  input: H2OperationInput,
  dependencies: H2OperatorDependencies = {},
): Promise<H2OperationReceipt> {
  assertDirectPostgresUrl(input.databaseUrl);
  if (
    (dependencies.testHooks || dependencies.approvedHumanKeySha256) &&
    process.env.NODE_ENV !== "test"
  ) {
    refuseH2("TEST_HOOK_FORBIDDEN", "test hooks require NODE_ENV=test");
  }
  if (!input.verifyOnly && input.confirmedStep !== input.step) {
    refuseH2("EXACT_STEP_CONFIRMATION_REQUIRED", input.step);
  }
  const source = loadH2CanonicalSource(input.repoRoot, input.step);
  const approvedHumanKeySha256 =
    dependencies.approvedHumanKeySha256 ?? readH2ApprovedHumanKeySha256();
  const evidence = loadH2CeremonyEvidence({
    step: input.step,
    trustedHumanPublicKeyPath: input.trustedHumanPublicKeyPath,
    expectedHumanSigningKeySha256: approvedHumanKeySha256,
    restorePointPath: input.restorePointAttestationPath,
    writerQuiescencePath: input.writerQuiescenceAttestationPath,
    targetIdentityPath: input.targetIdentityAttestationPath,
    ceremonyAuthorizationPath: input.ceremonyAuthorizationAttestationPath,
  });
  if (evidence.ceremonyAuthorization.targetFingerprint !== input.expectedTargetFingerprint) {
    refuseH2("COMMAND_ATTESTATION_TARGET_MISMATCH", input.step);
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
    const target = await readH2TargetIdentity(sql);
    await assertMigrationAuthority(
      sql,
      source,
      target,
      evidence,
      input.expectedTargetFingerprint,
      true,
    );
    await assertNo0209Objects(sql);
    await assertRelevantWritersQuiesced(sql);
    const before = await readH2LiveJournal(sql);
    liveJournalDigestBefore = assertExactJournal(
      before,
      source.expectedPredecessorPrefix,
      `${input.step}:predecessor`,
    );

    await sql.unsafe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    try {
      await acquireH2Locks(sql, source);
      const lockedTarget = await readH2TargetIdentity(sql);
      await assertMigrationAuthority(
        sql,
        source,
        lockedTarget,
        evidence,
        input.expectedTargetFingerprint,
        true,
      );
      await assertRelevantWritersQuiesced(sql);
      const lockedJournal = await readH2LiveJournal(sql);
      assertExactJournal(
        lockedJournal,
        source.expectedPredecessorPrefix,
        `${input.step}:locked-predecessor`,
      );
      await assertNo0209Objects(sql);
      await sql.unsafe(source.sql.toString("utf8")).simple();
      await sql`
        INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
        VALUES (${source.selected.sha256},${source.selected.when})
      `;
      await dependencies.testHooks?.beforeCatalogVerification?.(sql, source);
      const applied = await readH2LiveJournal(sql);
      assertExactJournal(applied, source.expectedAppliedPrefix, `${input.step}:pre-commit`);
      catalogVerificationDigest = await verifyH2MigrationCatalog(sql, input.step);
      const transactionRows = await sql<Readonly<{ transaction_id: string }>[]>`
        SELECT txid_current()::text AS transaction_id
      `;
      const transaction = transactionRows[0];
      if (!transaction) refuseH2("TRANSACTION_IDENTITY_MISSING", input.step);
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
      refuseH2("COMMIT_RESULT_UNCERTAIN", `do not retry; run --verify-only --step ${input.step}`);
    }
  } catch (error) {
    if (error instanceof H2MigrationOperatorError) throw error;
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "UNKNOWN")
        : "UNKNOWN";
    if (code === "55P03" || code === "57014") {
      refuseH2("LOCK_TIMEOUT", input.step);
    }
    refuseH2("TRANSACTION_FAILED", `${input.step}:${code}`);
  } finally {
    if (transactionOpen) await sql.unsafe("ROLLBACK").catch(() => undefined);
    reserved.release();
    await pool.end({ timeout: 5 }).catch(() => undefined);
  }
  return verifyReadOnly(input, source, evidence, dependencies, liveJournalDigestBefore, {
    transactionIdentity,
    catalogVerificationDigest,
    commitTimestamp,
  });
}

type CliArguments = Omit<H2OperationInput, "databaseUrl" | "repoRoot">;

export function parseH2CliArguments(argv: readonly string[]): CliArguments {
  const values = new Map<string, string>();
  let verifyOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--verify-only") {
      if (verifyOnly) refuseH2("CLI_DUPLICATE_OPTION", argument);
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
      refuseH2("CLI_OPTION", argument);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) refuseH2("CLI_OPTION_VALUE", argument);
    values.set(argument, value);
    index += 1;
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) refuseH2("CLI_REQUIRED_OPTION", name);
    return value;
  };
  const step = parseH2Step(required("--step"));
  const confirmed = values.get("--confirm-exact-step");
  if (verifyOnly && confirmed) refuseH2("VERIFY_ONLY_CONFIRMATION_FORBIDDEN", confirmed);
  return Object.freeze({
    step,
    verifyOnly,
    confirmedStep: confirmed ? parseH2Step(confirmed) : undefined,
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
    refuseH2("CLI_ENVIRONMENT", "WAIA_TRADER_CLI=1 required");
  }
  const databaseUrl = process.env.DATABASE_URL_POSTGRES_SESSION?.trim();
  if (!databaseUrl) {
    refuseH2("DATABASE_URL_REQUIRED", "DATABASE_URL_POSTGRES_SESSION");
  }
  const args = parseH2CliArguments(process.argv.slice(2));
  const receipt = await runH2MigrationOperation({
    ...args,
    databaseUrl,
    repoRoot: process.cwd(),
  });
  process.stdout.write(canonicalJson(receipt) + "\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    if (error instanceof H2MigrationOperatorError) {
      process.stderr.write(error.message + "\n");
    } else {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code ?? "UNKNOWN")
          : "UNKNOWN";
      process.stderr.write(`H2_MIGRATION_REFUSED:UNEXPECTED:${code}\n`);
    }
    process.exitCode = 1;
  });
}
