// Actual PostgreSQL proof that a validation receipt cannot be cited by another organization.
import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  attestRawSecretScanV1,
  buildRawStorageBindingAtDurableBoundaryV1,
  defineRawCapturePolicyV1,
  prepareRawCaptureV1,
} from "@/lib/trader/mi/raw-capture-v1";
import {
  persistPreparedRawCaptureV1Postgres,
  recordRawValidationV1Postgres,
} from "@/lib/trader/mi/raw-capture-repository-postgres";
import {
  createRiskAccountProfileV1,
  RISK_ACCOUNT_CHANNELS_V1,
  RISK_REFERENCE_METHOD_V1,
  riskAccountDigestV1,
  sealRiskAccountRecordV1,
} from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000113601";
const USER_B = "00000000-0000-4000-8000-000000113602";
const SOURCE_A = "00000000-0000-4000-8000-000000113611";
const SOURCE_B = "00000000-0000-4000-8000-000000113612";
const BODY = new TextEncoder().encode('{"test":"validation-org-fk"}');
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = value as { code?: string; cause?: unknown };
  return error.code ?? errorCode(error.cause);
}

describe.skipIf(!enabled || !url)(
  "validation receipt organization foreign key (DEE-1136 review)",
  () => {
    const clients: postgres.Sql[] = [];

    afterAll(async () => {
      await Promise.all(clients.splice(0).map((sql) => sql.end({ timeout: 5 })));
      if (url) {
        await cleanupWp13Org(url, USER_A);
        await cleanupWp13Org(url, USER_B);
      }
    });

    it("rejects a reference member that cites another organization's validation receipt", async () => {
      const sql = postgres(url!, { max: 1 });
      clients.push(sql);
      const db = drizzle(sql, { schema }) as WaiaPostgresDb;
      const orgA = await seedWp13User(url!, USER_A, "DEE-1136 validation org A");
      const orgB = await seedWp13User(url!, USER_B, "DEE-1136 validation org B");
      const auditId = randomUUID();
      const accountId = "validation-org-fk";
      await sql`INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, status)
      VALUES (${SOURCE_A}::uuid, ${orgA}::uuid, 'validation-org-a', 'raw-foundation', 'active'),
             (${SOURCE_B}::uuid, ${orgB}::uuid, 'validation-org-b', 'raw-foundation', 'active')`;
      await sql`INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type)
      VALUES (${auditId}::uuid, 'service', ${USER_A}, 'validation-org-fk-fixture', 'risk-reference-member')`;
      const capture = async (organizationId: string, sourceId: string) => {
        const prepared = prepareRawCaptureV1({
          organizationId,
          sourceId,
          bodyBytes: BODY,
          policy: defineRawCapturePolicyV1({ maxPayloadBytes: 1024, retentionSeconds: 3600 }),
          secretScanReceipt: attestRawSecretScanV1({
            status: "PASS",
            bodyBytes: BODY,
            scannerId: "validation-org-fk",
            scannerVersion: "test-v1",
            completedAt: new Date(Date.now() - 10_000),
          }),
        });
        const storageBinding = buildRawStorageBindingAtDurableBoundaryV1({
          organizationId,
          sourceId,
          rawBytesDigest: prepared.rawBytesDigest,
          objectReference: {
            storageBackendId: "test-private-object-store",
            objectKey: `validation-org-${organizationId}`,
            objectVersion: "test-version-1",
            encryptionRequirement: "PRIVATE_ENCRYPTED",
            accessRequirement: "SERVER_ONLY",
          },
          storedAt: new Date(Date.now() - 5_000),
        });
        const stored = await persistPreparedRawCaptureV1Postgres(
          db,
          { organizationId },
          { prepared, storageBinding },
        );
        const validation = await recordRawValidationV1Postgres(
          db,
          { organizationId },
          {
            captureReceiptDigest: stored.receipt.contentDigest,
            validatorId: "validation-org-fk",
            validatorVersion: "v1",
            outcome: { status: "VALID", reasonCodes: [] },
          },
        );
        return {
          captureDigest: stored.receipt.id,
          validationDigest: validation.receipt.id,
          sourceId,
        };
      };
      const own = await capture(orgA, SOURCE_A);
      const foreign = await capture(orgB, SOURCE_B);
      const from = "2026-09-27T12:00:00.000Z",
        until = "2026-09-27T13:00:00.000Z";
      const evidence = {
        sourceId: SOURCE_A,
        captureReceiptDigest: own.captureDigest,
        storageBindingDigest: hash("storage"),
        validationReceiptDigest: own.validationDigest,
        rawBytesDigest: hash("raw"),
      };
      const profile = createRiskAccountProfileV1({
        organizationId: orgA,
        accountId,
        credentialId: USER_A,
        exchangeAccountId: "135",
        accountSourceId: SOURCE_A,
        venue: "HTX",
        market: "SPOT",
        referenceCurrency: "USDT",
        assets: ["BTC", "USDT"],
        instruments: [
          {
            instrumentIdentityDigestHex: hash("BTC/USDT"),
            symbol: "BTC/USDT",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            referenceSourceId: SOURCE_A,
          },
        ],
        strategyId: "validation-org-fk",
        strategyVersion: "v1",
        sourceContract: {
          evidence,
          statementDigest: hash("contract"),
          anchorMethod: "INDEPENDENT_SOURCE_ASSERTED_DATED_ACCOUNT",
          validFromUtc: from,
          validUntilUtc: until,
          maxSourceAgeMs: 60000,
          maxReportClockSkewMs: 0,
          coveredAssetSetDigest: riskAccountDigestV1(["BTC", "USDT"]),
        },
        mutationBounds: ["BTC", "USDT"].flatMap((asset) =>
          RISK_ACCOUNT_CHANNELS_V1.map((channel) => ({
            asset,
            channel,
            intervalStartUtc: from,
            intervalEndUtc: until,
            maximumPositiveQuantity: "1",
            maximumNegativeQuantity: "1",
            contractStatementDigest: hash("contract"),
          })),
        ),
        reference: {
          qualification: {
            evidence,
            methodVersion: RISK_REFERENCE_METHOD_V1,
            statementDigest: hash("method"),
            validFromUtc: from,
            validUntilUtc: until,
            reportTimeSemantics: "HTX_RESPONSE_GENERATION_WITH_QUALIFIED_SIDE_AGE_BOUND",
            venueDependence: "SINGLE_VENUE_HTX",
          },
          windowDurationMs: 1000,
          slotOffsetsMs: [0, 500],
          slotToleranceMs: 0,
          maxSideAgeMs: 10,
          validityMs: 30000,
        },
        allocation: {
          evidence,
          statementDigest: hash("allocation"),
          allocationId: "validation-org-fk",
          version: "v1",
          approvedNotional: "1",
          allowedSymbols: ["BTC/USDT"],
          validFromUtc: from,
          validUntilUtc: until,
        },
        governance: { coolingOffMs: 1, reviewReason: "Synthetic foreign-key fixture only" },
        work: {
          maxRawBytes: 4096,
          requestTimeoutMs: 1000,
          maxPages: 1,
          maxMembers: 2,
          maxLedgerEvents: 1,
          retentionSeconds: 3600,
        },
      });
      const { contentDigest: profileDigest, ...profileBody } = profile;
      await db.insert(schema.traderRiskAccountProfilesV1).values({
        organizationId: orgA,
        accountId,
        contentDigest: profileDigest,
        bodyText: canonicalJsonString(profileBody),
        actorId: USER_A,
        auditId,
      });
      const member = (slot: number, validationDigest: string) => {
        const sealed = sealRiskAccountRecordV1({
          schemaVersion: "risk-reference-member/v1" as const,
          organizationId: orgA,
          accountId,
          profileDigest,
          windowId: "validation-org-window",
          slot,
          instrumentIdentityDigestHex: hash("BTC/USDT"),
          symbol: "BTC/USDT",
          baseAsset: "BTC",
          quoteAsset: "USDT" as const,
          sourceId: SOURCE_A,
          sourceReportTimeUtc: from,
          availableAtUtc: from,
          captureReceiptDigest: own.captureDigest,
          storageBindingDigest: hash("storage"),
          validationReceiptDigest: validationDigest,
          rawBytesDigest: hash("raw"),
          rawMemberPath: "tick" as const,
          decoderVersion: "htx-merged-lossless-scale8/v1",
          normalizedInputDigest: hash(`normal-${slot}`),
          gatewayReceiptDigest: hash(`gateway-${slot}`),
          observationId: hash(`observation-${slot}`),
          observationContentDigest: hash(`content-${slot}`),
          trustAsOfReceiptId: hash(`trust-${slot}`),
          bid: "9",
          ask: "10",
          last: "11",
        });
        const { contentDigest, ...body } = sealed;
        return { contentDigest, bodyText: canonicalJsonString(body), validationDigest, slot };
      };
      const insertMember = (row: ReturnType<typeof member>) => sql`
      INSERT INTO trader_risk_account_reference_members_v1 (
        organization_id, account_id, content_digest, body_text, profile_digest, window_id, slot,
        instrument_digest, source_id, capture_digest, validation_digest, observation_id, gateway_digest
      ) VALUES (
        ${orgA}::uuid, ${accountId}, ${row.contentDigest}, ${row.bodyText},
        ${profileDigest}, 'validation-org-window', ${row.slot}, ${hash("BTC/USDT")}, ${SOURCE_A}::uuid,
        ${own.captureDigest}, ${row.validationDigest}, ${hash(`observation-${row.slot}`)}, ${hash(`gateway-${row.slot}`)}
      )`;
      try {
        const definition = await sql<{ definition: string }[]>`
        SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'public.trader_risk_account_reference_members_v1'::regclass AND contype = 'f'
          AND pg_get_constraintdef(oid) LIKE '%trader_mi_raw_validation_receipt_v1%'`;
        expect(definition).toHaveLength(1);
        expect(definition[0]!.definition).toContain("validation_digest");
        expect(definition[0]!.definition).toContain("organization_id");
        const unique = await sql<{ name: string }[]>`
        SELECT conname AS name FROM pg_constraint
        WHERE conrelid = 'public.trader_mi_raw_validation_receipt_v1'::regclass
          AND conname = 'tmrvr_v1_id_organization_uq'`;
        expect(unique).toHaveLength(1);
        await insertMember(member(0, own.validationDigest));
        const rejected = await insertMember(member(1, foreign.validationDigest)).then(
          () => null,
          (error) => error,
        );
        expect(errorCode(rejected)).toBe("23503");
      } finally {
        for (const table of [
          "trader_risk_account_reference_members_v1",
          "trader_risk_account_profiles_v1",
        ]) {
          await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER risk_current_account_no_mutation`);
        }
        for (const table of [
          "trader_mi_raw_validation_receipt_v1",
          "trader_mi_raw_capture_receipt_v1",
          "trader_mi_raw_storage_binding_v1",
        ])
          await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
        try {
          await sql`DELETE FROM trader_risk_account_reference_members_v1 WHERE organization_id = ${orgA}::uuid`;
          await sql`DELETE FROM trader_risk_account_profiles_v1 WHERE organization_id = ${orgA}::uuid`;
          await sql`DELETE FROM trader_mi_raw_validation_receipt_v1 WHERE organization_id IN (${orgA}::uuid, ${orgB}::uuid)`;
          await sql`DELETE FROM trader_mi_raw_capture_receipt_v1 WHERE organization_id IN (${orgA}::uuid, ${orgB}::uuid)`;
          await sql`DELETE FROM trader_mi_raw_storage_binding_v1 WHERE organization_id IN (${orgA}::uuid, ${orgB}::uuid)`;
          await sql`DELETE FROM trader_mi_source WHERE organization_id IN (${orgA}::uuid, ${orgB}::uuid)`;
        } finally {
          for (const table of [
            "trader_risk_account_reference_members_v1",
            "trader_risk_account_profiles_v1",
          ]) {
            await sql.unsafe(
              `ALTER TABLE ${table} ENABLE TRIGGER risk_current_account_no_mutation`,
            );
          }
          for (const table of [
            "trader_mi_raw_validation_receipt_v1",
            "trader_mi_raw_capture_receipt_v1",
            "trader_mi_raw_storage_binding_v1",
          ])
            await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
        }
      }
    }, 120_000);
  },
);
