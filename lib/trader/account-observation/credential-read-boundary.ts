import "server-only";
import type { Sql } from "postgres";
import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import { decryptCredentialPayload } from "@/lib/trader/credentials/envelope-crypto";
import { assertCredentialDecryptionAllowed } from "@/lib/trader/security/credential-storage-gate";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";

/** Parent authority from migration 0210; deliberately not the collector or reader role. */
export const ACCOUNT_OBSERVATION_CREDENTIAL_ROLE = "waia_account_observation_credential";

/**
 * The exact column list migration 0210 grants. Never `SELECT *`: the generic credential
 * repository's unprojected read is an implementation shape, not an authority requirement, and
 * this role has no privilege on `venue`, `api_key_masked`, `permission_metadata`,
 * `observation_revision`, `created_at`, `updated_at` or `revoked_at`.
 */
export const ACCOUNT_OBSERVATION_CREDENTIAL_COLUMNS = Object.freeze([
  "id",
  "organization_id",
  "exchange_account_id",
  "status",
  "encrypted_payload",
  "payload_key_version",
  "wrapped_dek_key_version",
  "wrapped_dek_key",
] as const);

export type ObservationCredentialRefusal =
  | "ASSIGNMENTS_INVALID"
  | "NOT_ASSIGNED"
  | "MASTER_KEY_NOT_READY"
  | "READ_FAILED"
  | "NOT_FOUND"
  | "IDENTITY_MISMATCH";

/** Fixed codes only: no SQL text, row content, ciphertext or key material is ever attached. */
export class ObservationCredentialReadFailure extends Error {
  readonly code: ObservationCredentialRefusal;
  constructor(code: ObservationCredentialRefusal) {
    super(`ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:${code}`);
    this.name = "ObservationCredentialReadFailure";
    this.code = code;
  }
}

function refuse(code: ObservationCredentialRefusal): never {
  throw new ObservationCredentialReadFailure(code);
}

/** One Human-provisioned, manifest-trusted observation assignment. */
export type ObservationCredentialAssignment = Readonly<{
  organizationId: string;
  credentialId: string;
  exchangeAccountId: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT = /^[1-9]\d{0,39}$/;

type CredentialProjection = {
  id: string;
  organization_id: string;
  exchange_account_id: string;
  status: string;
  encrypted_payload: string | null;
  payload_key_version: string | null;
  wrapped_dek_key_version: string | null;
  wrapped_dek_key: string | null;
};

function key(organizationId: string, credentialId: string): string {
  return `${organizationId.toLowerCase()}\u0000${credentialId.toLowerCase()}`;
}

/**
 * Purpose-built account-observation credential read boundary (DEE-1015).
 *
 * It is deliberately NOT the generic credential repository: it reads one narrow projection of one
 * assignment-bound row through the dedicated 0210 authority, then reuses the existing envelope
 * decryption primitive and master-key gate. It exposes no list, insert, rotate, revoke or audit
 * capability, and grants no order/execution authority.
 *
 * Every read is one bounded read-only transaction that SET LOCAL ROLEs to the 0210 parent and
 * publishes transaction-local `waia.observation_*` context, so the assignment-bound RLS policy
 * decides visibility. Callers cannot widen scope: an (organization, credential) pair absent from
 * the trusted assignment set is refused before any SQL runs, and the returned row's identity
 * tuple is re-checked in process afterwards.
 */
export function createObservationCredentialReader(
  input: Readonly<{
    sql: Sql;
    provider: MasterKeyProvider;
    assignments: readonly ObservationCredentialAssignment[];
    statementTimeoutMs?: number;
  }>,
): Readonly<{
  getDecryptedCredentials(
    context: Readonly<{ organizationId: string }>,
    credentialId: string,
  ): Promise<ConnectorCredentialInput>;
}> {
  const { sql, provider } = input;
  const statementTimeoutMs = input.statementTimeoutMs ?? 3000;
  if (
    typeof sql !== "function" ||
    typeof sql.begin !== "function" ||
    !provider ||
    typeof provider.isProductionReady !== "function" ||
    typeof provider.decryptDataKey !== "function" ||
    !Array.isArray(input.assignments) ||
    input.assignments.length < 1 ||
    input.assignments.length > 20 ||
    !Number.isSafeInteger(statementTimeoutMs) ||
    statementTimeoutMs < 100 ||
    statementTimeoutMs > 30000
  ) {
    refuse("ASSIGNMENTS_INVALID");
  }

  const assignments = new Map<string, ObservationCredentialAssignment>();
  for (const assignment of input.assignments) {
    if (
      !assignment ||
      !UUID.test(assignment.organizationId ?? "") ||
      !UUID.test(assignment.credentialId ?? "") ||
      !ACCOUNT.test(assignment.exchangeAccountId ?? "")
    ) {
      refuse("ASSIGNMENTS_INVALID");
    }
    const identity = key(assignment.organizationId, assignment.credentialId);
    // One credential may not be claimed twice, so the account used for the runtime context
    // is never ambiguous.
    if (assignments.has(identity)) refuse("ASSIGNMENTS_INVALID");
    assignments.set(
      identity,
      Object.freeze({
        organizationId: assignment.organizationId,
        credentialId: assignment.credentialId,
        exchangeAccountId: assignment.exchangeAccountId,
      }),
    );
  }

  const projection = ACCOUNT_OBSERVATION_CREDENTIAL_COLUMNS.join(", ");

  return Object.freeze({
    async getDecryptedCredentials(
      context: Readonly<{ organizationId: string }>,
      credentialId: string,
    ): Promise<ConnectorCredentialInput> {
      const organizationId = context?.organizationId;
      if (!UUID.test(organizationId ?? "") || !UUID.test(credentialId ?? "")) {
        refuse("NOT_ASSIGNED");
      }
      const assignment = assignments.get(key(organizationId, credentialId));
      if (!assignment) refuse("NOT_ASSIGNED");

      // Fail closed on master-key readiness before any credential row is touched.
      try {
        assertCredentialDecryptionAllowed(provider);
      } catch {
        refuse("MASTER_KEY_NOT_READY");
      }

      let rows: CredentialProjection[];
      try {
        rows = (await sql.begin(async (tx) => {
          await tx.unsafe("SET TRANSACTION READ ONLY");
          await tx.unsafe(`SET LOCAL ROLE ${ACCOUNT_OBSERVATION_CREDENTIAL_ROLE}`);
          await tx.unsafe(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
          await tx.unsafe("SET LOCAL lock_timeout = '1000ms'");
          await tx.unsafe(`SET LOCAL transaction_timeout = '${statementTimeoutMs + 2000}ms'`);
          await tx`SELECT set_config('waia.observation_org', ${assignment.organizationId}, true),
            set_config('waia.observation_credential', ${assignment.credentialId}, true),
            set_config('waia.observation_account', ${assignment.exchangeAccountId}, true)`;
          return tx.unsafe<CredentialProjection[]>(
            `SELECT ${projection} FROM public.exchange_credentials
             WHERE id = $1 AND organization_id = $2 AND exchange_account_id = $3`,
            [assignment.credentialId, assignment.organizationId, assignment.exchangeAccountId],
          );
        })) as CredentialProjection[];
      } catch {
        // A denied read, a timeout and a transport fault are one indistinguishable refusal.
        refuse("READ_FAILED");
      }

      if (rows.length !== 1) refuse("NOT_FOUND");
      const row = rows[0]!;
      if (
        row.id !== assignment.credentialId ||
        row.organization_id !== assignment.organizationId ||
        row.exchange_account_id !== assignment.exchangeAccountId
      ) {
        refuse("IDENTITY_MISMATCH");
      }
      if (row.status !== "active") refuse("NOT_FOUND");

      try {
        return await decryptCredentialPayload(provider, {
          encryptedPayload: row.encrypted_payload,
          payloadKeyVersion: row.payload_key_version,
          wrappedDekKeyVersion: row.wrapped_dek_key_version,
          wrappedDekKey: row.wrapped_dek_key,
        });
      } catch {
        // Never surface a crypto error body: it can carry payload or key-version detail.
        refuse("READ_FAILED");
      }
    },
  });
}
