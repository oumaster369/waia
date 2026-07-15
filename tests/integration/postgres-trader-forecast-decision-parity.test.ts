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
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import {
  buildWp14Bundle,
  cleanupWp14AllRows,
  cleanupWp14Org,
  countWp14RowsForRun,
  seedWp14User,
  WP14_PG_USER_A,
  wp14Bars,
} from "./wp14-forecast-decision-test-helpers";
import { buildWp13Bundle } from "./wp13-intelligence-test-helpers";

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
      const bundle = buildWp14Bundle(orgA, "wp14-parity-run", "0");
      await persistForecastDecisionBundle({ organizationId: orgA }, bundle, db);

      const forecasts = await db
        .select()
        .from(pgSchema.traderIntelligenceForecastRecord)
        .where(eq(pgSchema.traderIntelligenceForecastRecord.organizationId, orgA));
      expect(forecasts.length).toBe(bundle.forecasts.length);

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
      await persistForecastDecisionBundle({ organizationId: orgA }, bundle, db);
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
