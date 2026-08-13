/**
 * Post-0147 Forecast V2 RLS + tenant isolation (ADR-0007).
 * Opt-in: WAIA_PG_INTEGRATION=1
 *
 * Canonical model: app-scoped organization_id is primary tenant control;
 * authenticated/anon receive deny-all RLS defense-in-depth (not bypassed).
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  persistForecastBundleV2,
  persistPredictivePackageV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { cleanupForecastV2StorageRows } from "@/lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  buildPredictivePackageV1,
  issueForecastV1,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import {
  cleanupWp13Org,
  seedWp13User,
  WP13_PG_USER_A,
  WP13_PG_USER_B,
} from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const PROPORTIONAL = [
  "trader_forecast_bundle_v2",
  "trader_forecast_v2",
  "trader_forecast_scenario_v2",
  "trader_forecast_outcome_v2",
  "trader_forecast_calibration_observation_v2",
] as const;

function anchor(i: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
    realizedVol20m_1m: 0.01 + (i % 12) * 0.0015,
    outcome13d: [0, 0, 0, -0.002 + (i % 7) * 0.0004, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function familyFor(orgId: string): ReplicaRootFamilyInput {
  return {
    organizationId: orgId,
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    executionHorizonMinutes: 33,
    packageSubjectVersion: "pkg-subject/v1",
    terminalTargetDefinitionDigestHex: "a".repeat(64),
    executionOpportunityTargetDefinitionDigestHex: "b".repeat(64),
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: createHash("sha256").update("dev-dataset").digest("hex"),
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: "c".repeat(64),
    codeReleaseSha: "d".repeat(40),
  };
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres forecast-v2 post-0147 RLS + tenant isolation",
  () => {
    let orgA: string;
    let orgB: string;
    let sql: postgres.Sql;
    let bundleIdA: string;
    let terminalForecastIdA: string;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      await cleanupWp13Org(url!, WP13_PG_USER_B);
      orgA = await seedWp13User(url!, WP13_PG_USER_A, "FV2 RLS Org A");
      orgB = await seedWp13User(url!, WP13_PG_USER_B, "FV2 RLS Org B");
      sql = postgres(url!, { max: 2 });
      await cleanupForecastV2StorageRows(sql, orgA);
      await cleanupForecastV2StorageRows(sql, orgB);

      const family = familyFor(orgA);
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgA,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      const issuance = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_360_000,
        anchorRealizedVol20m_1m: 0.015,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      const bundle = await persistForecastBundleV2(sql, {
        organizationId: orgA,
        packageId: persistedPackage.packageId,
        runId: "fv2-rls-run",
        cycleId: "1",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });
      bundleIdA = bundle.bundleId;
      terminalForecastIdA = bundle.terminalForecastId;
    }, 600_000);

    afterAll(async () => {
      if (sql) {
        if (orgA) await cleanupForecastV2StorageRows(sql, orgA);
        if (orgB) await cleanupForecastV2StorageRows(sql, orgB);
        await sql.end({ timeout: 10 });
      }
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      await cleanupWp13Org(url!, WP13_PG_USER_B);
    });

    it("enables RLS with deny-all policies for authenticated/anon on all five proportional relations", async () => {
      for (const table of PROPORTIONAL) {
        const rel = await sql<{ rls: boolean; force: boolean }[]>`
          SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = ${table}
        `;
        expect(rel[0]?.rls, table).toBe(true);
        // Table owner (service path) is not force-RLS'd; authenticated still denied.
        expect(rel[0]?.force, table).toBe(false);

        const policies = await sql<{ policyname: string; roles: string[] }[]>`
          SELECT policyname, roles::text[] AS roles
          FROM pg_policies
          WHERE schemaname = 'public' AND tablename = ${table}
        `;
        expect(policies.length).toBeGreaterThanOrEqual(4);
        const joined = policies.map((p) => `${p.policyname}:${p.roles.join(",")}`).join("|");
        expect(joined).toMatch(/authenticated/);
        expect(joined).toMatch(/anon/);
      }
    });

    it("organization A service path can read its issued sealed graph (no fabricated outcomes)", async () => {
      const bundles = await sql<{ id: string; completeness_state: string }[]>`
        SELECT id::text AS id, completeness_state FROM trader_forecast_bundle_v2
        WHERE organization_id = ${orgA}::uuid AND id = ${bundleIdA}::uuid
      `;
      expect(bundles).toHaveLength(1);
      // DDL insert-legal value when outcomes absent — not an awaiting-promotion lifecycle.
      expect(bundles[0]?.completeness_state).toBe("INCOMPLETE");
      const forecasts = await sql<{ id: string }[]>`
        SELECT id::text AS id FROM trader_forecast_v2
        WHERE organization_id = ${orgA}::uuid AND bundle_id = ${bundleIdA}::uuid
      `;
      expect(forecasts).toHaveLength(2);
      const scenarios = await sql<{ n: string; null_lowers: string; null_uppers: string }[]>`
        SELECT
          count(*)::text AS n,
          count(*) FILTER (WHERE lower_bound_scale8 IS NULL)::text AS null_lowers,
          count(*) FILTER (WHERE upper_bound_scale8 IS NULL)::text AS null_uppers
        FROM trader_forecast_scenario_v2
        WHERE organization_id = ${orgA}::uuid AND forecast_id = ${terminalForecastIdA}::uuid
      `;
      expect(Number(scenarios[0]?.n)).toBe(7);
      expect(Number(scenarios[0]?.null_lowers)).toBe(1);
      expect(Number(scenarios[0]?.null_uppers)).toBe(1);
      const outcomes = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM trader_forecast_outcome_v2
        WHERE organization_id = ${orgA}::uuid AND bundle_id = ${bundleIdA}::uuid
      `;
      expect(Number(outcomes[0]?.n)).toBe(0);
      const calib = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM trader_forecast_calibration_observation_v2
        WHERE organization_id = ${orgA}::uuid AND bundle_id = ${bundleIdA}::uuid
      `;
      expect(Number(calib[0]?.n)).toBe(0);
    });

    it("organization B scoped reads cannot observe organization A rows", async () => {
      for (const table of PROPORTIONAL) {
        const rows = (await sql.unsafe(
          `SELECT count(*)::text AS n FROM ${table} WHERE organization_id = $1::uuid`,
          [orgB],
        )) as { n: string }[];
        expect(Number(rows[0]?.n ?? -1), table).toBe(0);
      }
      // Natural-key probe must not leak A's content into B's scope.
      const leaked = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM trader_forecast_bundle_v2
        WHERE organization_id = ${orgB}::uuid
          AND run_id = 'fv2-rls-run'
          AND cycle_id = '1'
          AND symbol = 'BTCUSDT'
      `;
      expect(Number(leaked[0]?.n)).toBe(0);
    });

    it("authenticated role is denied SELECT/INSERT on all five proportional relations (RLS active)", async () => {
      const roleSql = postgres(url!, { max: 1 });
      try {
        await roleSql.unsafe(`SET ROLE authenticated`);
        for (const table of PROPORTIONAL) {
          await expect(
            roleSql.unsafe(`SELECT * FROM ${table} WHERE organization_id = $1::uuid LIMIT 1`, [
              orgA,
            ]),
          ).rejects.toThrow();
          await expect(
            roleSql.unsafe(
              `INSERT INTO ${table} SELECT * FROM ${table} WHERE organization_id = $1::uuid LIMIT 0`,
              [orgA],
            ),
          ).rejects.toThrow();
        }
      } finally {
        try {
          await roleSql.unsafe(`RESET ROLE`);
        } catch {
          /* ignore */
        }
        await roleSql.end({ timeout: 5 });
      }
    });

    it("append-only UPDATE/DELETE remain enforced on A's bundle graph", async () => {
      await expect(
        sql.unsafe(`UPDATE trader_forecast_bundle_v2 SET run_id = 'mutated' WHERE id = $1::uuid`, [
          bundleIdA,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        sql.unsafe(`DELETE FROM trader_forecast_bundle_v2 WHERE id = $1::uuid`, [bundleIdA]),
      ).rejects.toThrow(/append-only/);
      await expect(
        sql.unsafe(
          `DELETE FROM trader_forecast_scenario_v2 WHERE organization_id = $1::uuid AND forecast_id = $2::uuid`,
          [orgA, terminalForecastIdA],
        ),
      ).rejects.toThrow(/append-only/);
    });

    it("organization B can persist an independent graph with same non-org natural components", async () => {
      const family = familyFor(orgB);
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i + 1000)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgB,
        kmGlobalAnchorSetDigestHex: "e".repeat(64),
      });
      const issuance = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_360_000,
        anchorRealizedVol20m_1m: 0.015,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      const bundleB = await persistForecastBundleV2(sql, {
        organizationId: orgB,
        packageId: persistedPackage.packageId,
        runId: "fv2-rls-run",
        cycleId: "1",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });
      expect(bundleB.bundleId).not.toBe(bundleIdA);
      const countA = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM trader_forecast_bundle_v2
        WHERE organization_id = ${orgA}::uuid AND run_id = 'fv2-rls-run' AND cycle_id = '1'
      `;
      const countB = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM trader_forecast_bundle_v2
        WHERE organization_id = ${orgB}::uuid AND run_id = 'fv2-rls-run' AND cycle_id = '1'
      `;
      expect(Number(countA[0]?.n)).toBe(1);
      expect(Number(countB[0]?.n)).toBe(1);
    });
  },
);
