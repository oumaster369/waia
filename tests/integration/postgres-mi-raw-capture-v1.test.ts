import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  attestRawSecretScanV1,
  buildRawStorageBindingAtDurableBoundaryV1,
  defineRawCapturePolicyV1,
  prepareRawCaptureV1,
} from "@/lib/trader/mi/raw-capture-v1";
import {
  persistPreparedRawCaptureV1Postgres,
  readRawCaptureReceiptV1Postgres,
  recordRawValidationV1Postgres,
  RawCapturePersistenceConflictError,
  RawCaptureSourceNotFoundError,
} from "@/lib/trader/mi/raw-capture-repository-postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000065601";
const USER_B = "00000000-0000-4000-8000-000000065602";
const SOURCE_A = "00000000-0000-4000-8000-000000065611";
const SOURCE_B = "00000000-0000-4000-8000-000000065612";
const BODY = new TextEncoder().encode('{"test":"raw-only"}');
const hex64 = (seed: string) => createHash("sha256").update(seed).digest("hex");

async function clearRaw(sqlClient: postgres.Sql, org: string) {
  const tables = [
    "trader_mi_raw_validation_receipt_v1",
    "trader_mi_raw_capture_receipt_v1",
    "trader_mi_raw_storage_binding_v1",
  ];
  for (const table of tables) {
    await sqlClient.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
  }
  try {
    for (const table of tables) {
      await sqlClient.unsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, [org]);
    }
    await sqlClient.unsafe("DELETE FROM trader_mi_source WHERE organization_id = $1::uuid", [org]);
  } finally {
    for (const table of tables.reverse()) {
      await sqlClient.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
    }
  }
}

async function resetUser(userId: string) {
  const sqlClient = postgres(url!, { max: 1 });
  try { await clearRaw(sqlClient, personalOrganizationIdFromUserId(userId)); } catch {
  } finally { await sqlClient.end({ timeout: 5 }); }
  await cleanupWp13Org(url!, userId);
}

function prepared(organizationId: string, sourceId: string, retentionSeconds = 3_600) {
  const scanAt = new Date(Date.now() - 10_000);
  return prepareRawCaptureV1({
    organizationId,
    sourceId,
    bodyBytes: BODY,
    policy: defineRawCapturePolicyV1({ maxPayloadBytes: 1_024, retentionSeconds }),
    secretScanReceipt: attestRawSecretScanV1({
      status: "PASS",
      bodyBytes: BODY,
      scannerId: "postgres-test-scanner",
      scannerVersion: "test-v1",
      completedAt: scanAt,
    }),
  });
}

function binding(input: ReturnType<typeof prepared>, objectKey = "object-a") {
  return buildRawStorageBindingAtDurableBoundaryV1({
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    rawBytesDigest: input.rawBytesDigest,
    objectReference: {
      storageBackendId: "test-private-object-store",
      objectKey,
      objectVersion: "test-version-1",
      encryptionRequirement: "PRIVATE_ENCRYPTED",
      accessRequirement: "SERVER_ONLY",
    },
    storedAt: new Date(Date.now() - 5_000),
  });
}

describe.skipIf(!enabled || !url)("postgres MI Raw Capture V1 (DEE-658)", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    await resetUser(USER_A); await resetUser(USER_B);
    orgA = await seedWp13User(url!, USER_A, "DEE-658 Raw Org A");
    orgB = await seedWp13User(url!, USER_B, "DEE-658 Raw Org B");
    sqlClient = postgres(url!, { max: 2 });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
  }, 120_000);

  beforeEach(async () => {
    await clearRaw(sqlClient, orgA); await clearRaw(sqlClient, orgB);
    await sqlClient`INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, status)
      VALUES (${SOURCE_A}::uuid, ${orgA}::uuid, 'test-a', 'raw-foundation', 'active')`;
    await sqlClient`INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, status)
      VALUES (${SOURCE_B}::uuid, ${orgB}::uuid, 'test-b', 'raw-foundation', 'active')`;
  });

  afterAll(async () => {
    if (sqlClient) {
      await clearRaw(sqlClient, orgA); await clearRaw(sqlClient, orgB);
      await sqlClient.end({ timeout: 10 });
    }
    await cleanupWp13Org(url!, USER_A); await cleanupWp13Org(url!, USER_B);
  });

  it("persists no body bytes and records rejected validation idempotently", async () => {
    const admission = prepared(orgA, SOURCE_A);
    const storeBinding = binding(admission);
    const stored = await persistPreparedRawCaptureV1Postgres(db, { organizationId: orgA }, {
      prepared: admission,
      storageBinding: storeBinding,
    });
    const replay = await persistPreparedRawCaptureV1Postgres(db, { organizationId: orgA }, {
      prepared: admission,
      storageBinding: storeBinding,
    });
    const validation = await recordRawValidationV1Postgres(db, { organizationId: orgA }, {
      captureReceiptDigest: stored.receipt.contentDigest,
      validatorId: "generic-record-only",
      validatorVersion: "v1",
      outcome: { status: "REJECTED", reasonCodes: ["PAYLOAD_SCHEMA_UNKNOWN"] },
    });
    const validationReplay = await recordRawValidationV1Postgres(db, { organizationId: orgA }, {
      captureReceiptDigest: stored.receipt.contentDigest,
      validatorId: "generic-record-only",
      validatorVersion: "v1",
      outcome: { status: "REJECTED", reasonCodes: ["PAYLOAD_SCHEMA_UNKNOWN"] },
    });
    expect(stored.insertedNew).toBe(true);
    expect(replay).toEqual({ receipt: stored.receipt, insertedNew: false });
    expect(validation.receipt).toMatchObject({
      status: "REJECTED", authority: "RECORD_ONLY",
      observationAuthority: "NONE", measurementAuthority: "NONE",
    });
    expect(validationReplay).toEqual({ receipt: validation.receipt, insertedNew: false });
    expect(new Date(validation.receipt.knownAtUtc).getTime())
      .toBeGreaterThanOrEqual(new Date(stored.receipt.capturedAtUtc).getTime());

    const forbiddenColumns = await sqlClient<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (
          'trader_mi_raw_storage_binding_v1',
          'trader_mi_raw_capture_receipt_v1',
          'trader_mi_raw_validation_receipt_v1'
        )
        AND column_name IN ('body', 'body_bytes', 'raw_body', 'raw_bytes', 'payload_json')
    `;
    expect(forbiddenColumns).toEqual([]);
  });

  it("authors capture and validation knowledge times inside the transaction", async () => {
    const admission = prepared(orgA, SOURCE_A);
    const { receipt } = await persistPreparedRawCaptureV1Postgres(db, { organizationId: orgA }, {
      prepared: admission,
      storageBinding: binding(admission),
    });
    const captureTimes = await sqlClient<{ captured_at: string; created_at: string }[]>`
      SELECT captured_at, created_at FROM trader_mi_raw_capture_receipt_v1 WHERE id = ${receipt.id}
    `;
    expect(new Date(captureTimes[0]!.captured_at).toISOString())
      .toBe(new Date(captureTimes[0]!.created_at).toISOString());

    const validation = await recordRawValidationV1Postgres(db, { organizationId: orgA }, {
      captureReceiptDigest: receipt.id,
      validatorId: "database-time-proof",
      validatorVersion: "v1",
      outcome: { status: "VALID", reasonCodes: [] },
    });
    const validationTimes = await sqlClient<{ known_at: string; created_at: string }[]>`
      SELECT known_at, created_at FROM trader_mi_raw_validation_receipt_v1
      WHERE id = ${validation.receipt.id}
    `;
    expect(new Date(validationTimes[0]!.known_at).toISOString())
      .toBe(new Date(validationTimes[0]!.created_at).toISOString());

    const directId = hex64("direct-known-at-overwrite");
    await expect(sqlClient`
      INSERT INTO trader_mi_raw_validation_receipt_v1 (
        id, organization_id, source_id, capture_receipt_digest, validator_id, validator_version,
        status, reason_codes_json, known_at, authority, observation_authority,
        measurement_authority, receipt_json, content_digest, schema_version, created_at
      ) VALUES (
        ${directId}, ${orgA}::uuid, ${SOURCE_A}::uuid, ${receipt.id}, 'trigger-proof', 'v1',
        'VALID', '[]', '2000-01-01T00:00:00Z', 'RECORD_ONLY', 'NONE', 'NONE', '{}',
        ${directId}, 'raw-validation-receipt-v1', '2000-01-01T00:00:00Z'
      )
    `).rejects.toThrow(/database-authored transaction time/);
  });

  it("fails closed across tenant/source scope and on idempotency conflicts", async () => {
    const admission = prepared(orgA, SOURCE_A);
    const storeBinding = binding(admission);
    const { receipt } = await persistPreparedRawCaptureV1Postgres(db, { organizationId: orgA }, {
      prepared: admission,
      storageBinding: storeBinding,
    });
    await expect(readRawCaptureReceiptV1Postgres(
      db, { organizationId: orgB }, receipt.contentDigest,
    )).resolves.toBeNull();
    await expect(persistPreparedRawCaptureV1Postgres(db, { organizationId: orgB }, {
      prepared: admission,
      storageBinding: storeBinding,
    })).rejects.toBeInstanceOf(RawCapturePersistenceConflictError);
    const changedPolicy = prepared(orgA, SOURCE_A, 7_200);
    await expect(persistPreparedRawCaptureV1Postgres(db, { organizationId: orgA }, {
      prepared: changedPolicy,
      storageBinding: storeBinding,
    })).rejects.toBeInstanceOf(RawCapturePersistenceConflictError);
    await expect(persistPreparedRawCaptureV1Postgres(db, { organizationId: orgA }, {
      prepared: prepared(orgA, SOURCE_B),
      storageBinding: binding(prepared(orgA, SOURCE_B), "wrong-source"),
    })).rejects.toBeInstanceOf(RawCaptureSourceNotFoundError);
  });

  it("blocks mutation and denies authenticated/anon direct access", async () => {
    const admission = prepared(orgA, SOURCE_A);
    const storeBinding = binding(admission);
    const { receipt } = await persistPreparedRawCaptureV1Postgres(db, { organizationId: orgA }, {
      prepared: admission,
      storageBinding: storeBinding,
    });
    const validation = await recordRawValidationV1Postgres(db, { organizationId: orgA }, {
      captureReceiptDigest: receipt.contentDigest,
      validatorId: "generic-record-only",
      validatorVersion: "v1",
      outcome: { status: "VALID", reasonCodes: [] },
    });
    const targets = [
      ["trader_mi_raw_storage_binding_v1", storeBinding.id],
      ["trader_mi_raw_capture_receipt_v1", receipt.id],
      ["trader_mi_raw_validation_receipt_v1", validation.receipt.id],
    ] as const;
    for (const [table, id] of targets) {
      await expect(sqlClient.unsafe(`UPDATE ${table} SET content_digest = content_digest WHERE id = $1`, [id]))
        .rejects.toThrow(/append-only/);
      await expect(sqlClient.unsafe(`DELETE FROM ${table} WHERE id = $1`, [id]))
        .rejects.toThrow(/append-only/);
    }
    for (const role of ["authenticated", "anon"] as const) {
      const roleSql = postgres(url!, { max: 1 });
      try {
        await roleSql.unsafe(`SET ROLE ${role}`);
        for (const [table] of targets) {
          await expect(roleSql.unsafe(`SELECT * FROM ${table} LIMIT 1`)).rejects.toThrow();
          await expect(roleSql.unsafe(`DELETE FROM ${table} WHERE false`)).rejects.toThrow();
        }
      } finally {
        try { await roleSql.unsafe("RESET ROLE"); } catch {}
        await roleSql.end({ timeout: 5 });
      }
    }
  });
});
