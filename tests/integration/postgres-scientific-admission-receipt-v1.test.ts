/**
 * DEE-518 IC4 — scientific admission receipt Postgres roundtrip (opt-in).
 */

import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { persistHtxVolumeQualificationReceipt } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";
import {
  buildKmConvergenceReceiptV1,
  type KmConfigurationMetrics,
  type KmConvergenceReceipt,
} from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import {
  buildEpistemicParameterRatificationReceiptV1,
  buildPredictiveTerminalReceiptV1,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import {
  buildScientificAdmissionReceiptRecordV2,
  persistScientificAdmissionReceiptV2,
  requireScientificAdmissionReceiptV2ForOrganization,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v2";
import {
  bucketIndexForReturn,
  computeTerminalTargetGridFromDevelopmentReturns,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import {
  assertScientificAdmissionDoesNotAuthorizeCapital,
  buildScientificAdmissionReceiptRecordV1,
  persistScientificAdmissionReceiptV1,
  readScientificAdmissionReceiptV1,
  ScientificAdmissionReceiptConflictError,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const WP518_ADMISSION_PG_USER = "00000000-0000-4000-8000-000000051804";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

function hex64(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

function qualifiedHtxVolumeReceipt() {
  const rows: HtxKlineRow[] = [
    { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 10, vol: 1000, count: 1 },
    { id: 2, open: 50, high: 51, low: 49, close: 50, amount: 10, vol: 500, count: 1 },
  ];
  return qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT", rows });
}

function blockedHtxVolumeReceipt() {
  // amount === vol for every sample -> ambiguous quote/base authority -> BLOCKED.
  const rows: HtxKlineRow[] = [
    { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 10, vol: 10, count: 1 },
  ];
  return qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT", rows });
}

function qualifiedKmConvergenceReceipt(seed: string): KmConvergenceReceipt {
  const configurations: KmConfigurationMetrics[] = [
    {
      kConfig: 10,
      mConfig: 20,
      evLowerRelativeErrorP95: 0.001,
      evBaseRelativeErrorP95: 0.001,
      evUpperRelativeErrorP95: 0.001,
      mcEsRelativeErrorP95: 0.001,
      qualifies: true,
    },
  ];
  return buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: hex64(`${seed}-family`),
    kmGlobalAnchorSetDigestHex: hex64(`${seed}-global-anchor`),
    candidateGenerationDigestsHex: [hex64(`${seed}-candidate`)],
    configurations,
    selectedPackageGenerationIdentityDigestHex: hex64(`${seed}-selected-gen`),
    selectedPackageContentDigestHex: hex64(`${seed}-selected-content`),
  });
}

function qualifiedV2Fixture(organizationId: string, seed: string) {
  const developmentReturns = Array.from(
    { length: 400 },
    (_, index) => Math.sin(index / 17) * 0.02 + (index % 9) * 0.0005,
  );
  const historyReturns = Array.from(
    { length: 2500 },
    (_, index) => developmentReturns[index % developmentReturns.length]!,
  );
  const grid = computeTerminalTargetGridFromDevelopmentReturns(developmentReturns);
  const identities = {
    developmentDatasetDigestHex: hex64(`${seed}-development`),
    targetGridReceiptDigestHex: hex64(`${seed}-grid`),
    predictivePackageGenerationIdentityDigestHex: hex64(`${seed}-selected-gen`),
    predictivePackageContentDigestHex: hex64(`${seed}-selected-content`),
    runtimeContractDigestHex: hex64(`${seed}-runtime`),
    scoringContractVersion: "multiclass-log-score/v1" as const,
    evaluationPartitionReceiptDigestHex: hex64(`${seed}-partition`),
  };
  const predictive = buildPredictiveTerminalReceiptV1({
    identities,
    harnessInput: {
      venue: "htx",
      market: "spot",
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      challengerPackageContentDigestHex: identities.predictivePackageContentDigestHex,
      comparisonFamilyId: "mandatory-baseline-family/v1",
      evaluationPartitionReceiptDigestHex: identities.evaluationPartitionReceiptDigestHex,
      purgeDurationMinutes: 30,
      embargoDurationMinutes: 30,
      developmentReturns,
      historyReturns,
      historyReturnMinuteOpenTimesMs: historyReturns.map(
        (_, index) => 1_700_000_000_000 + index * 60_000,
      ),
      anchors: developmentReturns.slice(0, 24).map((observedReturn, index) => {
        const bucket = bucketIndexForReturn(observedReturn, grid);
        return {
          anchorId: `anchor-${index}`,
          observedReturn,
          challengerProbabilities: Array.from({ length: 7 }, (_, bucketIndex) =>
            bucketIndex === bucket ? 0.999 : 0.001 / 6,
          ),
        };
      }),
    },
  });
  const km = qualifiedKmConvergenceReceipt(seed);
  const ratification = buildEpistemicParameterRatificationReceiptV1({
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    selectedK: km.selectedK!,
    selectedM: km.selectedM!,
    alphaEpiConfigScale8: km.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigestHex: identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex,
    humanReceiptIdentityDigestHex: hex64(`${seed}-human`),
  });
  const expected = {
    organizationId,
    ...identities,
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex: ratification.contentDigestHex,
    predictiveTerminalReceiptContentDigestHex: predictive.contentDigestHex,
  };
  return { predictive, km, ratification, expected };
}

async function cleanupScientificAdmissionReceipt(
  sql: postgres.Sql,
  organizationId: string,
): Promise<void> {
  for (const table of [
    "trader_scientific_admission_receipt_v1",
    "trader_htx_volume_qualification_receipt_v1",
  ] as const) {
    await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
    await sql.unsafe(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId]);
    await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
  }
}

async function persistQualifiedVolumeForOrg(
  sql: postgres.Sql,
  organizationId: string,
  receipt = qualifiedHtxVolumeReceipt(),
): Promise<typeof receipt> {
  await persistHtxVolumeQualificationReceipt(sql, {
    organizationId,
    receipt,
  });
  return receipt;
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres scientific admission receipt v1 persistence (DEE-518 IC4)",
  () => {
    let orgId: string;
    let sql: postgres.Sql;

    beforeAll(async () => {
      sql = postgres(url!, { max: 1 });
      // Org DELETE cascades into append-only volume receipts; disable delete trigger first.
      await sql.unsafe(
        `ALTER TABLE trader_htx_volume_qualification_receipt_v1 DISABLE TRIGGER trader_htx_volume_qualification_receipt_v1_block_delete`,
      );
      await sql.unsafe(
        `ALTER TABLE trader_scientific_admission_receipt_v1 DISABLE TRIGGER trader_scientific_admission_receipt_v1_block_delete`,
      );
      await cleanupWp13Org(url!, WP518_ADMISSION_PG_USER);
      await sql.unsafe(
        `ALTER TABLE trader_htx_volume_qualification_receipt_v1 ENABLE TRIGGER trader_htx_volume_qualification_receipt_v1_block_delete`,
      );
      await sql.unsafe(
        `ALTER TABLE trader_scientific_admission_receipt_v1 ENABLE TRIGGER trader_scientific_admission_receipt_v1_block_delete`,
      );
      orgId = await seedWp13User(url!, WP518_ADMISSION_PG_USER, "Scientific Admission Receipt");
    });

    beforeEach(async () => {
      await cleanupScientificAdmissionReceipt(sql, orgId);
    });

    afterAll(async () => {
      if (sql && orgId) {
        await cleanupScientificAdmissionReceipt(sql, orgId);
        await sql.unsafe(
          `ALTER TABLE trader_htx_volume_qualification_receipt_v1 DISABLE TRIGGER trader_htx_volume_qualification_receipt_v1_block_delete`,
        );
        await sql.unsafe(
          `ALTER TABLE trader_scientific_admission_receipt_v1 DISABLE TRIGGER trader_scientific_admission_receipt_v1_block_delete`,
        );
        await sql.end({ timeout: 10 });
      }
      await cleanupWp13Org(url!, WP518_ADMISSION_PG_USER);
      const restore = postgres(url!, { max: 1 });
      try {
        await restore.unsafe(
          `ALTER TABLE trader_htx_volume_qualification_receipt_v1 ENABLE TRIGGER trader_htx_volume_qualification_receipt_v1_block_delete`,
        );
        await restore.unsafe(
          `ALTER TABLE trader_scientific_admission_receipt_v1 ENABLE TRIGGER trader_scientific_admission_receipt_v1_block_delete`,
        );
      } finally {
        await restore.end({ timeout: 5 });
      }
    });

    it("blocks build when HTX volume authority is not QUALIFIED", () => {
      expect(() =>
        buildScientificAdmissionReceiptRecordV1({
          organizationId: orgId,
          kmConvergenceReceipt: qualifiedKmConvergenceReceipt("blocked-case"),
          wfPartition: "WF_PREDICTIVE",
          htxVolumeQualificationReceipt: blockedHtxVolumeReceipt(),
        }),
      ).toThrow();
    });

    it("persists a QUALIFIED receipt and reads it back by evidence semantic digest", async () => {
      const volume = await persistQualifiedVolumeForOrg(sql, orgId);
      const record = buildScientificAdmissionReceiptRecordV1({
        organizationId: orgId,
        kmConvergenceReceipt: qualifiedKmConvergenceReceipt("persist-case"),
        wfPartition: "WF_PREDICTIVE",
        htxVolumeQualificationReceipt: volume,
      });

      const result = await persistScientificAdmissionReceiptV1(sql, record);
      expect(result.insertedNew).toBe(true);

      const loaded = await readScientificAdmissionReceiptV1(sql, {
        organizationId: orgId,
        evidenceSemanticDigestHex: record.evidenceSemanticDigest,
      });
      expect(loaded).not.toBeNull();
      expect(loaded?.contentDigest).toBe(record.contentDigest);
      expect(loaded?.selectedKConfigDec).toBe(10);
      expect(loaded?.selectedMConfigDec).toBe(20);

      expect(() =>
        assertScientificAdmissionDoesNotAuthorizeCapital({ schemaVersion: loaded!.schemaVersion }),
      ).not.toThrow();
    });

    it("is idempotent on exact-duplicate persistence", async () => {
      const volume = await persistQualifiedVolumeForOrg(sql, orgId);
      const record = buildScientificAdmissionReceiptRecordV1({
        organizationId: orgId,
        kmConvergenceReceipt: qualifiedKmConvergenceReceipt("idem-case"),
        wfPartition: "WF_PREDICTIVE",
        htxVolumeQualificationReceipt: volume,
      });

      const first = await persistScientificAdmissionReceiptV1(sql, record);
      const second = await persistScientificAdmissionReceiptV1(sql, record);
      expect(first.insertedNew).toBe(true);
      expect(second.insertedNew).toBe(false);
      expect(second.id).toBe(first.id);

      const count = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_scientific_admission_receipt_v1
        WHERE organization_id = ${orgId}::uuid
          AND evidence_semantic_digest = ${record.evidenceSemanticDigest}
      `;
      expect(Number(count[0]?.count ?? 0)).toBe(1);
    });

    it("fails closed on natural-idempotent conflict (same evidence digest, different content)", async () => {
      const volume = await persistQualifiedVolumeForOrg(sql, orgId);
      const kmConvergenceReceipt = qualifiedKmConvergenceReceipt("conflict-case");
      const record = buildScientificAdmissionReceiptRecordV1({
        organizationId: orgId,
        kmConvergenceReceipt,
        wfPartition: "WF_PREDICTIVE",
        htxVolumeQualificationReceipt: volume,
      });
      await persistScientificAdmissionReceiptV1(sql, record);

      const tamperedRecord = {
        ...record,
        id: randomUUID(),
        contentDigest: hex64("tampered-content"),
      };

      await expect(persistScientificAdmissionReceiptV1(sql, tamperedRecord)).rejects.toThrow(
        ScientificAdmissionReceiptConflictError,
      );
    });

    it("rejects hand-built admission without durable QUALIFIED volume receipt", async () => {
      const record = buildScientificAdmissionReceiptRecordV1({
        organizationId: orgId,
        kmConvergenceReceipt: qualifiedKmConvergenceReceipt("no-volume-durable"),
        wfPartition: "WF_PREDICTIVE",
        htxVolumeQualificationReceipt: qualifiedHtxVolumeReceipt(),
      });
      await expect(persistScientificAdmissionReceiptV1(sql, record)).rejects.toThrow(
        /HTX_VOLUME_AUTHORITY_MISSING|not found/,
      );
    });

    it("never authorizes capital or emits FROZEN_SELECTED_PACKAGE_READY", () => {
      const record = buildScientificAdmissionReceiptRecordV1({
        organizationId: orgId,
        kmConvergenceReceipt: qualifiedKmConvergenceReceipt("h3-case"),
        wfPartition: "WF_PREDICTIVE",
        htxVolumeQualificationReceipt: qualifiedHtxVolumeReceipt(),
      });

      expect(() =>
        assertScientificAdmissionDoesNotAuthorizeCapital({
          schemaVersion: record.schemaVersion,
          claimsCapitalAuthority: true,
        }),
      ).toThrow(/cannot claim capital authority/);
      expect(() =>
        assertScientificAdmissionDoesNotAuthorizeCapital({
          schemaVersion: record.schemaVersion,
          emitsFrozenSelectedPackageReady: true,
        }),
      ).toThrow(/FROZEN_SELECTED_PACKAGE_READY/);
    });

    it("roundtrips v2, converges concurrent duplicates, and rejects conflict/replay", async () => {
      const volume = await persistQualifiedVolumeForOrg(sql, orgId);
      const fixture = qualifiedV2Fixture(orgId, "v2-postgres");
      const record = buildScientificAdmissionReceiptRecordV2({
        organizationId: orgId,
        predictiveTerminalReceipt: fixture.predictive,
        kmConvergenceReceipt: fixture.km,
        epistemicParameterRatificationReceipt: fixture.ratification,
        htxVolumeQualificationReceipt: volume,
      });
      const writes = await Promise.all(
        Array.from({ length: 4 }, () =>
          persistScientificAdmissionReceiptV2(sql, { ...record, id: randomUUID() }),
        ),
      );
      expect(writes.filter((result) => result.insertedNew)).toHaveLength(1);
      expect(new Set(writes.map((result) => result.id)).size).toBe(1);
      await expect(
        persistScientificAdmissionReceiptV2(sql, {
          ...record,
          id: randomUUID(),
          contentDigest: hex64("v2-conflict"),
        }),
      ).rejects.toThrow("SCIENTIFIC_ADMISSION_V2_RECORD_CONTENT_MISMATCH");
      await expect(
        requireScientificAdmissionReceiptV2ForOrganization(sql, {
          ...fixture.expected,
          runtimeContractDigestHex: hex64("stale-runtime"),
        }),
      ).rejects.toThrow("SCIENTIFIC_ADMISSION_V2_STALE_OR_REPLAYED_BINDING");
      await expect(
        requireScientificAdmissionReceiptV2ForOrganization(sql, fixture.expected),
      ).resolves.toMatchObject({ terminalStatus: "ADMITTED", organizationId: orgId });
    }, 180_000);
  },
);
