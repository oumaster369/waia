/**
 * DEE-415 / HTR-WP21 — outcome + calibration Postgres parity (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { createForecastOutcomeRepositoryPostgres } from "@/lib/trader/intelligence/outcome-resolution/forecast-outcome-repository-postgres";
import { resolveForecastOutcomeClass } from "@/lib/trader/intelligence/outcome-resolution/resolve-forecast-outcome";
import { OutcomeResolutionIdempotencyConflictError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import { persistForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { seedWp21ProofUser } from "@/tests/helpers/wp21-proof-postgres";
import { assertWp21MandatoryPostgresProofEnvironment } from "@/tests/helpers/wp21-proof-postgres";
import { wp21Bars, wp21Provenance } from "@/tests/unit/wp21-test-helpers";
import {
  buildWp14Bundle,
  buildWp14PersistenceAuthorization,
  cleanupWp14AllRows,
} from "./wp14-forecast-decision-test-helpers";
import { buildWp13Bundle } from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8021-0000000000a1";
const RLS_DENIED_SQLSTATE = "42501";

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader wp21 outcome calibration parity (DEE-415 / HTR-WP21)",
  () => {
    let orgA: string;
    let sql: postgres.Sql;

    async function cleanupRows(): Promise<void> {
      const tables = [
        "trader_calibration_observation_record",
        "trader_calibration_snapshot_record",
        "trader_abstention_outcome_record",
        "trader_knowledge_confidence_update_record",
        "trader_hypothesis_outcome_record",
        "trader_forecast_outcome_record",
      ] as const;
      for (const table of tables) {
        await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
        await sql.unsafe(`DELETE FROM ${table} WHERE organization_id = $1`, [orgA]);
        await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
      }
      await cleanupWp14AllRows(url!, orgA);
    }

    beforeAll(async () => {
      await assertWp21MandatoryPostgresProofEnvironment();
      sql = postgres(url!, { max: 1 });
      orgA = await seedWp21ProofUser(url!, USER_A, "WP21 Outcome Parity");
    }, 60_000);

    beforeEach(async () => {
      // Unique run ids per test; avoid table-owner-only cleanup in local Postgres profiles.
    });

    afterAll(async () => {
      await sql.end({ timeout: 5 });
      resetPostgresSingletonForTests();
    });

    it("creates trader_forecast_outcome_record table", async () => {
      const tables = await sql.unsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'trader_forecast_outcome_record'`,
      );
      expect(tables).toHaveLength(1);
    });

    it("denies authenticated role direct table access (42501)", async () => {
      const baseline = await sql.unsafe<{ role: string }[]>(`SELECT current_user AS role`);
      await sql.unsafe(`SET ROLE authenticated`);
      try {
        await sql.unsafe(`SELECT 1 FROM trader_forecast_outcome_record LIMIT 1`);
        throw new Error("expected permission denied");
      } catch (error) {
        const probe = error as Error & { code?: string };
        expect(probe.code).toBe(RLS_DENIED_SQLSTATE);
      } finally {
        await sql.unsafe(`RESET ROLE`);
        expect((await sql.unsafe<{ role: string }[]>(`SELECT current_user AS role`))[0]?.role).toBe(
          baseline[0]?.role,
        );
      }
    });

    it("idempotent insert accepts identical digest and rejects digest conflict", async () => {
      const db = getPostgresDrizzle();
      const runId = `wp21-idem-${Date.now()}`;
      const cycleId = "0";
      await persistIntelligenceCycleBundle(
        { organizationId: orgA },
        buildWp13Bundle(orgA, runId, cycleId),
        db,
      );
      const wp14 = buildWp14Bundle(orgA, runId, cycleId);
      await persistForecastDecisionBundle(
        { organizationId: orgA },
        wp14,
        db,
        buildWp14PersistenceAuthorization(orgA, wp14),
      );
      const forecast = wp14.forecasts[0]!;
      const startMs = Date.parse(forecast.issuedAt);
      const horizonMs = Date.parse(forecast.targetWindowEndAt);
      const barCount = Math.ceil((horizonMs - startMs) / 60_000) + 2;
      const allBars = wp21Bars({ startMs, count: barCount, step: 0.5 });
      const asOf =
        allBars.find((bar) => Date.parse(bar.barCloseTime) >= horizonMs)?.barCloseTime ??
        forecast.targetWindowEndAt;
      const bars = allBars.filter((bar) => Date.parse(bar.barCloseTime) <= Date.parse(asOf));

      const insert = async (record: ReturnType<typeof resolveForecastOutcomeClass>) =>
        runWaiaPostgresTransaction(db, async (tx) => {
          const repo = createForecastOutcomeRepositoryPostgres(tx);
          await repo.insert({ organizationId: orgA }, record);
        });

      const record = resolveForecastOutcomeClass({
        context: { organizationId: orgA },
        forecast,
        decision: wp14.decision,
        pitWindow: {
          bars,
          asOf,
          evidenceCutoffAt: asOf,
        },
        provenance: wp21Provenance(),
        codeSha: "wp21-parity",
      });

      await insert(record);
      await insert(record);

      const conflict = {
        ...record,
        contentDigest: "f".repeat(64),
      };
      await expect(insert(conflict)).rejects.toBeInstanceOf(
        OutcomeResolutionIdempotencyConflictError,
      );
    }, 60_000);
  },
);
