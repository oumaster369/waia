import { createHash } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import {
  findInformationSufficiencyReceiptV2Postgres,
  findRequiredInformationProfileV2Postgres,
  listInformationSufficiencyReceiptsV2Postgres,
  listRequiredInformationProfilesV2Postgres,
  persistInformationSufficiencyReceiptV2Postgres,
  persistRequiredInformationProfileV2Postgres,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres";
import { MI_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/observation.types";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000068701";
const USER_B = "00000000-0000-4000-8000-000000068702";
const PIT = "2026-08-23T12:00:00.000Z";
const hex = (value: string) => createHash("sha256").update(value).digest("hex");

const tables = [
  "trader_information_sufficiency_receipt_v2",
  "trader_required_information_profile_v2",
] as const;

async function clearInformationSufficiency(
  sqlClient: postgres.Sql,
  organizationId: string,
): Promise<void> {
  for (const table of tables) {
    await sqlClient.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
  }
  try {
    for (const table of tables) {
      await sqlClient.unsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, [
        organizationId,
      ]);
    }
  } finally {
    for (const table of [...tables].reverse()) {
      await sqlClient.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
    }
  }
}

async function resetUser(userId: string): Promise<void> {
  const client = postgres(url!, { max: 1 });
  try {
    await clearInformationSufficiency(client, personalOrganizationIdFromUserId(userId));
  } catch {
    // A fresh bootstrap has no 0162 relations or fixture rows yet.
  } finally {
    await client.end({ timeout: 5 });
  }
  await cleanupWp13Org(url!, userId);
}

function buildProfile(organizationId: string, minimumTrustScore = 0.5) {
  return defineRequiredInformationProfileV2({
    organizationId,
    accountId: "paper-account",
    profileVersion: "isg-pg-test-v1",
    purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    forecastPackageId: null,
    forecastPackageContentDigest: null,
    inputContractContentDigest: null,
    requirements: [
      {
        id: "required-price",
        questionId: "Q_WHAT_HAPPENING",
        classification: "MANDATORY",
        contextTriggerKey: null,
        satisfiers: [{ evidenceFamily: "price", providerIds: [], substitutionRuleId: null }],
        allowedObservationKinds: ["msv_envelope"],
        allowedObservationSchemaVersions: [MI_OBSERVATION_SCHEMA_VERSION],
        allowedMeasurementDefinitionDigests: [],
        maxStalenessMs: 60_000,
        minimumTrustScore,
        minimumIndependentGroups: 1,
        contradictionPolicy: "FAIL_UNRESOLVED",
        requirePitQualified: true,
        requireReplayEligible: true,
        inquiryBounds: { maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 1 },
      },
    ],
    aggregateQualityContract: null,
  });
}

function reidentify<T extends { id: string; contentDigest: string }>(value: T): T {
  const body = { ...value } as Record<string, unknown>;
  delete body.id;
  delete body.contentDigest;
  const contentDigest = hex(canonicalJsonString(body));
  return { ...body, id: contentDigest, contentDigest } as T;
}

function buildReceipt(profile: ReturnType<typeof buildProfile>) {
  return evaluateInformationSufficiencyV2({
    profile,
    organizationId: profile.organizationId,
    accountId: profile.accountId,
    purpose: profile.purpose,
    symbol: profile.symbol,
    venue: profile.venue,
    analyticalTimeframe: profile.analyticalTimeframe,
    horizon: profile.horizon,
    pitAnchor: PIT,
    activeContextTriggers: [],
    evidence: [
      {
        evidenceId: "msv-price-1",
        evidenceFamily: "price",
        providerId: "internal-msv",
        sourceId: "00000000-0000-4000-8000-000000068711",
        observationId: "00000000-0000-4000-8000-000000068712",
        observationKind: "msv_envelope",
        observationSchemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
        observationContentDigest: hex("msv-price-observation"),
        trustAsOfReceiptId: null,
        trustRevisionId: null,
        trustRevisionContentDigest: null,
        measurementDefinitionId: null,
        measurementDefinitionContentDigest: null,
        measurementValueId: null,
        measurementValueContentDigest: null,
        availability: "AVAILABLE",
        availableAt: "2026-08-23T11:59:30.000Z",
        trust: "TRUSTED",
        trustScore: 0.9,
        pitQualified: true,
        replayEligible: true,
        dependenceGroup: "internal-msv-price",
        contradictionGroup: null,
        contradiction: "NONE",
        epistemicRole: "PRICE_STATE",
        historyScope: "NOT_HISTORICAL",
        degradationReasonCodes: [],
      },
    ],
  });
}

describe.skipIf(!enabled || !url)("PostgreSQL Information Sufficiency V2 (DEE-687)", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    await resetUser(USER_A);
    await resetUser(USER_B);
    orgA = await seedWp13User(url!, USER_A, "DEE-687 ISG Org A");
    orgB = await seedWp13User(url!, USER_B, "DEE-687 ISG Org B");
    sqlClient = postgres(url!, { max: 3 });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
  }, 120_000);

  beforeEach(async () => {
    await clearInformationSufficiency(sqlClient, orgA);
    await clearInformationSufficiency(sqlClient, orgB);
  });

  afterAll(async () => {
    if (sqlClient) {
      await clearInformationSufficiency(sqlClient, orgA);
      await clearInformationSufficiency(sqlClient, orgB);
      await sqlClient.end({ timeout: 10 });
    }
    await cleanupWp13Org(url!, USER_A);
    await cleanupWp13Org(url!, USER_B);
  });

  it("persists exact profiles and receipts idempotently with tenant-scoped reads", async () => {
    const profile = buildProfile(orgA);
    const firstProfile = await persistRequiredInformationProfileV2Postgres(
      db,
      { organizationId: orgA },
      profile,
    );
    const replayedProfile = await persistRequiredInformationProfileV2Postgres(
      db,
      { organizationId: orgA },
      profile,
    );
    expect(firstProfile).toEqual({ profile, insertedNew: true });
    expect(replayedProfile).toEqual({ profile, insertedNew: false });

    const receipt = buildReceipt(profile);
    const firstReceipt = await persistInformationSufficiencyReceiptV2Postgres(
      db,
      { organizationId: orgA },
      receipt,
    );
    const replayedReceipt = await persistInformationSufficiencyReceiptV2Postgres(
      db,
      { organizationId: orgA },
      receipt,
    );
    expect(firstReceipt).toEqual({ receipt, insertedNew: true });
    expect(replayedReceipt).toEqual({ receipt, insertedNew: false });
    expect(
      await findRequiredInformationProfileV2Postgres(db, { organizationId: orgA }, profile.id),
    ).toEqual(profile);
    expect(
      await findInformationSufficiencyReceiptV2Postgres(db, { organizationId: orgA }, receipt.id),
    ).toEqual(receipt);
    expect(
      await listRequiredInformationProfilesV2Postgres(
        db,
        { organizationId: orgA },
        "paper-account",
      ),
    ).toEqual([profile]);
    expect(
      await listInformationSufficiencyReceiptsV2Postgres(db, { organizationId: orgA }, profile.id),
    ).toEqual([receipt]);
    expect(
      await findRequiredInformationProfileV2Postgres(db, { organizationId: orgB }, profile.id),
    ).toBeNull();
    expect(
      await findInformationSufficiencyReceiptV2Postgres(db, { organizationId: orgB }, receipt.id),
    ).toBeNull();

    const smallTrustProfile = buildProfile(orgA, 1e-7);
    const smallTrustReceipt = buildReceipt(smallTrustProfile);
    await expect(
      persistRequiredInformationProfileV2Postgres(db, { organizationId: orgA }, smallTrustProfile),
    ).resolves.toMatchObject({ insertedNew: true });
    await expect(
      persistInformationSufficiencyReceiptV2Postgres(
        db,
        { organizationId: orgA },
        smallTrustReceipt,
      ),
    ).resolves.toMatchObject({ insertedNew: true });
  });

  it("rejects hash-correct direct SQL that diverges from the Wave A nested contract", async () => {
    const profile = buildProfile(orgA);
    await persistRequiredInformationProfileV2Postgres(db, { organizationId: orgA }, profile);
    const forgedProfile = reidentify({
      ...profile,
      profileVersion: "forged-profile-v1",
      requirements: [{ ...profile.requirements[0]!, formula: "BUY" }],
    });
    await expect(sqlClient`
      INSERT INTO trader_required_information_profile_v2 (
        id, organization_id, account_id, profile_version, purpose, symbol, venue,
        analytical_timeframe, horizon, profile_json, content_digest, schema_version, authority
      ) VALUES (
        ${forgedProfile.id}, ${orgA}::uuid, ${forgedProfile.accountId},
        ${forgedProfile.profileVersion}, ${forgedProfile.purpose}, ${forgedProfile.symbol},
        ${forgedProfile.venue}, ${forgedProfile.analyticalTimeframe}, ${forgedProfile.horizon},
        ${JSON.stringify(forgedProfile)}::jsonb, ${forgedProfile.contentDigest},
        ${forgedProfile.schemaVersion}, ${forgedProfile.authority}
      )
    `).rejects.toThrow(/nested contract mismatch/);

    const receipt = buildReceipt(profile);
    const wrongProfileLineage = reidentify({
      ...receipt,
      forecastPackageId: "forged-package",
      forecastPackageContentDigest: hex("forged-package"),
    });
    await expect(sqlClient`
      INSERT INTO trader_information_sufficiency_receipt_v2 (
        id, organization_id, account_id, profile_id, profile_content_digest, purpose,
        status, pit_anchor, receipt_json, content_digest, schema_version, authority
      ) VALUES (
        ${wrongProfileLineage.id}, ${orgA}::uuid, ${wrongProfileLineage.accountId},
        ${wrongProfileLineage.profileId}, ${wrongProfileLineage.profileContentDigest},
        ${wrongProfileLineage.purpose}, ${wrongProfileLineage.status},
        ${wrongProfileLineage.pitAnchor}::timestamptz,
        ${JSON.stringify(wrongProfileLineage)}::jsonb,
        ${wrongProfileLineage.contentDigest}, ${wrongProfileLineage.schemaVersion},
        ${wrongProfileLineage.authority}
      )
    `).rejects.toThrow(/row\/JSON\/profile mismatch/);

    const forbiddenHistory = reidentify({
      ...receipt,
      evidenceInventory: [{ ...receipt.evidenceInventory[0]!, historyScope: "BLIND_HOLDOUT" }],
    });
    await expect(sqlClient`
      INSERT INTO trader_information_sufficiency_receipt_v2 (
        id, organization_id, account_id, profile_id, profile_content_digest, purpose,
        status, pit_anchor, receipt_json, content_digest, schema_version, authority
      ) VALUES (
        ${forbiddenHistory.id}, ${orgA}::uuid, ${forbiddenHistory.accountId},
        ${forbiddenHistory.profileId}, ${forbiddenHistory.profileContentDigest},
        ${forbiddenHistory.purpose}, ${forbiddenHistory.status},
        ${forbiddenHistory.pitAnchor}::timestamptz,
        ${JSON.stringify(forbiddenHistory)}::jsonb,
        ${forbiddenHistory.contentDigest}, ${forbiddenHistory.schemaVersion},
        ${forbiddenHistory.authority}
      )
    `).rejects.toThrow(/nested contract mismatch/);
  });

  it("rejects forged content, cross-tenant persistence and mutation", async () => {
    const profile = buildProfile(orgA);
    await persistRequiredInformationProfileV2Postgres(db, { organizationId: orgA }, profile);
    const receipt = buildReceipt(profile);
    await persistInformationSufficiencyReceiptV2Postgres(db, { organizationId: orgA }, receipt);
    await expect(
      persistRequiredInformationProfileV2Postgres(db, { organizationId: orgB }, profile),
    ).rejects.toThrow("organizationMismatch");
    await expect(
      persistRequiredInformationProfileV2Postgres(
        db,
        { organizationId: orgA },
        {
          ...profile,
          symbol: "ETH/USDT",
        },
      ),
    ).rejects.toThrow("profileIdentity");
    await expect(sqlClient`
      UPDATE trader_required_information_profile_v2 SET symbol = 'ETH/USDT'
      WHERE id = ${profile.id}
    `).rejects.toThrow(/append-only/);
    await expect(sqlClient`
      DELETE FROM trader_required_information_profile_v2 WHERE id = ${profile.id}
    `).rejects.toThrow(/append-only/);
    await expect(sqlClient`
      UPDATE trader_information_sufficiency_receipt_v2 SET status = 'UNAVAILABLE'
      WHERE id = ${receipt.id}
    `).rejects.toThrow(/append-only/);
    await expect(sqlClient`
      DELETE FROM trader_information_sufficiency_receipt_v2 WHERE id = ${receipt.id}
    `).rejects.toThrow(/append-only/);
  });

  it("denies authenticated and anon real-role CRUD on both relations", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      for (const table of tables) {
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
