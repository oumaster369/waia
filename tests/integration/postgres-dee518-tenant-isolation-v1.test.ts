/**
 * DEE-518 — ADR-0007 tenant-isolation closure for R3–R6 / volume / decision-econ V2
 * organization-scoped persistence surfaces.
 *
 * Behavioral proof: ORG_A cannot read, mutate, conflict-resolve, or gain authority from
 * ORG_B records through the public/service APIs (not SQL-only uniqueness checks).
 *
 * Opt-in: WAIA_PG_INTEGRATION=1
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import {
  buildDecisionEconomicsV2Record,
  persistDecisionEconomicsV2,
  readDecisionEconomicsV2ByForecastId,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2-service";
import {
  buildKnowledgeCheckpointRecord,
  restoreKnowledgeCheckpointV2,
  writeKnowledgeCheckpointV2,
  readKnowledgeCheckpointV2,
} from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-service-v2";
import { HtxVolumeCapitalAuthorityError } from "@/lib/trader/market-data/volume-qualification/htx-volume-authority-capital-v1";
import { qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import {
  loadQualifiedHtxVolumeAuthorityForOrganization,
  persistHtxVolumeQualificationReceipt,
  readHtxVolumeQualificationReceiptByDigest,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";
import {
  buildPatternDefinitionRecord,
  buildPatternOccurrenceRecord,
  PatternOccurrenceTenantIsolationError,
  persistPatternDefinitionV1,
  persistPatternOccurrenceV1,
  readPatternDefinitionV1,
  readPatternOccurrenceV1,
} from "@/lib/trader/mi/pattern-research/pattern-research-persistence-v1";
import {
  buildResearchTrialRegistrationRecord,
  registerResearchTrialV1,
  readResearchTrialRegistrationV1,
} from "@/lib/trader/research/benchmark/research-trial-registration-service-v1";
import {
  buildKmConvergenceReceiptV1,
  type KmConfigurationMetrics,
} from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import {
  buildScientificAdmissionReceiptRecordV1,
  persistScientificAdmissionReceiptV1,
  readScientificAdmissionReceiptV1,
  requireScientificAdmissionReceiptForOrganization,
  ScientificAdmissionReceiptTenantIsolationError,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";
import {
  cleanupWp13Org,
  seedWp13User,
  WP13_PG_USER_A,
  WP13_PG_USER_B,
} from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

function hex64(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

function qualifiedHtxRows(): HtxKlineRow[] {
  return [
    { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 1000, vol: 10, count: 1 },
    { id: 2, open: 50, high: 51, low: 49, close: 50, amount: 500, vol: 10, count: 1 },
  ];
}

function qualifiedKm(seed: string) {
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

async function cleanupAll(sql: postgres.Sql, orgId: string): Promise<void> {
  const tables = [
    "trader_pattern_occurrence_v1",
    "trader_pattern_definition_v1",
    "trader_scientific_admission_receipt_v1",
    "trader_research_trial_registration_v1",
    "trader_htx_volume_qualification_receipt_v1",
    "trader_knowledge_state_checkpoint_v2",
    "trader_intelligence_decision_economics_v2",
  ] as const;
  for (const table of tables) {
    await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
    await sql.unsafe(`DELETE FROM ${table} WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
  }
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres DEE-518 tenant isolation (ADR-0007) — R3–R6 / volume / decision-econ",
  () => {
    let orgA: string;
    let orgB: string;
    let sql: postgres.Sql;

    // Deliberately overlapping domain identities across orgs.
    const SHARED_TRIAL_DIGEST = hex64("shared-trial-identity");
    const SHARED_PARTITION = hex64("shared-partition");
    const SHARED_PATTERN_KEY = "shared-pattern-key";
    const SHARED_CHECKPOINT_SEQ = 7;
    const SHARED_FORECAST_ID = "00000000-0000-4000-8000-00000000f518";
    const SHARED_VOLUME_SYMBOL = "BTCUSDT";

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      await cleanupWp13Org(url!, WP13_PG_USER_B);
      orgA = await seedWp13User(url!, WP13_PG_USER_A, "DEE518 Tenant Org A");
      orgB = await seedWp13User(url!, WP13_PG_USER_B, "DEE518 Tenant Org B");
      sql = postgres(url!, { max: 2 });
    }, 120_000);

    beforeEach(async () => {
      await cleanupAll(sql, orgA);
      await cleanupAll(sql, orgB);
    });

    afterAll(async () => {
      if (sql) {
        if (orgA) await cleanupAll(sql, orgA);
        if (orgB) await cleanupAll(sql, orgB);
        await sql.end({ timeout: 10 });
      }
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      await cleanupWp13Org(url!, WP13_PG_USER_B);
    });

    describe("A. HTX volume qualification receipt", () => {
      it("READ: ORG_A cannot read ORG_B receipt by shared digest", async () => {
        const receiptB = qualifyHtxKlineVolumeAuthority({
          symbol: SHARED_VOLUME_SYMBOL,
          rows: qualifiedHtxRows(),
          qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
        });
        await persistHtxVolumeQualificationReceipt(sql, {
          organizationId: orgB,
          receipt: receiptB,
        });

        const asA = await readHtxVolumeQualificationReceiptByDigest(sql, {
          organizationId: orgA,
          qualificationReceiptDigest: receiptB.qualificationReceiptDigest,
        });
        expect(asA).toBeNull();
      });

      it("IDEMPOTENCY: same digest may exist independently in ORG_A and ORG_B", async () => {
        const receipt = qualifyHtxKlineVolumeAuthority({
          symbol: SHARED_VOLUME_SYMBOL,
          rows: qualifiedHtxRows(),
          qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
        });
        const a = await persistHtxVolumeQualificationReceipt(sql, {
          organizationId: orgA,
          receipt,
        });
        const b = await persistHtxVolumeQualificationReceipt(sql, {
          organizationId: orgB,
          receipt,
        });
        expect(a.inserted).toBe(true);
        expect(b.inserted).toBe(true);
        expect(a.record.id).not.toBe(b.record.id);
        expect(a.record.organizationId).toBe(orgA);
        expect(b.record.organizationId).toBe(orgB);
      });

      it("AUTHORITY: ORG_A cannot load ORG_B QUALIFIED receipt for capital", async () => {
        const receiptB = qualifyHtxKlineVolumeAuthority({
          symbol: SHARED_VOLUME_SYMBOL,
          rows: qualifiedHtxRows(),
          qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
        });
        await persistHtxVolumeQualificationReceipt(sql, {
          organizationId: orgB,
          receipt: receiptB,
        });

        await expect(
          loadQualifiedHtxVolumeAuthorityForOrganization(sql, {
            organizationId: orgA,
            qualificationReceiptDigest: receiptB.qualificationReceiptDigest,
          }),
        ).rejects.toBeInstanceOf(HtxVolumeCapitalAuthorityError);

        // ORG_B can load its own.
        const loaded = await loadQualifiedHtxVolumeAuthorityForOrganization(sql, {
          organizationId: orgB,
          qualificationReceiptDigest: receiptB.qualificationReceiptDigest,
        });
        expect(loaded.verdict).toBe("HTX_VOLUME_AUTHORITY_QUALIFIED");
      });
    });

    describe("B. Research trial registration", () => {
      it("READ: ORG_A cannot resolve ORG_B trial with shared trial identity", async () => {
        const recordB = buildResearchTrialRegistrationRecord({
          organizationId: orgB,
          trialIdentityDigestHex: SHARED_TRIAL_DIGEST,
          modelTransformVersion: "model-transform/v1",
          comparisonFamilyId: "family-shared",
          symbol: "BTCUSDT",
          primaryHorizonMinutes: 30,
          partitionReceiptDigestHex: SHARED_PARTITION,
        });
        await registerResearchTrialV1(sql, recordB);

        const asA = await readResearchTrialRegistrationV1(sql, {
          organizationId: orgA,
          trialIdentityDigestHex: SHARED_TRIAL_DIGEST,
        });
        expect(asA).toBeNull();
      });

      it("IDEMPOTENCY: shared trial identity is independent per org", async () => {
        const recordA = buildResearchTrialRegistrationRecord({
          organizationId: orgA,
          trialIdentityDigestHex: SHARED_TRIAL_DIGEST,
          modelTransformVersion: "model-transform/v1",
          comparisonFamilyId: "family-shared",
          symbol: "BTCUSDT",
          primaryHorizonMinutes: 30,
          partitionReceiptDigestHex: SHARED_PARTITION,
        });
        const recordB = buildResearchTrialRegistrationRecord({
          organizationId: orgB,
          trialIdentityDigestHex: SHARED_TRIAL_DIGEST,
          modelTransformVersion: "model-transform/v1",
          comparisonFamilyId: "family-shared",
          symbol: "BTCUSDT",
          primaryHorizonMinutes: 30,
          partitionReceiptDigestHex: SHARED_PARTITION,
        });
        const a = await registerResearchTrialV1(sql, recordA);
        const b = await registerResearchTrialV1(sql, recordB);
        expect(a.insertedNew).toBe(true);
        expect(b.insertedNew).toBe(true);
        expect(a.id).not.toBe(b.id);

        // ORG_A re-register resolves to ORG_A only.
        const again = await registerResearchTrialV1(sql, recordA);
        expect(again.insertedNew).toBe(false);
        expect(again.id).toBe(a.id);
      });
    });

    describe("C. Scientific-admission receipt", () => {
      it("READ: ORG_A cannot read ORG_B evidence digest", async () => {
        const volumeB = qualifyHtxKlineVolumeAuthority({
          symbol: SHARED_VOLUME_SYMBOL,
          rows: qualifiedHtxRows(),
        });
        await persistHtxVolumeQualificationReceipt(sql, {
          organizationId: orgB,
          receipt: volumeB,
        });
        const recordB = buildScientificAdmissionReceiptRecordV1({
          organizationId: orgB,
          kmConvergenceReceipt: qualifiedKm("tenant-b"),
          wfPartition: "WF_PREDICTIVE",
          htxVolumeQualificationReceipt: volumeB,
        });
        await persistScientificAdmissionReceiptV1(sql, recordB);

        const asA = await readScientificAdmissionReceiptV1(sql, {
          organizationId: orgA,
          evidenceSemanticDigestHex: recordB.evidenceSemanticDigest,
        });
        expect(asA).toBeNull();
      });

      it("AUTHORITY: wrong-org receipt fails closed (not missing-but-acceptable)", async () => {
        const volumeB = qualifyHtxKlineVolumeAuthority({
          symbol: SHARED_VOLUME_SYMBOL,
          rows: qualifiedHtxRows(),
        });
        await persistHtxVolumeQualificationReceipt(sql, {
          organizationId: orgB,
          receipt: volumeB,
        });
        const recordB = buildScientificAdmissionReceiptRecordV1({
          organizationId: orgB,
          kmConvergenceReceipt: qualifiedKm("tenant-b-auth"),
          wfPartition: "WF_PREDICTIVE",
          htxVolumeQualificationReceipt: volumeB,
        });
        await persistScientificAdmissionReceiptV1(sql, recordB);

        await expect(
          requireScientificAdmissionReceiptForOrganization(sql, {
            organizationId: orgA,
            evidenceSemanticDigestHex: recordB.evidenceSemanticDigest,
          }),
        ).rejects.toBeInstanceOf(ScientificAdmissionReceiptTenantIsolationError);
      });
    });

    describe("D/E. Pattern definition + occurrence", () => {
      it("READ: ORG_A cannot read ORG_B definition with shared pattern key/digest", async () => {
        const defB = buildPatternDefinitionRecord({
          organizationId: orgB,
          patternKey: SHARED_PATTERN_KEY,
          quantizerVersion: "quantizer/v1",
          stateVectorVersion: "state-vector/v1",
          ablationLevel: "level",
          vTilde: [0.1, 0.2],
          authoredBy: "test",
        });
        await persistPatternDefinitionV1(sql, defB);

        const asA = await readPatternDefinitionV1(sql, {
          organizationId: orgA,
          patternKey: SHARED_PATTERN_KEY,
          definitionDigest: defB.definitionDigest,
        });
        expect(asA).toBeNull();
      });

      it("WRITE: ORG_A cannot append occurrence against ORG_B definition", async () => {
        const defB = buildPatternDefinitionRecord({
          organizationId: orgB,
          patternKey: SHARED_PATTERN_KEY,
          quantizerVersion: "quantizer/v1",
          stateVectorVersion: "state-vector/v1",
          ablationLevel: "level",
          vTilde: [0.1, 0.2],
          authoredBy: "test",
        });
        await persistPatternDefinitionV1(sql, defB);

        const occA = buildPatternOccurrenceRecord({
          organizationId: orgA,
          patternDefinitionId: defB.id,
          patternKey: SHARED_PATTERN_KEY,
          patternDefinitionDigest: defB.definitionDigest,
          symbol: "BTCUSDT",
          anchorClosedBarEpochMs: 1_700_000_000_000,
          recurrenceCount: 1,
          transitionRowSums: [1],
          asOfEpochMs: 1_700_000_100_000,
        });

        await expect(persistPatternOccurrenceV1(sql, occA)).rejects.toBeInstanceOf(
          PatternOccurrenceTenantIsolationError,
        );

        const leaked = await readPatternOccurrenceV1(sql, {
          organizationId: orgA,
          patternDefinitionId: defB.id,
          anchorClosedBarEpochMs: 1_700_000_000_000,
        });
        expect(leaked).toBeNull();
      });

      it("IDEMPOTENCY: shared pattern key/digest independent per org", async () => {
        const defA = buildPatternDefinitionRecord({
          organizationId: orgA,
          patternKey: SHARED_PATTERN_KEY,
          quantizerVersion: "quantizer/v1",
          stateVectorVersion: "state-vector/v1",
          ablationLevel: "level",
          vTilde: [0.1, 0.2],
          authoredBy: "test",
        });
        const defB = buildPatternDefinitionRecord({
          organizationId: orgB,
          patternKey: SHARED_PATTERN_KEY,
          quantizerVersion: "quantizer/v1",
          stateVectorVersion: "state-vector/v1",
          ablationLevel: "level",
          vTilde: [0.1, 0.2],
          authoredBy: "test",
        });
        // Digests should match for identical definition content excluding org…
        // buildPatternDefinitionRecord includes organizationId in digest — so digests differ.
        // Shared business key still overlaps.
        expect(defA.patternKey).toBe(defB.patternKey);
        const a = await persistPatternDefinitionV1(sql, defA);
        const b = await persistPatternDefinitionV1(sql, defB);
        expect(a.insertedNew).toBe(true);
        expect(b.insertedNew).toBe(true);
        expect(a.id).not.toBe(b.id);
      });
    });

    describe("F. Knowledge state checkpoint", () => {
      it("READ/RESTORE: ORG_A cannot read or restore ORG_B checkpoint_seq", async () => {
        const recordB = buildKnowledgeCheckpointRecord({
          organizationId: orgB,
          checkpointSeq: SHARED_CHECKPOINT_SEQ,
          modelVersion: "model/v1",
          calibrationSnapshotDigest: hex64("cal-shared"),
          rejectedResearchStates: ["r1"],
          promotedResearchStates: ["p1"],
          forecastPackageGenerationDigest: hex64("pkg-shared"),
        });
        await writeKnowledgeCheckpointV2(sql, recordB);

        const asA = await readKnowledgeCheckpointV2(sql, {
          organizationId: orgA,
          checkpointSeq: SHARED_CHECKPOINT_SEQ,
        });
        expect(asA).toBeNull();

        await expect(
          restoreKnowledgeCheckpointV2(sql, {
            organizationId: orgA,
            checkpointSeq: SHARED_CHECKPOINT_SEQ,
          }),
        ).rejects.toThrow(/no checkpoint found/);
      });

      it("IDEMPOTENCY: shared checkpoint_seq independent per org", async () => {
        const recordA = buildKnowledgeCheckpointRecord({
          organizationId: orgA,
          checkpointSeq: SHARED_CHECKPOINT_SEQ,
          modelVersion: "model/v1",
          calibrationSnapshotDigest: hex64("cal-shared"),
          rejectedResearchStates: ["r1"],
          promotedResearchStates: ["p1"],
        });
        const recordB = buildKnowledgeCheckpointRecord({
          organizationId: orgB,
          checkpointSeq: SHARED_CHECKPOINT_SEQ,
          modelVersion: "model/v1",
          calibrationSnapshotDigest: hex64("cal-shared"),
          rejectedResearchStates: ["r1"],
          promotedResearchStates: ["p1"],
        });
        const a = await writeKnowledgeCheckpointV2(sql, recordA);
        const b = await writeKnowledgeCheckpointV2(sql, recordB);
        expect(a.insertedNew).toBe(true);
        expect(b.insertedNew).toBe(true);
        expect(a.id).not.toBe(b.id);

        const restoredA = await restoreKnowledgeCheckpointV2(sql, {
          organizationId: orgA,
          checkpointSeq: SHARED_CHECKPOINT_SEQ,
        });
        expect(restoredA.input.organizationId).toBe(orgA);
      });
    });

    describe("G. Decision economics V2", () => {
      it("READ: ORG_A cannot read ORG_B economics by shared forecast_id", async () => {
        const recordB = buildDecisionEconomicsV2Record({
          organizationId: orgB,
          forecastId: SHARED_FORECAST_ID,
          notionalUsdt: 10_000,
          costRate: 0.001,
          slippageBufferUsdt: 5,
          replicaSamples: [[[0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0]]],
          scientificAdmissionReceiptDigest: "b".repeat(64),
          scientificAdmissionVerified: true,
        });
        await persistDecisionEconomicsV2(sql, recordB);

        const asA = await readDecisionEconomicsV2ByForecastId(sql, {
          organizationId: orgA,
          forecastId: SHARED_FORECAST_ID,
        });
        expect(asA).toBeNull();
      });

      it("IDEMPOTENCY/WRITE: shared forecast_id may exist independently per org", async () => {
        const recordA = buildDecisionEconomicsV2Record({
          organizationId: orgA,
          forecastId: SHARED_FORECAST_ID,
          notionalUsdt: 10_000,
          costRate: 0.001,
          slippageBufferUsdt: 5,
          replicaSamples: [[[0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0]]],
          scientificAdmissionReceiptDigest: "a".repeat(64),
          scientificAdmissionVerified: true,
        });
        const recordB = buildDecisionEconomicsV2Record({
          organizationId: orgB,
          forecastId: SHARED_FORECAST_ID,
          notionalUsdt: 10_000,
          costRate: 0.001,
          slippageBufferUsdt: 5,
          replicaSamples: [[[0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0]]],
          scientificAdmissionReceiptDigest: "b".repeat(64),
          scientificAdmissionVerified: true,
        });
        await persistDecisionEconomicsV2(sql, recordA);
        await persistDecisionEconomicsV2(sql, recordB);

        const loadedA = await readDecisionEconomicsV2ByForecastId(sql, {
          organizationId: orgA,
          forecastId: SHARED_FORECAST_ID,
        });
        const loadedB = await readDecisionEconomicsV2ByForecastId(sql, {
          organizationId: orgB,
          forecastId: SHARED_FORECAST_ID,
        });
        expect(loadedA?.organizationId).toBe(orgA);
        expect(loadedB?.organizationId).toBe(orgB);
        expect(loadedA?.id).not.toBe(loadedB?.id);
        expect(loadedA?.contentDigest).not.toBe(loadedB?.contentDigest);
      });
    });
  },
);
