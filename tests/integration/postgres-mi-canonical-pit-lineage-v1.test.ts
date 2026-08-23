import { createHash, randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/canonical-observation-v1";
import { processCanonicalPitObservationV1Postgres } from "@/lib/trader/mi/canonical-pit-service-postgres";
import {
  findObservationByIdPostgres,
  listObservationsPostgres,
} from "@/lib/trader/mi/observation-repository-postgres";
import {
  persistCanonicalAvailableGatewayV1Postgres,
  persistCanonicalMeasurementDefinitionV1Postgres,
  persistCanonicalMeasurementValueLineageV1Postgres,
} from "@/lib/trader/mi/canonical-pit-repository-postgres";
import {
  defineCanonicalMeasurementV1,
  identifyCanonicalMeasurementValueV1,
} from "@/lib/trader/mi/measurement-lineage-v1";
import { MI_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/observation.types";
import { resolveAndPersistTrustAsOfV1Postgres } from "@/lib/trader/mi/trust-as-of-repository-postgres";
import { OBSERVATION_SCHEMA_VERSION, type NormalizedObservation } from "@/lib/trader/market-data/observation-types";
import { persistCanonicalPitReplayBatchV1Postgres } from "@/lib/trader/market-data/replay/canonical-pit-replay";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000068201";
const USER_B = "00000000-0000-4000-8000-000000068202";
const SOURCE_A = "00000000-0000-4000-8000-000000068211";
const SOURCE_B = "00000000-0000-4000-8000-000000068212";
const SOURCE_A_OHLCV = "00000000-0000-4000-8000-000000068213";
const SOURCE_A_NEWS = "00000000-0000-4000-8000-000000068214";
const SOURCE_A_MSV = "00000000-0000-4000-8000-000000068215";
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
  feedKind = "quote_l1",
  symbol = "BTC/USDT",
): Promise<string> {
  await sqlClient`
    INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, symbol, status)
    VALUES (${sourceId}::uuid, ${organizationId}::uuid, ${venue}, ${feedKind}, ${symbol}, 'active')
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

    await expect(
      persistCanonicalMeasurementDefinitionV1Postgres(db, { organizationId: orgA }, {
        ...definition,
        name: "forged after identity",
      }),
    ).rejects.toThrow("CANONICAL_MEASUREMENT_INVALID:definitionIdentity");
    await expect(
      persistCanonicalMeasurementValueLineageV1Postgres(db, { organizationId: orgA }, {
        ...value,
        outputContentDigest: hex64("forged after identity"),
      }),
    ).rejects.toThrow("CANONICAL_MEASUREMENT_INVALID:valueIdentity");

    const forgedDefinitionId = hex64("direct-sql-forged-definition");
    const forgedDefinition = {
      ...definition,
      id: forgedDefinitionId,
      name: "direct SQL forged definition",
      contentDigest: forgedDefinitionId,
    };
    await expect(sqlClient`
      INSERT INTO trader_mi_canonical_measurement_definition_v1 (
        id, organization_id, category, name, input_contracts_json, output_schema_version,
        authority, definition_json, content_digest, schema_version
      ) VALUES (
        ${forgedDefinitionId}, ${orgA}::uuid, ${forgedDefinition.category},
        ${forgedDefinition.name}, ${JSON.stringify(forgedDefinition.inputContracts)}::jsonb,
        ${forgedDefinition.outputSchemaVersion}, ${forgedDefinition.authority},
        ${JSON.stringify(forgedDefinition)}::jsonb, ${forgedDefinitionId},
        ${forgedDefinition.schemaVersion}
      )
    `).rejects.toThrow(/MeasurementDefinition content digest mismatch/);

    const forbiddenDefinitionBody = {
      schemaVersion: definition.schemaVersion,
      organizationId: definition.organizationId,
      category: definition.category,
      name: "hash-correct forbidden nested contract",
      inputContracts: [
        {
          ...definition.inputContracts[0],
          formula: "forbidden",
        },
      ],
      outputSchemaVersion: definition.outputSchemaVersion,
      authority: definition.authority,
    };
    const forbiddenDefinitionId = computeStableJsonDigest(forbiddenDefinitionBody);
    const forbiddenDefinition = {
      ...forbiddenDefinitionBody,
      id: forbiddenDefinitionId,
      contentDigest: forbiddenDefinitionId,
    };
    await expect(sqlClient`
      INSERT INTO trader_mi_canonical_measurement_definition_v1 (
        id, organization_id, category, name, input_contracts_json, output_schema_version,
        authority, definition_json, content_digest, schema_version
      ) VALUES (
        ${forbiddenDefinition.id}, ${orgA}::uuid, ${forbiddenDefinition.category},
        ${forbiddenDefinition.name}, ${JSON.stringify(forbiddenDefinition.inputContracts)}::jsonb,
        ${forbiddenDefinition.outputSchemaVersion}, ${forbiddenDefinition.authority},
        ${JSON.stringify(forbiddenDefinition)}::jsonb, ${forbiddenDefinition.contentDigest},
        ${forbiddenDefinition.schemaVersion}
      )
    `).rejects.toThrow(/MeasurementDefinition input contract mismatch/);

    const forgedValueId = hex64("direct-sql-forged-value");
    await expect(sqlClient`
      INSERT INTO trader_mi_canonical_measurement_value_v1 (
        id, organization_id, definition_id, definition_content_digest,
        output_content_digest, input_count, input_lineage_json,
        authority, content_digest, schema_version
      ) VALUES (
        ${forgedValueId}, ${orgA}::uuid, ${definition.id}, ${definition.contentDigest},
        ${value.outputContentDigest}, ${value.inputs.length},
        ${JSON.stringify(value.inputs)}::jsonb, ${value.authority},
        ${forgedValueId}, ${value.schemaVersion}
      )
    `).rejects.toThrow(/MeasurementValue content digest mismatch/);

    const ohlcvOnlyDefinition = defineCanonicalMeasurementV1({
      organizationId: orgA,
      category: "feature_transform",
      name: "ohlcv-only declaration",
      inputContracts: [
        {
          observationKind: "ohlcv_bar",
          observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
        },
      ],
      outputSchemaVersion: "opaque-output-v1",
    });
    await persistCanonicalMeasurementDefinitionV1Postgres(
      db,
      { organizationId: orgA },
      ohlcvOnlyDefinition,
    );
    const undeclaredValueBody = {
      schemaVersion: value.schemaVersion,
      organizationId: orgA,
      definitionId: ohlcvOnlyDefinition.id,
      definitionContentDigest: ohlcvOnlyDefinition.contentDigest,
      outputContentDigest: value.outputContentDigest,
      inputs: value.inputs,
      authority: value.authority,
    };
    const undeclaredValueId = computeStableJsonDigest(undeclaredValueBody);
    const undeclaredInput = value.inputs[0]!;
    await expect(
      sqlClient.begin(async (connection) => {
        await connection`
          INSERT INTO trader_mi_canonical_measurement_value_v1 (
            id, organization_id, definition_id, definition_content_digest,
            output_content_digest, input_count, input_lineage_json,
            authority, content_digest, schema_version
          ) VALUES (
            ${undeclaredValueId}, ${orgA}::uuid, ${ohlcvOnlyDefinition.id},
            ${ohlcvOnlyDefinition.contentDigest}, ${value.outputContentDigest},
            ${value.inputs.length}, ${JSON.stringify(value.inputs)}::jsonb,
            ${value.authority}, ${undeclaredValueId}, ${value.schemaVersion}
          )
        `;
        await connection`
          INSERT INTO trader_mi_canonical_measurement_value_input_v1 (
            organization_id, measurement_value_id, input_ordinal,
            observation_id, observation_kind, observation_schema_version,
            observation_content_digest, source_id, trust_as_of_receipt_id,
            trust_revision_id, trust_revision_content_digest
          ) VALUES (
            ${orgA}::uuid, ${undeclaredValueId}, 0,
            ${undeclaredInput.observationId}::uuid, ${undeclaredInput.observationKind},
            ${undeclaredInput.observationSchemaVersion},
            ${undeclaredInput.observationContentDigest}, ${undeclaredInput.sourceId}::uuid,
            ${undeclaredInput.trustAsOfReceiptId}, ${undeclaredInput.trustRevisionId}::uuid,
            ${undeclaredInput.trustRevisionContentDigest}
          )
        `;
      }),
    ).rejects.toThrow(/MeasurementValue input lineage mismatch/);
  });

  it("persists inert Measurement lineage for the admitted internal MSV primitive", async () => {
    await sqlClient`
      INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, symbol, status)
      VALUES (${SOURCE_A_MSV}::uuid, ${orgA}::uuid, 'internal', 'msv_envelope', NULL, 'active')
    `;
    const observationId = randomUUID();
    const observationDigest = hex64("internal-msv-observation");
    await sqlClient`
      INSERT INTO trader_mi_observation (
        id, organization_id, source_id, observation_kind, observation_key, subject_ref,
        schema_version, payload_json, event_time, ingest_time, observed_by,
        revision_of, revision_seq, content_digest
      ) VALUES (
        ${observationId}::uuid, ${orgA}::uuid, ${SOURCE_A_MSV}::uuid, 'msv_envelope',
        'msv:BTC/USDT:2026-08-23T09:59:59.000Z', 'BTC/USDT',
        ${MI_OBSERVATION_SCHEMA_VERSION}, ${JSON.stringify({ schemaVersion: "msv-envelope-v1" })},
        '2026-08-23T09:59:59Z', '2026-08-23T10:00:00Z', 'canonical-msv-test',
        NULL, 1, ${observationDigest}
      )
    `;

    const definition = defineCanonicalMeasurementV1({
      organizationId: orgA,
      category: "feature_transform",
      name: "internal MSV lineage identity",
      inputContracts: [
        {
          observationKind: "msv_envelope",
          observationSchemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
        },
      ],
      outputSchemaVersion: "opaque-msv-output-v1",
    });
    await persistCanonicalMeasurementDefinitionV1Postgres(db, { organizationId: orgA }, definition);
    const value = identifyCanonicalMeasurementValueV1({
      organizationId: orgA,
      definition,
      outputContentDigest: hex64("opaque-msv-output"),
      inputs: [
        {
          observationId,
          observationKind: "msv_envelope",
          observationSchemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
          observationContentDigest: observationDigest,
          sourceId: SOURCE_A_MSV,
          trustAsOfReceiptId: null,
          trustRevisionId: null,
          trustRevisionContentDigest: null,
        },
      ],
    });

    await expect(
      persistCanonicalMeasurementValueLineageV1Postgres(db, { organizationId: orgA }, value),
    ).resolves.toEqual({ value, insertedNew: true });
    const inputs = await sqlClient<{
      observationSchemaVersion: string;
      trustAsOfReceiptId: string | null;
      trustRevisionId: string | null;
    }[]>`
      SELECT
        observation_schema_version AS "observationSchemaVersion",
        trust_as_of_receipt_id AS "trustAsOfReceiptId",
        trust_revision_id::text AS "trustRevisionId"
      FROM trader_mi_canonical_measurement_value_input_v1
      WHERE organization_id = ${orgA}::uuid AND measurement_value_id = ${value.id}
    `;
    expect(inputs).toEqual([
      {
        observationSchemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
        trustAsOfReceiptId: null,
        trustRevisionId: null,
      },
    ]);
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

  it("converges gateway and replay and persists every failure without fallback", async () => {
    const normalized: NormalizedObservation = {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      kind: "quote_l1",
      sessionPhase: "US",
      provenance: {
        providerId: "htx_spot",
        venue: "htx",
        feedKind: "quote_l1",
        symbol: "BTC/USDT",
        eventTimeUtc: "2026-08-23T09:59:59.000Z",
        ingestTimeUtc: ANCHOR.toISOString(),
      },
      health: "HEALTHY",
      freshnessMs: 1_000,
      latencyMs: 10,
      confidence: 0.9,
      payload: {
        bid: "100",
        ask: "101",
        last: "100.5",
        timestamp: "2026-08-23T09:59:59.000Z",
      },
    };
    const gateway = await processCanonicalPitObservationV1Postgres(
      db,
      { organizationId: orgA },
      normalized,
    );
    const [replay] = await persistCanonicalPitReplayBatchV1Postgres(
      db,
      { organizationId: orgA },
      { evaluatedAtUtc: ANCHOR.toISOString(), observations: [normalized] },
    );
    expect(gateway).toMatchObject({
      receipt: { status: "AVAILABLE" },
      observationInsertedNew: true,
      receiptInsertedNew: true,
    });
    expect(replay).toMatchObject({
      observationInsertedNew: false,
      receiptInsertedNew: false,
    });
    expect(replay?.observation).toEqual(gateway.observation);
    expect(replay?.receipt).toEqual(gateway.receipt);
    expect(await listObservationsPostgres(db, { organizationId: orgA })).toEqual([]);
    expect(
      await findObservationByIdPostgres(
        db,
        { organizationId: orgA },
        gateway.observation!.id,
      ),
    ).toBeNull();

    const stale = await processCanonicalPitObservationV1Postgres(
      db,
      { organizationId: orgA },
      { ...normalized, health: "STALE" },
    );
    expect(stale).toMatchObject({
      receipt: { status: "REJECTED", reason: "STALE_INPUT" },
      observation: null,
    });

    const trustUnknown = await processCanonicalPitObservationV1Postgres(
      db,
      { organizationId: orgA },
      {
        ...normalized,
        provenance: {
          ...normalized.provenance,
          eventTimeUtc: "2026-08-23T09:03:00.000Z",
          ingestTimeUtc: "2026-08-23T09:04:00.000Z",
        },
        payload: {
          ...normalized.payload,
          timestamp: "2026-08-23T09:03:00.000Z",
        },
      },
    );
    expect(trustUnknown).toMatchObject({
      receipt: { status: "REJECTED", reason: "TRUST_AS_OF_UNKNOWN" },
      observation: null,
    });

    const unavailableWithoutTrust = await processCanonicalPitObservationV1Postgres(
      db,
      { organizationId: orgA },
      {
        ...normalized,
        health: "UNAVAILABLE",
        provenance: {
          ...normalized.provenance,
          eventTimeUtc: "2026-08-23T09:03:00.000Z",
          ingestTimeUtc: "2026-08-23T09:04:00.000Z",
        },
      },
    );
    expect(unavailableWithoutTrust).toMatchObject({
      receipt: {
        status: "UNAVAILABLE",
        reason: "SOURCE_UNAVAILABLE",
        trustAsOfReceiptId: null,
      },
      observation: null,
    });
  });

  it("closes market and non-price Source to inert Measurement lineage across replay and tenant scope", async () => {
    await seedSourceAndTrust(sqlClient, orgA, SOURCE_A_OHLCV, "htx", "ohlcv_bar", "BTC/USDT");
    await seedSourceAndTrust(
      sqlClient,
      orgA,
      SOURCE_A_NEWS,
      "coindesk",
      "news_headline",
      "GLOBAL",
    );
    const market: NormalizedObservation = {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      kind: "ohlcv_bar",
      interval: "1m",
      sessionPhase: "US",
      provenance: {
        providerId: "htx_spot",
        venue: "htx",
        feedKind: "ohlcv_bar",
        symbol: "BTC/USDT",
        eventTimeUtc: "2026-08-23T09:59:59.000Z",
        ingestTimeUtc: ANCHOR.toISOString(),
      },
      health: "HEALTHY",
      freshnessMs: 1_000,
      latencyMs: 10,
      confidence: 0.9,
      payload: {
        barCount: 1,
        latestClose: "100.5",
        latestBarCloseTime: "2026-08-23T09:59:59.000Z",
      },
    };
    const news: NormalizedObservation = {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      kind: "news_headline",
      sessionPhase: "US",
      provenance: {
        providerId: "coindesk_rss",
        venue: "coindesk",
        feedKind: "news_headline",
        symbol: "GLOBAL",
        eventTimeUtc: "2026-08-23T09:59:58.000Z",
        ingestTimeUtc: ANCHOR.toISOString(),
      },
      health: "HEALTHY",
      freshnessMs: 2_000,
      latencyMs: 20,
      confidence: 0.8,
      payload: {
        headline: "Protocol activity update",
        url: "https://example.invalid/dee-684",
        source: "CoinDesk",
        publishedAt: "2026-08-23T09:59:58.000Z",
      },
    };

    const marketStored = await processCanonicalPitObservationV1Postgres(
      db,
      { organizationId: orgA },
      market,
    );
    const newsStored = await processCanonicalPitObservationV1Postgres(
      db,
      { organizationId: orgA },
      news,
    );
    const replayed = await persistCanonicalPitReplayBatchV1Postgres(
      db,
      { organizationId: orgA },
      { evaluatedAtUtc: ANCHOR.toISOString(), observations: [market, news] },
    );
    expect(replayed.map((entry) => entry.receipt.id)).toEqual([
      marketStored.receipt.id,
      newsStored.receipt.id,
    ]);
    expect(replayed.every((entry) => !entry.observationInsertedNew)).toBe(true);
    expect(marketStored.observation?.sourceId).toBe(SOURCE_A_OHLCV);
    expect(newsStored.observation?.sourceId).toBe(SOURCE_A_NEWS);

    const definition = defineCanonicalMeasurementV1({
      organizationId: orgA,
      category: "feature_transform",
      name: "market and news lineage identity",
      inputContracts: [
        {
          observationKind: "ohlcv_bar",
          observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
        },
        {
          observationKind: "news_headline",
          observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
        },
      ],
      outputSchemaVersion: "opaque-market-news-output-v1",
    });
    await persistCanonicalMeasurementDefinitionV1Postgres(db, { organizationId: orgA }, definition);
    const observations = [marketStored.observation, newsStored.observation];
    if (observations.some((observation) => !observation)) {
      throw new Error("DEE_684_EXPECTED_OBSERVATION");
    }
    const value = identifyCanonicalMeasurementValueV1({
      organizationId: orgA,
      definition,
      outputContentDigest: hex64("opaque-market-news-output"),
      inputs: observations.map((observation) => ({
        observationId: observation!.id,
        observationKind: observation!.observationKind,
        observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
        observationContentDigest: observation!.contentDigest,
        sourceId: observation!.sourceId,
        trustAsOfReceiptId: observation!.trustAsOfReceiptId,
        trustRevisionId: observation!.sourceTrustRevisionId,
        trustRevisionContentDigest: observation!.sourceTrustContentDigest,
      })),
    });
    expect(
      await persistCanonicalMeasurementValueLineageV1Postgres(
        db,
        { organizationId: orgA },
        value,
      ),
    ).toEqual({ value, insertedNew: true });

    const crossTenant = await processCanonicalPitObservationV1Postgres(
      db,
      { organizationId: orgB },
      news,
    );
    expect(crossTenant).toMatchObject({
      receipt: { status: "REJECTED", reason: "SOURCE_UNKNOWN" },
      observation: null,
    });
    const orgBObservations = await sqlClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM trader_mi_observation
      WHERE organization_id = ${orgB}::uuid
    `;
    expect(orgBObservations[0]?.count).toBe("0");
  });

  it("denies authenticated and anon real-role CRUD on every new relation", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      for (const table of canonicalTables) {
        for (const statement of [
          `SELECT * FROM ${table} LIMIT 1`,
          `INSERT INTO ${table} (organization_id) VALUES ('00000000-0000-4000-8000-000000000000')`,
          `UPDATE ${table} SET organization_id = organization_id WHERE false`,
          `DELETE FROM ${table} WHERE false`,
        ]) {
          await expect(
            sqlClient.begin(async (connection) => {
              await connection.unsafe(`SET LOCAL ROLE ${role}`);
              await connection.unsafe(statement);
            }),
          ).rejects.toThrow(/permission denied/);
        }
      }
    }
  });
});
