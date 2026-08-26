/**
 * DEE-415 / HTR-WP13 — intelligence records Postgres parity (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { createConvictionRecordRepositoryPostgres } from "@/lib/trader/intelligence/records/conviction-record-repository-postgres";
import { createCycleEnvelopeRepositoryPostgres } from "@/lib/trader/intelligence/records/cycle-envelope-repository-postgres";
import { createHypothesisRecordRepositoryPostgres } from "@/lib/trader/intelligence/records/hypothesis-record-repository-postgres";
import {
  buildWp13Bundle,
  cleanupWp13IntelligenceRows,
  cleanupWp13Org,
  countWp13Rows,
  countWp13RowsForRun,
  seedWp13User,
  WP13_PG_USER_A,
  wp13Bars,
} from "./wp13-intelligence-test-helpers";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader intelligence records parity (DEE-415 / HTR-WP13)",
  () => {
    let orgA: string;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      orgA = await seedWp13User(url!, WP13_PG_USER_A, "WP13 Intelligence Records Parity");
    });

    beforeEach(async () => {
      await cleanupWp13IntelligenceRows(url!, orgA);
    });

    afterAll(async () => {
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    it("persists envelope, hypotheses and conviction with parity", async () => {
      const db = getPostgresDrizzle();
      const source = buildWp13Bundle(orgA, "wp13-parity-run", "0");
      const lineageJson = '{"schemaVersion":"waia.trader.canonical_causal_lineage.v1","sentinel":"exact-bytes"}';
      const lineageDigest = "dee-626-postgres-hypothesis-round-trip";
      const bundle = { ...source, hypotheses: source.hypotheses.map((record, index) => index === 0 ? { ...record, canonicalCausalLineageJson: lineageJson, canonicalCausalLineageDigest: lineageDigest } : record) };
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);

      const envelopes = await db
        .select()
        .from(pgSchema.traderIntelligenceCycleEnvelope)
        .where(eq(pgSchema.traderIntelligenceCycleEnvelope.organizationId, orgA));
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0]?.contentDigest).toBe(bundle.envelope.contentDigest);
      expect(envelopes[0]?.inputCausalBundleJson).toBe(bundle.envelope.inputCausalBundleJson);
      expect(envelopes[0]?.inputSemanticDigest).toBe(bundle.envelope.inputSemanticDigest);

      const hypotheses = await db
        .select()
        .from(pgSchema.traderIntelligenceHypothesisRecord)
        .where(eq(pgSchema.traderIntelligenceHypothesisRecord.organizationId, orgA));
      expect(hypotheses.length).toBe(bundle.hypotheses.length);
      expect(hypotheses[0]?.canonicalCausalLineageJson).toBe(lineageJson);
      expect(hypotheses[0]?.canonicalCausalLineageDigest).toBe(lineageDigest);

      const convictions = await db
        .select()
        .from(pgSchema.traderIntelligenceConvictionRecord)
        .where(eq(pgSchema.traderIntelligenceConvictionRecord.organizationId, orgA));
      expect(convictions).toHaveLength(1);
    });

    it("rolls back complete bundle when conviction insert fails", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-rollback-conviction", "0");
      const context = { organizationId: orgA };

      await expect(
        runWaiaPostgresTransaction(db, async (tx) => {
          const envelopeRepo = createCycleEnvelopeRepositoryPostgres(tx);
          const hypothesisRepo = createHypothesisRecordRepositoryPostgres(tx);
          const convictionRepo = createConvictionRecordRepositoryPostgres(tx);
          await envelopeRepo.insert(context, bundle.envelope);
          for (const hypothesis of bundle.hypotheses) {
            await hypothesisRepo.insert(context, hypothesis);
          }
          await convictionRepo.insert(context, {
            ...bundle.conviction,
            convictionScope: "AGGREGATE" as "NONE",
          });
        }),
      ).rejects.toThrow();

      const counts = await countWp13RowsForRun(url!, orgA, "wp13-rollback-conviction");
      expect(counts.envelopes).toBe(0);
      expect(counts.hypotheses).toBe(0);
      expect(counts.convictions).toBe(0);
    });

    it("rolls back when failure occurs after envelope insert", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-rollback-envelope", "1");
      const context = { organizationId: orgA };

      await expect(
        runWaiaPostgresTransaction(db, async (tx) => {
          const envelopeRepo = createCycleEnvelopeRepositoryPostgres(tx);
          await envelopeRepo.insert(context, bundle.envelope);
          throw new Error("injected failure after envelope");
        }),
      ).rejects.toThrow("injected failure after envelope");

      const counts = await countWp13RowsForRun(url!, orgA, "wp13-rollback-envelope");
      expect(counts.envelopes).toBe(0);
      expect(counts.convictions).toBe(0);
    });

    it("rolls back when failure occurs after hypothesis N", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-rollback-hypothesis", "2");
      const context = { organizationId: orgA };

      await expect(
        runWaiaPostgresTransaction(db, async (tx) => {
          const envelopeRepo = createCycleEnvelopeRepositoryPostgres(tx);
          const hypothesisRepo = createHypothesisRecordRepositoryPostgres(tx);
          await envelopeRepo.insert(context, bundle.envelope);
          if (bundle.hypotheses.length === 0) {
            throw new Error("expected at least one hypothesis");
          }
          await hypothesisRepo.insert(context, bundle.hypotheses[0]!);
          throw new Error("injected failure after hypothesis");
        }),
      ).rejects.toThrow("injected failure after hypothesis");

      const counts = await countWp13RowsForRun(url!, orgA, "wp13-rollback-hypothesis");
      expect(counts.envelopes).toBe(0);
      expect(counts.hypotheses).toBe(0);
    });

    it("checkpoint/resume overlap accepts identical bundle idempotently", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-checkpoint", "0");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
      const counts = await countWp13Rows(url!, orgA);
      expect(counts.envelopes).toBe(1);
      expect(counts.convictions).toBe(1);
    });

    it("rejects append-only UPDATE on cycle envelope", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-append-only", "0");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
      const sql = postgres(url!, { max: 1 });
      try {
        await expect(
          sql.unsafe(
            `UPDATE trader_intelligence_cycle_envelope SET terminal_reason_code = 'NO_TRADE' WHERE organization_id = $1`,
            [orgA],
          ),
        ).rejects.toThrow(/append-only/i);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("denies authenticated role direct reads on intelligence tables", async () => {
      const sql = postgres(url!, { max: 1, prepare: false });
      try {
        await sql.unsafe(`SET ROLE authenticated`);
        await expect(
          sql.unsafe(`SELECT 1 FROM trader_intelligence_cycle_envelope LIMIT 1`),
        ).rejects.toThrow();
        await expect(
          sql.unsafe(`SELECT 1 FROM trader_intelligence_hypothesis_record LIMIT 1`),
        ).rejects.toThrow();
        await expect(
          sql.unsafe(`SELECT 1 FROM trader_intelligence_conviction_record LIMIT 1`),
        ).rejects.toThrow();
      } finally {
        await sql.unsafe(`RESET ROLE`);
        await sql.end({ timeout: 5 });
      }
    });

    it("fresh migration tables exist with expected schema parity", async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        const tables = await sql.unsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN (
               'trader_intelligence_cycle_envelope',
               'trader_intelligence_hypothesis_record',
               'trader_intelligence_conviction_record'
             )
           ORDER BY table_name`,
        );
        expect(tables.map((row) => row.table_name)).toEqual([
          "trader_intelligence_conviction_record",
          "trader_intelligence_cycle_envelope",
          "trader_intelligence_hypothesis_record",
        ]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("evaluation without persistence sink does not claim persisted records", async () => {
      const cycle = runEvaluationCycle({
        organizationId: orgA,
        bars: wp13Bars(),
        historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
        runId: "wp13-no-sink",
        cycleId: "0",
        newId: createDeterministicReplayIdFactory(415_130),
      });
      expect(cycle.intelligenceCycleBundle).toBeDefined();
      const counts = await countWp13Rows(url!, orgA);
      expect(counts.envelopes).toBe(0);
    });
  },
);
