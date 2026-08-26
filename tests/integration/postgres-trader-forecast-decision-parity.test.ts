/**
 * DEE-415 / HTR-WP14 — forecast-decision Postgres parity (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { persistForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import {
  buildWp14Bundle,
  buildWp14PersistenceAuthorization,
  cleanupWp14AllRows,
  cleanupWp14Org,
  countWp14RowsForRun,
  seedWp14User,
  sealWp14PersistenceConflictFixture,
  WP14_PG_USER_A,
  wp14Bars,
} from "./wp14-forecast-decision-test-helpers";
import { buildWp13Bundle } from "./wp13-intelligence-test-helpers";
import { createOutcomeResolutionSourcePostgres } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution-source-postgres";
import { createMkbReadModelSourcePostgres } from "@/lib/trader/knowledge/mkb-read-model-postgres";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader forecast-decision parity (DEE-415 / HTR-WP14)",
  () => {
    let orgA: string;

    beforeAll(async () => {
      await cleanupWp14Org(url!, WP14_PG_USER_A);
      orgA = await seedWp14User(url!, WP14_PG_USER_A, "WP14 Forecast Decision Parity");
    });

    beforeEach(async () => {
      await cleanupWp14AllRows(url!, orgA);
    });

    afterAll(async () => {
      await cleanupWp14Org(url!, WP14_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    it("persists forecast, decision, links and optional entry-purpose with parity", async () => {
      const db = getPostgresDrizzle();
      const wp13 = buildWp13Bundle(orgA, "wp14-parity-run", "0");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, wp13, db);
      const source = buildWp14Bundle(orgA, "wp14-parity-run", "0");
      const lineageJson = '{"schemaVersion":"waia.trader.canonical_causal_lineage.v1","sentinel":"exact-bytes"}';
      const lineageDigest = "dee-626-postgres-forecast-round-trip";
      const bundle = sealWp14PersistenceConflictFixture(orgA, { ...source, forecasts: source.forecasts.map((record) => ({ ...record, canonicalCausalLineageJson: lineageJson, canonicalCausalLineageDigest: lineageDigest })) });
      await persistForecastDecisionBundle(
        { organizationId: orgA },
        bundle,
        db,
        buildWp14PersistenceAuthorization(orgA, bundle),
      );
      const forecastKeyDigest = "a".repeat(64);
      const storedDigest = "b".repeat(64);
      await db.insert(pgSchema.traderIntelligenceForecastRecord).values({
        id: "00000000-0000-4000-8000-000000062600",
        organizationId: orgA,
        cycleEnvelopeId: wp13.envelope.id,
        hypothesisRecordId: wp13.hypotheses[0]!.id,
        convictionRecordId: wp13.conviction.id,
        runId: "wp14-parity-run",
        cycleId: "0",
        symbol: "BTC/USDT",
        forecastKeyDigest,
        evaluatedAt: new Date("2026-01-01T00:00:00.000Z"),
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        evidenceCutoffAt: new Date("2026-01-01T00:00:00.000Z"),
        targetWindowStartAt: new Date("2026-01-01T00:00:00.000Z"),
        targetWindowEndAt: new Date("2026-01-01T01:00:00.000Z"),
        marketQuestion: "DEE-626 parity",
        invalidationConditionsJson: "[]",
        scenarioSetJson: "[]",
        forecastConfidenceJson: "{}",
        historicalProfileId: "profile",
        historicalProfileDigest: storedDigest,
        matrixDigest: storedDigest,
        evidenceDigest: storedDigest,
        authoritativeLinkDigest: storedDigest,
        canonicalCausalLineageJson: lineageJson,
        canonicalCausalLineageDigest: lineageDigest,
        forecastModelVersion: "test",
        contentDigest: storedDigest,
        schemaVersion: "waia.trader.intelligence_forecast_record.v1",
      });

      const forecasts = await db
        .select()
        .from(pgSchema.traderIntelligenceForecastRecord)
        .where(eq(pgSchema.traderIntelligenceForecastRecord.organizationId, orgA));
      expect(forecasts.length).toBe(bundle.forecasts.length + 1);
      expect(forecasts[0]?.canonicalCausalLineageJson).toBe(lineageJson);
      expect(forecasts[0]?.canonicalCausalLineageDigest).toBe(lineageDigest);
      const context = { organizationId: orgA };
      const outcomeRows = await createOutcomeResolutionSourcePostgres(db)
        .listForecastsEligibleForResolution(context, "wp14-parity-run", "2027-01-01T00:00:00.000Z");
      expect(outcomeRows[0]?.canonicalCausalLineageJson).toBe(lineageJson);
      expect(outcomeRows[0]?.canonicalCausalLineageDigest).toBe(lineageDigest);
      const mkb = await createMkbReadModelSourcePostgres(db).loadSnapshot(
        context,
        { runId: "wp14-parity-run", cycleId: "0", symbol: "BTC/USDT" },
        new Date("2027-01-01T00:00:00.000Z"),
      );
      expect(mkb.forecasts[0]?.canonicalCausalLineageJson).toBe(lineageJson);
      expect(mkb.forecasts[0]?.canonicalCausalLineageDigest).toBe(lineageDigest);

      const decisions = await db
        .select()
        .from(pgSchema.traderIntelligenceDecisionRecord)
        .where(eq(pgSchema.traderIntelligenceDecisionRecord.organizationId, orgA));
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.contentDigest).toBe(bundle.decision.contentDigest);

      const links = await db
        .select()
        .from(pgSchema.traderIntelligenceDecisionForecastLink)
        .where(eq(pgSchema.traderIntelligenceDecisionForecastLink.organizationId, orgA));
      expect(links.length).toBe(bundle.links.length);
    });

    it("fresh migration tables exist with expected schema parity", async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        const tables = await sql.unsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN (
               'trader_intelligence_forecast_record',
               'trader_intelligence_decision_record',
               'trader_intelligence_decision_forecast_link',
               'trader_intelligence_entry_purpose_record'
             )
           ORDER BY table_name`,
        );
        expect(tables.map((row) => row.table_name)).toEqual([
          "trader_intelligence_decision_forecast_link",
          "trader_intelligence_decision_record",
          "trader_intelligence_entry_purpose_record",
          "trader_intelligence_forecast_record",
        ]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("evaluation without persistence sink does not claim persisted WP14 records", async () => {
      const cycle = runEvaluationCycle({
        organizationId: orgA,
        bars: wp14Bars(),
        historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
        runId: "wp14-no-sink",
        cycleId: "0",
        newId: createDeterministicReplayIdFactory(415_140),
        costModel: createCostModelV1("10", "5"),
        informationSufficiencyAuthority: declareResearchNonCapitalInformationAuthorityV2({
          organizationId: orgA,
          reason: "HTR_WP14_POSTGRES_NO_SINK_TEST",
        }),
      });
      expect(cycle.forecastDecisionBundle).toBeDefined();
      const counts = await countWp14RowsForRun(url!, orgA, "wp14-no-sink");
      expect(counts.decisions).toBe(0);
    });

    it("rejects append-only UPDATE on decision record", async () => {
      const db = getPostgresDrizzle();
      const wp13 = buildWp13Bundle(orgA, "wp14-append-only", "0");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, wp13, db);
      const bundle = buildWp14Bundle(orgA, "wp14-append-only", "0");
      await persistForecastDecisionBundle(
        { organizationId: orgA },
        bundle,
        db,
        buildWp14PersistenceAuthorization(orgA, bundle),
      );
      const sql = postgres(url!, { max: 1 });
      try {
        await expect(
          sql.unsafe(
            `UPDATE trader_intelligence_decision_record SET decision_class = 'TRADE' WHERE organization_id = $1`,
            [orgA],
          ),
        ).rejects.toThrow(/append-only/i);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);
