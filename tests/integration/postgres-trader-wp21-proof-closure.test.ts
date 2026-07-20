/**
 * DEE-415 / HTR-WP21 — dynamic production-entrypoint and same-run no-feedback proofs.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import {
  assertWp21MandatoryPostgresProofEnvironment,
  countOrgRows,
  createWp21ProofPipelineIdFactory,
  runWp21ProofProductionPipeline,
  seedWp21ProofPostgresOrg,
  WP21_PROOF_TABLES,
} from "@/tests/helpers/wp21-proof-postgres";

function wp21PostgresProofEnabled(): boolean {
  return (
    process.env.WAIA_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL_POSTGRES?.trim())
  );
}

describe.skipIf(!wp21PostgresProofEnabled())(
  "postgres trader wp21 proof closure (DEE-415 / HTR-WP21)",
  () => {
    let db!: ReturnType<typeof getPostgresDrizzle>;
    let sql!: postgres.Sql;
    let url!: string;

    beforeAll(async () => {
      url = process.env.DATABASE_URL_POSTGRES!.trim();
      await assertWp21MandatoryPostgresProofEnvironment();
      db = getPostgresDrizzle();
      sql = postgres(url, { max: 1 });
    });

    afterAll(async () => {
      await sql?.end({ timeout: 5 });
      resetPostgresSingletonForTests();
    });

    it("runs dynamic V1 production entrypoint with WP21 ON and persists linked records", async () => {
      const orgId = await seedWp21ProofPostgresOrg({ db, databaseUrl: url });
      const newId = createWp21ProofPipelineIdFactory();
      const datasetName = `wp21-proof-v1-on-${crypto.randomUUID()}`;
      const { result } = await runWp21ProofProductionPipeline({
        db,
        orgId,
        datasetName,
        wp21Enabled: true,
        metricsSchemaVersion: "1.0.0",
        newId,
      });

      expect(result.validationMetrics).toBeDefined();
      expect(result.knowledge.marketEventId).toBeTruthy();

      expect(await countOrgRows(sql, "trader_intelligence_forecast_record", orgId)).toBeGreaterThan(
        0,
      );
      expect(await countOrgRows(sql, "trader_intelligence_decision_record", orgId)).toBeGreaterThan(
        0,
      );
      expect(await countOrgRows(sql, "trader_knowledge_edges", orgId)).toBeGreaterThan(0);

      const wp21RowTotal = (
        await Promise.all(WP21_PROOF_TABLES.map((table) => countOrgRows(sql, table, orgId)))
      ).reduce((sum, count) => sum + count, 0);
      expect(await countOrgRows(sql, "trader_intelligence_cycle_envelope", orgId)).toBeGreaterThan(
        0,
      );
      expect(
        await countOrgRows(sql, "trader_intelligence_hypothesis_record", orgId),
      ).toBeGreaterThan(0);
      expect(wp21RowTotal).toBeGreaterThan(0);
    }, 180_000);

    it("runs dynamic V2 portfolio-context production entrypoint with WP21 ON", async () => {
      const orgId = await seedWp21ProofPostgresOrg({ db, databaseUrl: url });
      const newId = createWp21ProofPipelineIdFactory();
      const datasetName = `wp21-proof-v2-on-${crypto.randomUUID()}`;
      const { result } = await runWp21ProofProductionPipeline({
        db,
        orgId,
        datasetName,
        wp21Enabled: true,
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
        newId,
      });

      expect(result.validationPortfolioContext).toBeDefined();
      expect(result.validationPortfolioContext?.runConfig.startingBalanceUsdt).toBe("100000.00");
      expect(await countOrgRows(sql, "trader_intelligence_forecast_record", orgId)).toBeGreaterThan(
        0,
      );
      expect(await countOrgRows(sql, "trader_intelligence_cycle_envelope", orgId)).toBeGreaterThan(
        0,
      );
    }, 180_000);
  },
);
