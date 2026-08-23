import { createHash, randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/canonical-observation-v1";
import {
  persistCanonicalAvailableGatewayV1Postgres,
  persistCanonicalMeasurementDefinitionV1Postgres,
  persistCanonicalMeasurementValueLineageV1Postgres,
} from "@/lib/trader/mi/canonical-pit-repository-postgres";
import {
  defineCanonicalMeasurementV1,
  identifyCanonicalMeasurementValueV1,
} from "@/lib/trader/mi/measurement-lineage-v1";
import { resolveAndPersistTrustAsOfV1Postgres } from "@/lib/trader/mi/trust-as-of-repository-postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000068201";
const USER_B = "00000000-0000-4000-8000-000000068202";
const SOURCE_A = "00000000-0000-4000-8000-000000068211";
const SOURCE_B = "00000000-0000-4000-8000-000000068212";
const ANCHOR = new Date("2026-08-23T10:00:00.000Z");

const hex64 = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const canonicalTables = [
  "trader_mi_canonical_measurement_value_input_v1",
  "trader_mi_canonical_measurement_value_v1",
  "trader_mi_canonical_measurement_definition_v1",
  "trader_mi_gateway_pit_receipt_v1",
] as const;

async function clearOrg(sqlClient: postgres.Sql, organizationId: string): Promise<void> {
  for (const table of canonicalTables) {
    await sqlClient.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
  }
  await sqlClient.unsafe(
    "ALTER TABLE trader_mi_observation DISABLE TRIGGER trader_mi_observation_block_delete",
  );
  await sqlClient.unsafe(
    "ALTER TABLE trader_mi_trust_as_of_receipt_v1 DISABLE TRIGGER trader_mi_trust_as_of_receipt_v1_block_delete",
  );
  await sqlClient.unsafe(
    "ALTER TABLE trader_mi_source_trust DISABLE TRIGGER trader_mi_source_trust_block_delete",
  );
  try {
    for (const table of canonicalTables) {
      await sqlClient.unsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, [organizationId]);
    }
    await sqlClient.unsafe("DELETE FROM trader_mi_observation WHERE organization_id = $1::uuid", [
      organizationId,
    ]);
    await sqlClient.unsafe(
      "DELETE FROM trader_mi_trust_as_of_receipt_v1 WHERE organization_id = $1::uuid",
      [organizationId],
    );
    await sqlClient.unsafe("DELETE FROM trader_mi_source_trust WHERE organization_id = $1::uuid", [
      organizationId,
    ]);
    await sqlClient.unsafe("DELETE FROM trader_mi_source WHERE organization_id = $1::uuid", [
      organizationId,
    ]);
  } finally {
    await sqlClient.unsafe(
      "ALTER TABLE trader_mi_source_trust ENABLE TRIGGER trader_mi_source_trust_block_delete",
    );
    await sqlClient.unsafe(
      "ALTER TABLE trader_mi_trust_as_of_receipt_v1 ENABLE TRIGGER trader_mi_trust_as_of_receipt_v1_block_delete",
    );
    await sqlClient.unsafe(
      "ALTER TABLE trader_mi_observation ENABLE TRIGGER trader_mi_observation_block_delete",
    );
    for (const table of [...canonicalTables].reverse()) {
      await sqlClient.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
    }
  }
}

async function resetUser(userId: string): Promise<void> {
  const sqlClient = postgres(url!, { max: 1 });
  try {
    await clearOrg(sqlClient, personalOrganizationIdFromUserId(userId));
  } catch {
    // The first fresh bootstrap has not installed 0161 yet.
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
  await cleanupWp13Org(url!, userId);
}

async function seedSourceAndTrust(
  sqlClient: postgres.Sql,
  organizationId: string,
  sourceId: string,
  venue: string,
): Promise<string> {
  await sqlClient`
    INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, symbol, status)
    VALUES (${sourceId}::uuid, ${organizationId}::uuid, ${venue}, 'quote_l1', 'BTC/USDT', 'active')
  `;
  const trustId = randomUUID();
  await sqlClient`
    INSERT INTO trader_mi_source_trust (
      id, organization_id, source_id, trust_score, rationale, recorded_by,
      event_time, available_at, ingest_time, revision_of, revision_seq, content_digest
    ) VALUES (
      ${trustId}::uuid, ${organizationId}::uuid, ${sourceId}::uuid, '0.70000000',
      'test-only exact PIT trust', 'postgres-integration',
      '2026-08-23T09:00:00Z', '2026-08-23T09:05:00Z', '2026-08-23T09:06:00Z',
      NULL, 1, ${hex64(`${organizationId}:${sourceId}:trust-1`)}
    )
  `;
  return trustId;
}

describe.skipIf(!enabled || !url)("PostgreSQL canonical PIT lineage V1 (DEE-682)", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    await resetUser(USER_A);
    await resetUser(USER_B);
    orgA = await seedWp13User(url!, USER_A, "DEE-682 Canonical PIT Org A");
    orgB = await seedWp13User(url!, USER_B, "DEE-682 Canonical PIT Org B");
    sqlClient = postgres(url!, { max: 3 });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
  }, 120_000);

  beforeEach(async () => {
    await clearOrg(sqlClient, orgA);
    await clearOrg(sqlClient, orgB);
    await seedSourceAndTrust(sqlClient, orgA, SOURCE_A, "htx");
    await seedSourceAndTrust(sqlClient, orgB, SOURCE_B, "htx");
  });

  afterAll(async () => {
    if (sqlClient) {
      await clearOrg(sqlClient, orgA);
      await clearOrg(sqlClient, orgB);
      await sqlClient.end({ timeout: 10 });
    }
    await cleanupWp13Org(url!, USER_A);
    await cleanupWp13Org(url!, USER_B);
  });

  it("persists exact trust/PIT Observation and inert Measurement lineage idempotently", async () => {
    const trust = await resolveAndPersistTrustAsOfV1Postgres(db, { organizationId: orgA }, {
      sourceId: SOURCE_A,
      anchorTime: ANCHOR,
    });
    expect(trust.receipt).toMatchObject({ status: "RESOLVED", selectedRevisionSeq: 1 });

    const observationInput = {
      sourceId: SOURCE_A,
      observationKind: "quote_l1" as const,
      subjectRef: "BTC/USDT",
      payloadCanonical: { bid: "100", ask: "101", last: "100.5" },
      eventTime: new Date("2026-08-23T09:59:59.000Z"),
      availableAt: ANCHOR,
      ingestTime: ANCHOR,
      canonicalProviderId: "htx_spot",
      trustAsOfReceiptId: trust.receipt.id,
      normalizedInputDigest: hex64("org-a-quote-input"),
    };
    const stored = await persistCanonicalAvailableGatewayV1Postgres(
      db,
      { organizationId: orgA },
      observationInput,
    );
    const replay = await persistCanonicalAvailableGatewayV1Postgres(
      db,
      { organizationId: orgA },
      observationInput,
    );
    expect(stored).toMatchObject({
      observationInsertedNew: true,
      receiptInsertedNew: true,
      receipt: { status: "AVAILABLE" },
    });
    expect(replay).toMatchObject({ observationInsertedNew: false, receiptInsertedNew: false });
    expect(replay.observation).toEqual(stored.observation);
    expect(replay.receipt).toEqual(stored.receipt);

    const definition = defineCanonicalMeasurementV1({
      organizationId: orgA,
      category: "feature_transform",
      name: "opaque quote identity",
      inputContracts: [
        {
          observationKind: "quote_l1",
          observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
        },
      ],
      outputSchemaVersion: "opaque-output-v1",
    });
    await persistCanonicalMeasurementDefinitionV1Postgres(db, { organizationId: orgA }, definition);
    const value = identifyCanonicalMeasurementValueV1({
      organizationId: orgA,
      definition,
      outputContentDigest: hex64("opaque-output"),
      inputs: [
        {
          observationId: stored.observation.id,
          observationKind: stored.observation.observationKind,
          observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
          observationContentDigest: stored.observation.contentDigest,
          sourceId: stored.observation.sourceId,
          trustAsOfReceiptId: stored.observation.trustAsOfReceiptId,
          trustRevisionId: stored.observation.sourceTrustRevisionId,
          trustRevisionContentDigest: stored.observation.sourceTrustContentDigest,
        },
      ],
    });
    const valueStored = await persistCanonicalMeasurementValueLineageV1Postgres(
      db,
      { organizationId: orgA },
      value,
    );
    const valueReplay = await persistCanonicalMeasurementValueLineageV1Postgres(
      db,
      { organizationId: orgA },
      value,
    );
    expect(valueStored).toEqual({ value, insertedNew: true });
    expect(valueReplay).toEqual({ value, insertedNew: false });
  });

  it("rejects cross-tenant lineage and append-only mutation", async () => {
    const trust = await resolveAndPersistTrustAsOfV1Postgres(db, { organizationId: orgA }, {
      sourceId: SOURCE_A,
      anchorTime: ANCHOR,
    });
    await expect(
      persistCanonicalAvailableGatewayV1Postgres(db, { organizationId: orgB }, {
        sourceId: SOURCE_A,
        observationKind: "quote_l1",
        subjectRef: "BTC/USDT",
        payloadCanonical: { bid: "100", ask: "101", last: "100.5" },
        eventTime: new Date("2026-08-23T09:59:59.000Z"),
        availableAt: ANCHOR,
        ingestTime: ANCHOR,
        canonicalProviderId: "htx_spot",
        trustAsOfReceiptId: trust.receipt.id,
        normalizedInputDigest: hex64("cross-tenant"),
      }),
    ).rejects.toThrow();

    const stored = await persistCanonicalAvailableGatewayV1Postgres(db, { organizationId: orgA }, {
      sourceId: SOURCE_A,
      observationKind: "quote_l1",
      subjectRef: "BTC/USDT",
      payloadCanonical: { bid: "100", ask: "101", last: "100.5" },
      eventTime: new Date("2026-08-23T09:59:59.000Z"),
      availableAt: ANCHOR,
      ingestTime: ANCHOR,
      canonicalProviderId: "htx_spot",
      trustAsOfReceiptId: trust.receipt.id,
      normalizedInputDigest: hex64("append-only"),
    });
    await expect(sqlClient`
      UPDATE trader_mi_gateway_pit_receipt_v1 SET reason = 'FORGED'
      WHERE id = ${stored.receipt.id}
    `).rejects.toThrow(/append-only/);
    await expect(sqlClient`
      DELETE FROM trader_mi_observation WHERE id = ${stored.observation.id}::uuid
    `).rejects.toThrow(/append-only/);
  });

  it("denies authenticated and anon real-role CRUD on every new relation", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      await sqlClient.unsafe(`SET ROLE ${role}`);
      try {
        for (const table of canonicalTables) {
          await expect(
            sqlClient.unsafe(`SELECT * FROM ${table} LIMIT 1`),
          ).rejects.toThrow(/permission denied/);
          await expect(
            sqlClient.unsafe(
              `INSERT INTO ${table} (organization_id) VALUES ('00000000-0000-4000-8000-000000000000')`,
            ),
          ).rejects.toThrow(/permission denied/);
          await expect(
            sqlClient.unsafe(
              `UPDATE ${table} SET organization_id = organization_id WHERE false`,
            ),
          ).rejects.toThrow(/permission denied/);
          await expect(
            sqlClient.unsafe(`DELETE FROM ${table} WHERE false`),
          ).rejects.toThrow(/permission denied/);
        }
      } finally {
        await sqlClient.unsafe("RESET ROLE");
      }
    }
  });
});
