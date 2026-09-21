import { describe, expect, it } from "vitest";

import {
  ACCOUNT_OBSERVATION_CREDENTIAL_COLUMNS,
  ACCOUNT_OBSERVATION_CREDENTIAL_ROLE,
  createObservationCredentialReader,
} from "@/lib/trader/account-observation/credential-read-boundary";
import { encryptCredentialPayload } from "@/lib/trader/credentials/envelope-crypto";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const CREDENTIAL = "22222222-2222-4222-8222-222222222222";
const OTHER_CREDENTIAL = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "12345678";
const MASTER_KEY = Buffer.alloc(32, 5).toString("base64");

const ASSIGNMENT = Object.freeze({
  organizationId: ORGANIZATION,
  credentialId: CREDENTIAL,
  exchangeAccountId: ACCOUNT,
});

function provider(productionReady = true) {
  return SecretsStoreMasterKeyProvider.create({
    secretGetter: async () => MASTER_KEY,
    productionReady,
  });
}

type Row = Record<string, unknown>;

/** Records every statement so the exact transaction posture stays under test. */
function fakeSql(rows: Row[] | (() => Row[])) {
  const statements: string[] = [];
  const parameters: unknown[][] = [];
  const tx = ((strings: TemplateStringsArray | string, ...values: unknown[]) => {
    statements.push(typeof strings === "string" ? strings : strings.join("?"));
    parameters.push(values);
    return Promise.resolve([]);
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    unsafe(query: string, params?: unknown[]): Promise<unknown[]>;
  };
  tx.unsafe = (query: string, params?: unknown[]) => {
    statements.push(query);
    parameters.push(params ?? []);
    if (/^\s*SELECT/i.test(query)) {
      return Promise.resolve(typeof rows === "function" ? rows() : rows);
    }
    return Promise.resolve([]);
  };
  const sql = (() => Promise.resolve([])) as unknown as Parameters<
    typeof createObservationCredentialReader
  >[0]["sql"];
  (sql as unknown as { begin: unknown }).begin = (fn: (tx: unknown) => Promise<unknown>) => fn(tx);
  return { sql, statements, parameters };
}

async function encryptedRow(overrides: Row = {}): Promise<Row> {
  const envelope = await encryptCredentialPayload(await provider(), {
    apiKey: "unit-api-key",
    apiSecret: "unit-api-secret",
  });
  return {
    id: CREDENTIAL,
    organization_id: ORGANIZATION,
    exchange_account_id: ACCOUNT,
    status: "active",
    encrypted_payload: envelope.encryptedPayload,
    payload_key_version: envelope.payloadKeyVersion,
    wrapped_dek_key_version: envelope.wrappedDekKeyVersion,
    wrapped_dek_key: envelope.wrappedDekKey,
    ...overrides,
  };
}

describe("DEE-1015 account-observation credential read boundary", () => {
  it("grants no authority beyond migration 0210's exact projection", () => {
    expect([...ACCOUNT_OBSERVATION_CREDENTIAL_COLUMNS]).toEqual([
      "id",
      "organization_id",
      "exchange_account_id",
      "status",
      "encrypted_payload",
      "payload_key_version",
      "wrapped_dek_key_version",
      "wrapped_dek_key",
    ]);
    for (const withheld of [
      "venue",
      "api_key_masked",
      "permission_metadata",
      "observation_revision",
      "created_at",
      "updated_at",
      "revoked_at",
    ]) {
      expect(ACCOUNT_OBSERVATION_CREDENTIAL_COLUMNS).not.toContain(withheld);
    }
    expect(ACCOUNT_OBSERVATION_CREDENTIAL_ROLE).toBe("waia_account_observation_credential");
  });

  it("refuses a malformed, empty, oversized or duplicated assignment set", async () => {
    const { sql } = fakeSql([]);
    const key = await provider();
    const build = (assignments: unknown[]) =>
      createObservationCredentialReader({
        sql,
        provider: key,
        assignments: assignments as never,
      });
    expect(() => build([])).toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:ASSIGNMENTS_INVALID");
    expect(() => build([ASSIGNMENT, ASSIGNMENT])).toThrow(
      "ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:ASSIGNMENTS_INVALID",
    );
    expect(() => build(Array.from({ length: 21 }, () => ASSIGNMENT))).toThrow(
      "ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:ASSIGNMENTS_INVALID",
    );
    expect(() => build([{ ...ASSIGNMENT, organizationId: "not-a-uuid" }])).toThrow(
      "ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:ASSIGNMENTS_INVALID",
    );
    expect(() => build([{ ...ASSIGNMENT, exchangeAccountId: "0" }])).toThrow(
      "ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:ASSIGNMENTS_INVALID",
    );
  });

  it("refuses an unassigned credential before opening any transaction", async () => {
    const { sql, statements } = fakeSql([]);
    const reader = createObservationCredentialReader({
      sql,
      provider: await provider(),
      assignments: [ASSIGNMENT],
    });
    await expect(
      reader.getDecryptedCredentials({ organizationId: ORGANIZATION }, OTHER_CREDENTIAL),
    ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_ASSIGNED");
    await expect(
      reader.getDecryptedCredentials({ organizationId: OTHER_CREDENTIAL }, CREDENTIAL),
    ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_ASSIGNED");
    expect(statements).toEqual([]);
  });

  it("decrypts a Connect-enrolled cabinet named with the full identity triple", async () => {
    const { sql, statements, parameters } = fakeSql([await encryptedRow({ id: OTHER_CREDENTIAL })]);
    const reader = createObservationCredentialReader({
      sql,
      provider: await provider(),
      assignments: [ASSIGNMENT],
    });
    await expect(
      reader.getDecryptedCredentials(
        { organizationId: ORGANIZATION, exchangeAccountId: ACCOUNT },
        OTHER_CREDENTIAL,
      ),
    ).resolves.toEqual({ apiKey: "unit-api-key", apiSecret: "unit-api-secret" });
    expect(parameters[5]).toEqual([ORGANIZATION, OTHER_CREDENTIAL, ACCOUNT]);
    expect(statements[6]).toContain(
      "WHERE id = $1 AND organization_id = $2 AND exchange_account_id = $3",
    );
  });

  it("fails closed on master-key readiness before touching a credential row", async () => {
    const { sql, statements } = fakeSql(await encryptedRow().then((row) => [row]));
    const reader = createObservationCredentialReader({
      sql,
      provider: await provider(false),
      assignments: [ASSIGNMENT],
    });
    await expect(
      reader.getDecryptedCredentials({ organizationId: ORGANIZATION }, CREDENTIAL),
    ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:MASTER_KEY_NOT_READY");
    expect(statements).toEqual([]);
  });

  it("reads through the dedicated role in a bounded read-only transaction", async () => {
    const { sql, statements, parameters } = fakeSql([await encryptedRow()]);
    const reader = createObservationCredentialReader({
      sql,
      provider: await provider(),
      assignments: [ASSIGNMENT],
    });
    await expect(
      reader.getDecryptedCredentials({ organizationId: ORGANIZATION }, CREDENTIAL),
    ).resolves.toEqual({ apiKey: "unit-api-key", apiSecret: "unit-api-secret" });

    expect(statements[0]).toBe("SET TRANSACTION READ ONLY");
    expect(statements[1]).toBe(`SET LOCAL ROLE ${ACCOUNT_OBSERVATION_CREDENTIAL_ROLE}`);
    expect(statements.slice(2, 4)).toEqual([
      "SET LOCAL statement_timeout = '3000ms'",
      "SET LOCAL lock_timeout = '1000ms'",
    ]);
    expect(statements[4]).toBe("SET LOCAL transaction_timeout = '5000ms'");
    // Transaction-local observation context, published from the trusted assignment only.
    expect(statements[5]).toContain("set_config('waia.observation_org'");
    expect(statements[5]).toContain("set_config('waia.observation_credential'");
    expect(statements[5]).toContain("set_config('waia.observation_account'");
    expect(parameters[5]).toEqual([ORGANIZATION, CREDENTIAL, ACCOUNT]);

    const select = statements[6]!;
    expect(select).not.toContain("*");
    for (const column of ACCOUNT_OBSERVATION_CREDENTIAL_COLUMNS) {
      expect(select).toContain(column);
    }
    expect(select).toContain("WHERE id = $1 AND organization_id = $2 AND exchange_account_id = $3");
    expect(parameters[6]).toEqual([CREDENTIAL, ORGANIZATION, ACCOUNT]);
    // No write, DDL or privilege-changing statement is ever issued.
    for (const statement of statements) {
      expect(statement).not.toMatch(
        /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|CREATE|DROP)\b/i,
      );
    }
  });

  it("refuses an absent row, a mismatched identity tuple and an inactive credential", async () => {
    const key = await provider();
    const absent = fakeSql([]);
    await expect(
      createObservationCredentialReader({
        sql: absent.sql,
        provider: key,
        assignments: [ASSIGNMENT],
      }).getDecryptedCredentials({ organizationId: ORGANIZATION }, CREDENTIAL),
    ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_FOUND");

    const mismatched = fakeSql([await encryptedRow({ exchange_account_id: "99999999" })]);
    await expect(
      createObservationCredentialReader({
        sql: mismatched.sql,
        provider: key,
        assignments: [ASSIGNMENT],
      }).getDecryptedCredentials({ organizationId: ORGANIZATION }, CREDENTIAL),
    ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:IDENTITY_MISMATCH");

    const revoked = fakeSql([await encryptedRow({ status: "revoked" })]);
    await expect(
      createObservationCredentialReader({
        sql: revoked.sql,
        provider: key,
        assignments: [ASSIGNMENT],
      }).getDecryptedCredentials({ organizationId: ORGANIZATION }, CREDENTIAL),
    ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_FOUND");

    const duplicated = fakeSql([await encryptedRow(), await encryptedRow()]);
    await expect(
      createObservationCredentialReader({
        sql: duplicated.sql,
        provider: key,
        assignments: [ASSIGNMENT],
      }).getDecryptedCredentials({ organizationId: ORGANIZATION }, CREDENTIAL),
    ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_FOUND");
  });

  it("never leaks ciphertext, key material or SQL text in a refusal", async () => {
    const { sql } = fakeSql([await encryptedRow({ encrypted_payload: "not-decryptable" })]);
    const reader = createObservationCredentialReader({
      sql,
      provider: await provider(),
      assignments: [ASSIGNMENT],
    });
    await expect(
      reader.getDecryptedCredentials({ organizationId: ORGANIZATION }, CREDENTIAL),
    ).rejects.toThrow(/^ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:[A-Z_]+$/);
  });
});
