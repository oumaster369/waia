// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

import {
  parseProvisioningCliArguments,
  runAccountObservationCollectionStateProvisioning,
  type AccountObservationProvisioningInput,
} from "@/scripts/ops/account-observation-provision-collection-state-v1";
import {
  ACCOUNT_A,
  ACCOUNT_B,
  CREDENTIAL_A,
  CREDENTIAL_B,
  MANIFEST_RELEASE_SHA,
  ORGANIZATION_A,
  ORGANIZATION_B,
  manifestAssignment,
  sealManifest,
} from "./account-observation-manifest-fixtures";

const MANIFEST = sealManifest();
const ASSIGNMENT = MANIFEST.body.assignments[0]!;
const MANIFEST_PATH = "/srv/waia/observation-assignments.json";
const PROVISIONING_URL = "postgres://waia_migrator:pw@db.internal:5432/waia";

type Row = Record<string, unknown>;

const attestation = (overrides: Row = {}): Row => ({
  database_name: "waia",
  current_user_name: "waia_migrator",
  server_version_num: "170004",
  original_session: true,
  supported: true,
  unfiltered_authority: true,
  can_insert_state: true,
  not_runtime_role: true,
  collector_no_state_insert: true,
  reader_no_state_insert: true,
  collector_no_destructive: true,
  forced_rls: true,
  ...overrides,
});

const credential = (overrides: Row = {}): Row => ({
  organization_id: ORGANIZATION_A,
  venue: "htx",
  exchange_account_id: ACCOUNT_A,
  status: "active",
  observation_revision: ASSIGNMENT.credentialRevision,
  ...overrides,
});

const provisionedRow = (overrides: Row = {}): Row => ({
  configuration_revision: ASSIGNMENT.configurationRevision,
  symbols: [...ASSIGNMENT.symbols],
  consecutive_failures: 0,
  lease_token: null,
  lease_owner: null,
  lease_expires_at: null,
  last_observation_id: null,
  ...overrides,
});

/** A fake transaction that answers each of the operator's statements by shape, so refusal
 * ordering and the exact INSERT can be asserted without a live cluster. */
function fakeDatabase(
  options: Readonly<{
    attested?: Row | null;
    credential?: Row | null;
    existing?: Row | null;
    committed?: Row | null;
    credentialThrows?: boolean;
  }> = {},
) {
  const statements: string[] = [];
  const inserted: unknown[][] = [];

  const tx = Object.assign(
    async (chunks: TemplateStringsArray, ...values: unknown[]) => {
      const statement = chunks.join("?");
      statements.push(statement);
      if (statement.includes("AS database_name")) {
        const row = options.attested === undefined ? attestation() : options.attested;
        return row ? [row] : [];
      }
      if (statement.includes("FROM public.exchange_credentials")) {
        if (options.credentialThrows) throw new Error("lock timeout");
        const row = options.credential === undefined ? credential() : options.credential;
        return row ? [row] : [];
      }
      if (statement.includes("INSERT INTO public.trader_account_collection_state")) {
        inserted.push(values);
        return [];
      }
      if (statement.includes("FOR UPDATE")) {
        return options.existing ? [options.existing] : [];
      }
      if (statement.includes("consecutive_failures")) {
        const row = options.committed === undefined ? provisionedRow() : options.committed;
        return row ? [row] : [];
      }
      return [];
    },
    {
      unsafe: vi.fn(async (statement: string) => {
        statements.push(statement);
        return [];
      }),
      json: (value: unknown) => value,
    },
  );

  const sql = Object.assign(vi.fn(), {
    begin: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
    end: vi.fn(async () => {}),
  }) as unknown as postgres.Sql;

  return { sql, statements, inserted, connect: vi.fn(() => sql) };
}

function input(
  overrides: Partial<AccountObservationProvisioningInput> = {},
): AccountObservationProvisioningInput {
  return {
    manifestPath: MANIFEST_PATH,
    expectedManifestSha256: MANIFEST.digest,
    expectedReleaseSha: MANIFEST_RELEASE_SHA,
    organizationId: ORGANIZATION_A,
    credentialId: CREDENTIAL_A,
    exchangeAccountId: ACCOUNT_A,
    confirmedAssignment: `${ORGANIZATION_A}:${CREDENTIAL_A}:${ACCOUNT_A}`,
    verifyOnly: false,
    databaseUrl: PROVISIONING_URL,
    ...overrides,
  };
}

function run(
  overrides: Partial<AccountObservationProvisioningInput> = {},
  database = fakeDatabase(),
  manifestText: string = MANIFEST.text,
) {
  return runAccountObservationCollectionStateProvisioning(input(overrides), {
    connect: database.connect,
    readManifest: () => manifestText,
  });
}

describe("account observation collection-state provisioning", () => {
  it("provisions one exact approved row and returns a sealed receipt", async () => {
    const database = fakeDatabase();
    const receipt = await run({}, database);

    expect(receipt.classification).toBe("PROVISIONED");
    expect(receipt.mode).toBe("APPLY");
    expect(receipt.manifestSha256).toBe(MANIFEST.digest);
    expect(receipt.releaseSha).toBe(MANIFEST_RELEASE_SHA);
    expect(receipt.organizationId).toBe(ORGANIZATION_A);
    expect(receipt.credentialId).toBe(CREDENTIAL_A);
    expect(receipt.exchangeAccountId).toBe(ACCOUNT_A);
    expect(receipt.configurationRevision).toBe(ASSIGNMENT.configurationRevision);
    expect(receipt.symbols).toEqual([...ASSIGNMENT.symbols]);
    expect(receipt.leastPrivilege).toEqual({
      collectorStateInsert: false,
      readerStateInsert: false,
      forcedRowLevelSecurity: true,
    });
    expect(receipt.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(receipt)).toBe(true);

    expect(database.inserted).toHaveLength(1);
    expect(database.inserted[0]).toEqual([
      ORGANIZATION_A,
      CREDENTIAL_A,
      ACCOUNT_A,
      ASSIGNMENT.configurationRevision,
      [...ASSIGNMENT.symbols],
    ]);
    expect(database.sql.end).toHaveBeenCalled();
  });

  it("inserts only, with no UPDATE, DELETE, TRUNCATE or observation-history statement", async () => {
    const database = fakeDatabase();
    await run({}, database);
    const script = database.statements.join("\n");

    expect(script).toMatch(/INSERT INTO public\.trader_account_collection_state/);
    expect(script).not.toMatch(/INSERT INTO public\.trader_account_observations/);
    // Verb check per statement: `DELETE,TRUNCATE` also appears inside read-only privilege probes.
    for (const statement of database.statements) {
      expect(statement.trimStart()).not.toMatch(
        /^(UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|REVOKE|CREATE)\b/i,
      );
    }
    // Exactly one row is written, and only to collection state.
    expect(database.statements.filter((statement) => /^\s*INSERT/i.test(statement))).toHaveLength(
      1,
    );
  });

  it("bounds the provisioning transaction before touching any row", async () => {
    const database = fakeDatabase();
    await run({}, database);

    expect(database.statements[0]).toMatch(/SET LOCAL statement_timeout/);
    expect(database.statements[1]).toMatch(/SET LOCAL lock_timeout/);
    expect(database.statements[2]).toMatch(/AS database_name/);
  });

  it("is idempotent for an exact existing row and inserts nothing", async () => {
    const database = fakeDatabase({
      existing: {
        configuration_revision: ASSIGNMENT.configurationRevision,
        symbols: [...ASSIGNMENT.symbols],
        last_observation_id: null,
      },
    });
    const receipt = await run({}, database);

    expect(receipt.classification).toBe("ALREADY_PROVISIONED");
    expect(database.inserted).toHaveLength(0);
  });

  it("stays idempotent for an already-observing row and never rewrites history", async () => {
    const database = fakeDatabase({
      existing: {
        configuration_revision: ASSIGNMENT.configurationRevision,
        symbols: [...ASSIGNMENT.symbols],
        last_observation_id: "99999999-9999-4999-8999-999999999999",
      },
    });
    const receipt = await run({}, database);

    expect(receipt.classification).toBe("ALREADY_PROVISIONED");
    expect(database.inserted).toHaveLength(0);
  });

  it("refuses a conflicting existing configuration revision", async () => {
    const database = fakeDatabase({
      existing: {
        configuration_revision: "sha256:" + "c".repeat(64),
        symbols: [...ASSIGNMENT.symbols],
        last_observation_id: null,
      },
    });

    await expect(run({}, database)).rejects.toThrow(/REFUSED:CONFLICTING_STATE/);
    expect(database.inserted).toHaveLength(0);
  });

  it("refuses a conflicting existing symbol set", async () => {
    const database = fakeDatabase({
      existing: {
        configuration_revision: ASSIGNMENT.configurationRevision,
        symbols: ["ETHUSDT"],
        last_observation_id: null,
      },
    });

    await expect(run({}, database)).rejects.toThrow(/REFUSED:CONFLICTING_STATE/);
    expect(database.inserted).toHaveLength(0);
  });

  it("verifies without writing when asked to verify only", async () => {
    const database = fakeDatabase();
    const receipt = await run({ verifyOnly: true, confirmedAssignment: null }, database);

    expect(receipt.classification).toBe("VERIFIED");
    expect(receipt.mode).toBe("VERIFY_ONLY");
    expect(database.inserted).toHaveLength(0);
  });

  it("requires an exact typed confirmation before applying", async () => {
    const database = fakeDatabase();

    await expect(run({ confirmedAssignment: null }, database)).rejects.toThrow(
      /REFUSED:CONFIRMATION_MISMATCH/,
    );
    await expect(
      run({ confirmedAssignment: `${ORGANIZATION_A}:${CREDENTIAL_A}:${ACCOUNT_B}` }, database),
    ).rejects.toThrow(/REFUSED:CONFIRMATION_MISMATCH/);
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("refuses a relative manifest path before connecting", async () => {
    const database = fakeDatabase();

    await expect(run({ manifestPath: "observation.json" }, database)).rejects.toThrow(
      /REFUSED:MANIFEST_PATH/,
    );
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("refuses a transaction-pooled or runtime-login connection string", async () => {
    const database = fakeDatabase();

    await expect(
      run({ databaseUrl: "postgres://waia_migrator:pw@db.internal:6543/waia" }, database),
    ).rejects.toThrow(/REFUSED:DATABASE_URL_INVALID/);
    await expect(
      run(
        { databaseUrl: "postgres://waia_migrator:pw@db.internal:5432/waia?pool_mode=transaction" },
        database,
      ),
    ).rejects.toThrow(/REFUSED:DATABASE_URL_INVALID/);
    await expect(run({ databaseUrl: "not-a-url" }, database)).rejects.toThrow(
      /REFUSED:DATABASE_URL_INVALID/,
    );
    expect(database.connect).not.toHaveBeenCalled();
  });

  it.each([
    "waia_account_observer_login",
    "waia_account_observation_reader_login",
    "waia_account_observation_credential_login",
  ])("refuses provisioning through the %s runtime login", async (login) => {
    const database = fakeDatabase();

    await expect(
      run({ databaseUrl: `postgres://${login}:pw@db.internal:5432/waia` }, database),
    ).rejects.toThrow(/REFUSED:PROVISIONING_ROLE_IS_RUNTIME_LOGIN/);
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("refuses an assignment that is not in the trusted manifest", async () => {
    const database = fakeDatabase();

    await expect(
      run(
        {
          organizationId: ORGANIZATION_B,
          confirmedAssignment: `${ORGANIZATION_B}:${CREDENTIAL_A}:${ACCOUNT_A}`,
        },
        database,
      ),
    ).rejects.toThrow(/REFUSED:ASSIGNMENT_NOT_IN_MANIFEST/);
    await expect(
      run(
        {
          credentialId: CREDENTIAL_B,
          confirmedAssignment: `${ORGANIZATION_A}:${CREDENTIAL_B}:${ACCOUNT_A}`,
        },
        database,
      ),
    ).rejects.toThrow(/REFUSED:ASSIGNMENT_NOT_IN_MANIFEST/);
    await expect(
      run(
        {
          exchangeAccountId: ACCOUNT_B,
          confirmedAssignment: `${ORGANIZATION_A}:${CREDENTIAL_A}:${ACCOUNT_B}`,
        },
        database,
      ),
    ).rejects.toThrow(/REFUSED:ASSIGNMENT_NOT_IN_MANIFEST/);
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("refuses a substituted manifest before connecting", async () => {
    const database = fakeDatabase();
    const substituted = sealManifest({
      assignments: [
        manifestAssignment({ credentialId: CREDENTIAL_B, exchangeAccountId: ACCOUNT_B }),
      ],
    });

    await expect(run({}, database, substituted.text)).rejects.toThrow(
      /MANIFEST_REFUSED:EXPECTED_DIGEST/,
    );
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("refuses a manifest sealed for another release before connecting", async () => {
    const database = fakeDatabase();
    const other = sealManifest({ releaseSha: "0".repeat(40) });

    await expect(
      run({ expectedManifestSha256: other.digest }, database, other.text),
    ).rejects.toThrow(/MANIFEST_REFUSED:RELEASE_SHA/);
    expect(database.connect).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a session whose role was changed",
      { original_session: false },
      /PROVISIONING_SESSION_ROLE_CHANGED/,
    ],
    ["an unsupported server version", { supported: false }, /POSTGRES_VERSION_UNSUPPORTED/],
    [
      "a runtime observation role",
      { not_runtime_role: false },
      /PROVISIONING_ROLE_IS_RUNTIME_ROLE/,
    ],
    ["a role without INSERT", { can_insert_state: false }, /PROVISIONING_AUTHORITY_INSUFFICIENT/],
    [
      "a role filtered by row level security",
      { unfiltered_authority: false },
      /PROVISIONING_AUTHORITY_INSUFFICIENT/,
    ],
    [
      "a collector that gained state INSERT",
      { collector_no_state_insert: false },
      /COLLECTOR_INSERT_AUTHORITY_BROADENED/,
    ],
    [
      "a reader that gained state INSERT",
      { reader_no_state_insert: false },
      /COLLECTOR_INSERT_AUTHORITY_BROADENED/,
    ],
    [
      "a collector that gained destructive authority",
      { collector_no_destructive: false },
      /COLLECTOR_DESTRUCTIVE_AUTHORITY/,
    ],
    [
      "disabled forced row level security",
      { forced_rls: false },
      /FORCED_ROW_LEVEL_SECURITY_DISABLED/,
    ],
  ])("refuses %s", async (_label, overrides, expected) => {
    const database = fakeDatabase({ attested: attestation(overrides as Row) });

    await expect(run({}, database)).rejects.toThrow(expected as RegExp);
    expect(database.inserted).toHaveLength(0);
  });

  it("refuses when the attestation returns no row at all", async () => {
    const database = fakeDatabase({ attested: null });

    await expect(run({}, database)).rejects.toThrow(/REFUSED:PROVISIONING_ATTESTATION/);
  });

  it.each([
    ["a missing credential", null, /CREDENTIAL_NOT_FOUND/],
    [
      "a credential owned by another organization",
      credential({ organization_id: ORGANIZATION_B }),
      /CREDENTIAL_ORGANIZATION_MISMATCH/,
    ],
    [
      "a credential bound to another account",
      credential({ exchange_account_id: ACCOUNT_B }),
      /CREDENTIAL_ACCOUNT_MISMATCH/,
    ],
    ["a credential for another venue", credential({ venue: "binance" }), /CREDENTIAL_VENUE/],
    ["a revoked credential", credential({ status: "revoked" }), /CREDENTIAL_NOT_ACTIVE/],
    ["a disabled credential", credential({ status: "disabled" }), /CREDENTIAL_NOT_ACTIVE/],
    [
      "a rotated credential revision",
      credential({ observation_revision: "7" }),
      /CREDENTIAL_REVISION_MISMATCH/,
    ],
  ])("refuses %s", async (_label, row, expected) => {
    const database = fakeDatabase({ credential: row as Row | null });

    await expect(run({}, database)).rejects.toThrow(expected as RegExp);
    expect(database.inserted).toHaveLength(0);
  });

  it("refuses when the credential row cannot be locked", async () => {
    const database = fakeDatabase({ credentialThrows: true });

    await expect(run({}, database)).rejects.toThrow(/REFUSED:CREDENTIAL_LOCK_TIMEOUT/);
    expect(database.inserted).toHaveLength(0);
  });

  it("locks the credential row before reading collection state", async () => {
    const database = fakeDatabase();
    await run({}, database);

    const credentialIndex = database.statements.findIndex((statement) =>
      statement.includes("FROM public.exchange_credentials"),
    );
    const stateIndex = database.statements.findIndex((statement) =>
      statement.includes("FROM public.trader_account_collection_state"),
    );
    expect(credentialIndex).toBeGreaterThan(-1);
    expect(stateIndex).toBeGreaterThan(credentialIndex);
    expect(database.statements[credentialIndex]).toMatch(/FOR SHARE/);
  });

  it("refuses when the written row is not exactly the approved row", async () => {
    for (const broken of [
      null,
      provisionedRow({ configuration_revision: "sha256:" + "d".repeat(64) }),
      provisionedRow({ symbols: ["ETHUSDT"] }),
      provisionedRow({ consecutive_failures: 1 }),
      provisionedRow({ lease_owner: "someone" }),
      provisionedRow({ lease_token: "11111111-1111-4111-8111-111111111111" }),
      provisionedRow({ lease_expires_at: "2026-01-01T00:00:00Z" }),
      provisionedRow({ last_observation_id: "22222222-2222-4222-8222-222222222222" }),
    ]) {
      const database = fakeDatabase({ committed: broken as Row | null });
      await expect(run({}, database)).rejects.toThrow(/REFUSED:PROVISIONED_STATE_VERIFICATION/);
    }
  });

  it("closes the connection even when provisioning is refused", async () => {
    const database = fakeDatabase({ attested: null });

    await expect(run({}, database)).rejects.toThrow(/REFUSED/);
    expect(database.sql.end).toHaveBeenCalled();
  });

  it("never places secret material in the receipt", async () => {
    const receipt = await run();

    expect(JSON.stringify(receipt)).not.toContain("pw@db.internal");
    expect(JSON.stringify(receipt)).not.toMatch(/apiKey|apiSecret|encrypted_payload|wrapped_dek/i);
  });
});

describe("provisioning operator command line", () => {
  const argv = [
    "--manifest",
    MANIFEST_PATH,
    "--expected-manifest-sha256",
    MANIFEST.digest,
    "--expected-release-sha",
    MANIFEST_RELEASE_SHA,
    "--organization-id",
    ORGANIZATION_A,
    "--credential-id",
    CREDENTIAL_A,
    "--exchange-account-id",
    ACCOUNT_A,
    "--confirm-exact-assignment",
    `${ORGANIZATION_A}:${CREDENTIAL_A}:${ACCOUNT_A}`,
  ];

  it("parses an exact apply invocation", () => {
    expect(parseProvisioningCliArguments(argv)).toEqual({
      manifestPath: MANIFEST_PATH,
      expectedManifestSha256: MANIFEST.digest,
      expectedReleaseSha: MANIFEST_RELEASE_SHA,
      organizationId: ORGANIZATION_A,
      credentialId: CREDENTIAL_A,
      exchangeAccountId: ACCOUNT_A,
      confirmedAssignment: `${ORGANIZATION_A}:${CREDENTIAL_A}:${ACCOUNT_A}`,
      verifyOnly: false,
    });
  });

  it("allows a verify-only invocation without a confirmation", () => {
    const parsed = parseProvisioningCliArguments([...argv.slice(0, 12), "--verify-only"]);

    expect(parsed.verifyOnly).toBe(true);
    expect(parsed.confirmedAssignment).toBeNull();
  });

  it("requires the confirmation when applying", () => {
    expect(() => parseProvisioningCliArguments(argv.slice(0, 12))).toThrow(
      /REFUSED:CLI_OPTION_REQUIRED:--confirm-exact-assignment/,
    );
  });

  it("refuses unknown, duplicated and valueless options", () => {
    expect(() => parseProvisioningCliArguments([...argv, "--force"])).toThrow(
      /REFUSED:CLI_OPTION:--force/,
    );
    expect(() => parseProvisioningCliArguments([...argv, "--manifest", "/other.json"])).toThrow(
      /REFUSED:CLI_OPTION:--manifest/,
    );
    expect(() => parseProvisioningCliArguments(["--manifest"])).toThrow(
      /REFUSED:CLI_OPTION_VALUE:--manifest/,
    );
    expect(() => parseProvisioningCliArguments(["--manifest", "--verify-only"])).toThrow(
      /REFUSED:CLI_OPTION_VALUE:--manifest/,
    );
    expect(() =>
      parseProvisioningCliArguments([...argv, "--verify-only", "--verify-only"]),
    ).toThrow(/REFUSED:CLI_DUPLICATE_OPTION/);
  });

  it("requires every identity option", () => {
    for (const option of [
      "--manifest",
      "--expected-manifest-sha256",
      "--expected-release-sha",
      "--organization-id",
      "--credential-id",
      "--exchange-account-id",
    ]) {
      const index = argv.indexOf(option);
      const without = [...argv.slice(0, index), ...argv.slice(index + 2)];
      expect(() => parseProvisioningCliArguments(without)).toThrow(
        new RegExp(`REFUSED:CLI_OPTION_REQUIRED:${option}`),
      );
    }
  });
});
