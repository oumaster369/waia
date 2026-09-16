/**
 * DEE-1015: bounded, Human-invoked provisioning of the initial `trader_account_collection_state`
 * row for exactly one approved observation assignment.
 *
 * Migration 0205 deliberately grants the recurring collector role no INSERT on
 * `trader_account_collection_state`, and this operator does not broaden it: bootstrap uses the
 * separate provisioning/migration authority already used by the H2 operator
 * (`DATABASE_URL_POSTGRES_SESSION`), inside this explicit operator boundary only.
 *
 * INSERT only. An exact existing row is idempotent; any differing row is refused rather than
 * silently rewritten. No UPDATE, no DELETE, no observation-history mutation, no schema change.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { parseAccountObservationAssignmentManifest } from "@/lib/trader/account-observation/assignment-manifest";

export const ACCOUNT_OBSERVATION_PROVISIONING_RECEIPT_SCHEMA =
  "waia.account_observation_collection_state_provisioning.v1" as const;

/** Literals rather than an import of the credential-capable collector module; a cross-file
 * regression asserts they stay identical to the runtime and supervisor definitions. */
const RUNTIME_LOGINS = Object.freeze([
  "waia_account_observer_login",
  "waia_account_observation_reader_login",
  "waia_account_observation_credential_login",
]);
const COLLECTOR_ROLE = "waia_account_observer";
const READER_ROLE = "waia_account_observation_reader";
/** No recurring runtime identity may ever be the provisioning session. */
const FORBIDDEN_PROVISIONING_ROLES = Object.freeze([
  COLLECTOR_ROLE,
  READER_ROLE,
  ...RUNTIME_LOGINS,
]);
const STATE_TABLE = "public.trader_account_collection_state";
const OBSERVATION_TABLE = "public.trader_account_observations";
const LOCK_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 15_000;

export class AccountObservationProvisioningError extends Error {
  constructor(code: string, detail?: string) {
    super(`ACCOUNT_OBSERVATION_PROVISIONING_REFUSED:${code}${detail ? `:${detail}` : ""}`);
    this.name = "AccountObservationProvisioningError";
  }
}

function refuse(code: string, detail?: string): never {
  throw new AccountObservationProvisioningError(code, detail);
}

export type AccountObservationProvisioningMode = "APPLY" | "VERIFY_ONLY";
export type AccountObservationProvisioningClassification =
  | "PROVISIONED"
  | "ALREADY_PROVISIONED"
  | "VERIFIED";

export type AccountObservationProvisioningReceipt = Readonly<{
  schemaVersion: typeof ACCOUNT_OBSERVATION_PROVISIONING_RECEIPT_SCHEMA;
  mode: AccountObservationProvisioningMode;
  classification: AccountObservationProvisioningClassification;
  manifestSha256: string;
  releaseSha: string;
  host: string;
  organizationId: string;
  credentialId: string;
  exchangeAccountId: string;
  credentialRevision: string;
  configurationRevision: string;
  symbols: readonly string[];
  provisioningIdentity: Readonly<{
    databaseName: string;
    currentUser: string;
    serverVersionNum: string;
  }>;
  leastPrivilege: Readonly<{
    collectorStateInsert: false;
    readerStateInsert: false;
    forcedRowLevelSecurity: true;
  }>;
  contentDigestHex: string;
}>;

export type AccountObservationProvisioningInput = Readonly<{
  manifestPath: string;
  expectedManifestSha256: string;
  expectedReleaseSha: string;
  organizationId: string;
  credentialId: string;
  exchangeAccountId: string;
  confirmedAssignment: string | null;
  verifyOnly: boolean;
  databaseUrl: string;
}>;

export type AccountObservationProvisioningDependencies = Readonly<{
  connect?(url: string): postgres.Sql;
  readManifest?(path: string): string;
}>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function openPostgres(url: string): postgres.Sql {
  return postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
    max_lifetime: null,
    connection: { application_name: "waia-account-observation-state-provisioner-v1" },
    onnotice: () => {},
  });
}

function assertDirectPostgresUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    refuse("DATABASE_URL_INVALID");
  }
  const poolMode = parsed.searchParams.get("pool_mode") ?? parsed.searchParams.get("poolmode");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol.toLowerCase()) ||
    !parsed.hostname ||
    parsed.port === "6543" ||
    poolMode?.trim().toLowerCase() === "transaction"
  ) {
    refuse("DATABASE_URL_INVALID", "direct or session-mode PostgreSQL URL required");
  }
  // Provisioning must never reuse a recurring runtime login.
  if (RUNTIME_LOGINS.includes(decodeURIComponent(parsed.username))) {
    refuse("PROVISIONING_ROLE_IS_RUNTIME_LOGIN");
  }
}

/** One exact approved assignment per invocation. */
export async function runAccountObservationCollectionStateProvisioning(
  input: AccountObservationProvisioningInput,
  dependencies: AccountObservationProvisioningDependencies = {},
): Promise<AccountObservationProvisioningReceipt> {
  if (
    !isAbsolute(input.manifestPath) ||
    input.manifestPath.includes("\0") ||
    resolve(input.manifestPath) !== input.manifestPath
  ) {
    refuse("MANIFEST_PATH");
  }
  const expected = `${input.organizationId}:${input.credentialId}:${input.exchangeAccountId}`;
  if (!input.verifyOnly && input.confirmedAssignment !== expected) {
    refuse("CONFIRMATION_MISMATCH");
  }
  assertDirectPostgresUrl(input.databaseUrl);

  const read = dependencies.readManifest ?? ((path: string) => readFileSync(path, "utf8"));
  let manifestText: string;
  try {
    manifestText = read(input.manifestPath);
  } catch {
    refuse("MANIFEST_UNREADABLE");
  }
  const trusted = parseAccountObservationAssignmentManifest(manifestText, {
    expectedDigest: input.expectedManifestSha256,
    expectedReleaseSha: input.expectedReleaseSha,
  });

  const matches = trusted.configured.filter(
    (item) =>
      item.binding.organizationId === input.organizationId &&
      item.binding.credentialId === input.credentialId &&
      item.binding.exchangeAccountId === input.exchangeAccountId,
  );
  if (matches.length !== 1) refuse("ASSIGNMENT_NOT_IN_MANIFEST");
  const assignment = matches[0]!;
  const symbols = [...assignment.config.symbols];
  const expectedSymbolsJson = JSON.stringify(symbols);

  const sql = (dependencies.connect ?? openPostgres)(input.databaseUrl);
  try {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
      await tx.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);

      const attested = await tx`
        SELECT current_database()::text AS database_name,
          current_user::text AS current_user_name,
          current_setting('server_version_num') AS server_version_num,
          current_user = session_user AS original_session,
          current_setting('server_version_num')::int >= 170000 AS supported,
          EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
            AND (rolsuper OR rolbypassrls)) AS unfiltered_authority,
          has_table_privilege(current_user, ${STATE_TABLE}, 'INSERT') AS can_insert_state,
          -- Identity, not role membership: FORCE RLS means provisioning needs BYPASSRLS or
          -- superuser, and a superuser is implicitly a member of every role.
          current_user::text <> ALL (${[...FORBIDDEN_PROVISIONING_ROLES]}) AS not_runtime_role,
          NOT (has_table_privilege(${COLLECTOR_ROLE}, ${STATE_TABLE}, 'INSERT')
            OR has_any_column_privilege(${COLLECTOR_ROLE}, ${STATE_TABLE}, 'INSERT')) AS collector_no_state_insert,
          NOT (has_table_privilege(${READER_ROLE}, ${STATE_TABLE}, 'INSERT')
            OR has_any_column_privilege(${READER_ROLE}, ${STATE_TABLE}, 'INSERT')) AS reader_no_state_insert,
          NOT (has_table_privilege(${COLLECTOR_ROLE}, ${STATE_TABLE}, 'DELETE,TRUNCATE')
            OR has_table_privilege(${COLLECTOR_ROLE}, ${OBSERVATION_TABLE}, 'DELETE,TRUNCATE')) AS collector_no_destructive,
          (SELECT count(*) = 2 AND bool_and(relrowsecurity AND relforcerowsecurity)
            FROM pg_class WHERE oid IN (${STATE_TABLE}::regclass, ${OBSERVATION_TABLE}::regclass)) AS forced_rls
      `;
      const identity = attested[0];
      if (!identity) refuse("PROVISIONING_ATTESTATION");
      if (identity.original_session !== true) refuse("PROVISIONING_SESSION_ROLE_CHANGED");
      if (identity.supported !== true) refuse("POSTGRES_VERSION_UNSUPPORTED");
      if (identity.not_runtime_role !== true) refuse("PROVISIONING_ROLE_IS_RUNTIME_ROLE");
      if (identity.can_insert_state !== true || identity.unfiltered_authority !== true) {
        refuse("PROVISIONING_AUTHORITY_INSUFFICIENT");
      }
      if (identity.collector_no_state_insert !== true || identity.reader_no_state_insert !== true) {
        refuse("COLLECTOR_INSERT_AUTHORITY_BROADENED");
      }
      if (identity.collector_no_destructive !== true) refuse("COLLECTOR_DESTRUCTIVE_AUTHORITY");
      if (identity.forced_rls !== true) refuse("FORCED_ROW_LEVEL_SECURITY_DISABLED");

      // Share lock fences a concurrent revoke or rotation between validation and INSERT.
      let credentials;
      try {
        credentials = await tx`
          SELECT organization_id::text AS organization_id, venue, exchange_account_id,
            status, observation_revision::text AS observation_revision
          FROM public.exchange_credentials WHERE id = ${input.credentialId} FOR SHARE`;
      } catch {
        refuse("CREDENTIAL_LOCK_TIMEOUT");
      }
      const credential = credentials[0];
      if (!credential) refuse("CREDENTIAL_NOT_FOUND");
      if (credential.organization_id !== input.organizationId)
        refuse("CREDENTIAL_ORGANIZATION_MISMATCH");
      if (credential.exchange_account_id !== input.exchangeAccountId)
        refuse("CREDENTIAL_ACCOUNT_MISMATCH");
      if (credential.venue !== "htx") refuse("CREDENTIAL_VENUE");
      if (credential.status !== "active") refuse("CREDENTIAL_NOT_ACTIVE");
      if (credential.observation_revision !== assignment.binding.credentialRevision) {
        refuse("CREDENTIAL_REVISION_MISMATCH");
      }

      const existing = await tx`
        SELECT configuration_revision, symbols, last_observation_id
        FROM public.trader_account_collection_state
        WHERE organization_id = ${input.organizationId} AND credential_id = ${input.credentialId}
          AND exchange_account_id = ${input.exchangeAccountId} FOR UPDATE`;
      const current = existing[0];
      if (current) {
        if (
          current.configuration_revision !== assignment.config.revision ||
          JSON.stringify(current.symbols) !== expectedSymbolsJson
        ) {
          refuse("CONFLICTING_STATE");
        }
        return { identity, classification: "ALREADY_PROVISIONED" as const };
      }
      if (input.verifyOnly) return { identity, classification: "VERIFIED" as const };

      await tx`
        INSERT INTO public.trader_account_collection_state
          (organization_id, credential_id, exchange_account_id, configuration_revision, symbols)
        VALUES (${input.organizationId}, ${input.credentialId}, ${input.exchangeAccountId},
          ${assignment.config.revision}, ${tx.json(symbols)})`;
      const committed = await tx`
        SELECT configuration_revision, symbols, consecutive_failures, lease_token,
          lease_owner, lease_expires_at, last_observation_id
        FROM public.trader_account_collection_state
        WHERE organization_id = ${input.organizationId} AND credential_id = ${input.credentialId}
          AND exchange_account_id = ${input.exchangeAccountId}`;
      const written = committed[0];
      if (
        !written ||
        written.configuration_revision !== assignment.config.revision ||
        JSON.stringify(written.symbols) !== expectedSymbolsJson ||
        written.consecutive_failures !== 0 ||
        written.lease_token !== null ||
        written.lease_owner !== null ||
        written.lease_expires_at !== null ||
        written.last_observation_id !== null
      ) {
        refuse("PROVISIONED_STATE_VERIFICATION");
      }
      return { identity, classification: "PROVISIONED" as const };
    });

    const body = {
      schemaVersion: ACCOUNT_OBSERVATION_PROVISIONING_RECEIPT_SCHEMA,
      mode: (input.verifyOnly ? "VERIFY_ONLY" : "APPLY") as AccountObservationProvisioningMode,
      classification: result.classification,
      manifestSha256: trusted.digest,
      releaseSha: trusted.releaseSha,
      host: trusted.host,
      organizationId: input.organizationId,
      credentialId: input.credentialId,
      exchangeAccountId: input.exchangeAccountId,
      credentialRevision: assignment.binding.credentialRevision,
      configurationRevision: assignment.config.revision,
      symbols,
      provisioningIdentity: {
        databaseName: String(result.identity.database_name),
        currentUser: String(result.identity.current_user_name),
        serverVersionNum: String(result.identity.server_version_num),
      },
      leastPrivilege: {
        collectorStateInsert: false as const,
        readerStateInsert: false as const,
        forcedRowLevelSecurity: true as const,
      },
    };
    return Object.freeze({
      ...body,
      symbols: Object.freeze(symbols),
      contentDigestHex: createHash("sha256").update(canonicalJson(body)).digest("hex"),
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

type CliArguments = Omit<AccountObservationProvisioningInput, "databaseUrl">;

export function parseProvisioningCliArguments(argv: readonly string[]): CliArguments {
  const values = new Map<string, string>();
  let verifyOnly = false;
  const allowed = new Set([
    "--manifest",
    "--expected-manifest-sha256",
    "--expected-release-sha",
    "--organization-id",
    "--credential-id",
    "--exchange-account-id",
    "--confirm-exact-assignment",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--verify-only") {
      if (verifyOnly) refuse("CLI_DUPLICATE_OPTION", argument);
      verifyOnly = true;
      continue;
    }
    if (!allowed.has(argument) || values.has(argument)) refuse("CLI_OPTION", argument);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) refuse("CLI_OPTION_VALUE", argument);
    values.set(argument, value);
    index += 1;
  }
  for (const option of [
    "--manifest",
    "--expected-manifest-sha256",
    "--expected-release-sha",
    "--organization-id",
    "--credential-id",
    "--exchange-account-id",
  ]) {
    if (!values.has(option)) refuse("CLI_OPTION_REQUIRED", option);
  }
  if (!verifyOnly && !values.has("--confirm-exact-assignment")) {
    refuse("CLI_OPTION_REQUIRED", "--confirm-exact-assignment");
  }
  return Object.freeze({
    manifestPath: values.get("--manifest")!,
    expectedManifestSha256: values.get("--expected-manifest-sha256")!.toLowerCase(),
    expectedReleaseSha: values.get("--expected-release-sha")!.toLowerCase(),
    organizationId: values.get("--organization-id")!,
    credentialId: values.get("--credential-id")!,
    exchangeAccountId: values.get("--exchange-account-id")!,
    confirmedAssignment: values.get("--confirm-exact-assignment") ?? null,
    verifyOnly,
  });
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    refuse("CLI_ENVIRONMENT", "WAIA_TRADER_CLI=1 required");
  }
  const databaseUrl = process.env.DATABASE_URL_POSTGRES_SESSION?.trim();
  if (!databaseUrl) refuse("DATABASE_URL_REQUIRED", "DATABASE_URL_POSTGRES_SESSION");
  const args = parseProvisioningCliArguments(process.argv.slice(2));
  const receipt = await runAccountObservationCollectionStateProvisioning({ ...args, databaseUrl });
  process.stdout.write(`${canonicalJson(receipt)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${
        error instanceof AccountObservationProvisioningError ||
        (error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message))
          ? error.message
          : "ACCOUNT_OBSERVATION_PROVISIONING_REFUSED:UNCLASSIFIED"
      }\n`,
    );
    process.exitCode = 1;
  });
}
