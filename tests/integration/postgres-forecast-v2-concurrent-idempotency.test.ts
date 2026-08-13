/**
 * True concurrent natural-idempotency proofs for Forecast V2 persistence.
 * Opt-in: WAIA_PG_INTEGRATION=1
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

function anchor(i: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: createHash("sha256").update(`c-${i}`).digest("hex"),
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
    developmentDatasetDigestHex: createHash("sha256").update("dev-dataset-c").digest("hex"),
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: "c".repeat(64),
    codeReleaseSha: "d".repeat(40),
  };
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Deterministic concurrency gate: both connections ready, then both calls released together. */
async function runConcurrentPair<T>(
  sqlA: postgres.Sql,
  sqlB: postgres.Sql,
  left: () => Promise<T>,
  right: () => Promise<T>,
): Promise<[PromiseSettledResult<T>, PromiseSettledResult<T>]> {
  const readyA = deferred();
  const readyB = deferred();
  const go = deferred();
  const pA = (async () => {
    await sqlA`SELECT 1`;
    readyA.resolve();
    await go.promise;
    return left();
  })();
  const pB = (async () => {
    await sqlB`SELECT 1`;
    readyB.resolve();
    await go.promise;
    return right();
  })();
  await Promise.all([readyA.promise, readyB.promise]);
  go.resolve();
  return Promise.allSettled([pA, pB]);
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres forecast-v2 concurrent natural idempotency",
  () => {
    let orgA: string;
    let orgB: string;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      await cleanupWp13Org(url!, WP13_PG_USER_B);
      orgA = await seedWp13User(url!, WP13_PG_USER_A, "FV2 Conc Org A");
      orgB = await seedWp13User(url!, WP13_PG_USER_B, "FV2 Conc Org B");
    }, 120_000);

    beforeEach(async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        await cleanupForecastV2StorageRows(sql, orgA);
        await cleanupForecastV2StorageRows(sql, orgB);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }, 120_000);

    afterAll(async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        await cleanupForecastV2StorageRows(sql, orgA);
        await cleanupForecastV2StorageRows(sql, orgB);
      } finally {
        await sql.end({ timeout: 5 });
      }
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      await cleanupWp13Org(url!, WP13_PG_USER_B);
    });

    it("Case A: concurrent same-org same-identity same-content converges to one graph", async () => {
      const sqlSetup = postgres(url!, { max: 1 });
      const family = familyFor(orgA);
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sqlSetup, pkg, {
        organizationId: orgA,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      const issuance = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_500_000,
        anchorRealizedVol20m_1m: 0.016,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      await sqlSetup.end({ timeout: 5 });

      const sqlA = postgres(url!, { max: 1 });
      const sqlB = postgres(url!, { max: 1 });
      try {
        const input = {
          organizationId: orgA,
          packageId: persistedPackage.packageId,
          runId: "fv2-conc-same",
          cycleId: "11",
          symbol: family.symbol,
          anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
          issuance,
        };
        const settled = await runConcurrentPair(
          sqlA,
          sqlB,
          () => persistForecastBundleV2(sqlA, input),
          () => persistForecastBundleV2(sqlB, input),
        );
        expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
        const r1 = (
          settled[0] as PromiseFulfilledResult<{
            bundleId: string;
            terminalForecastId: string;
            retriedExisting: boolean;
          }>
        ).value;
        const r2 = (
          settled[1] as PromiseFulfilledResult<{
            bundleId: string;
            terminalForecastId: string;
            retriedExisting: boolean;
          }>
        ).value;
        expect(r1.bundleId).toBe(r2.bundleId);
        const counts = await sqlA<
          {
            bundles: string;
            forecasts: string;
            scenarios: string;
            outcomes: string;
            calib: string;
          }[]
        >`
          SELECT
            (SELECT count(*)::text FROM trader_forecast_bundle_v2 WHERE organization_id = ${orgA}::uuid AND run_id = 'fv2-conc-same') AS bundles,
            (SELECT count(*)::text FROM trader_forecast_v2 WHERE organization_id = ${orgA}::uuid AND bundle_id = ${r1.bundleId}::uuid) AS forecasts,
            (SELECT count(*)::text FROM trader_forecast_scenario_v2 WHERE organization_id = ${orgA}::uuid AND forecast_id = ${r1.terminalForecastId}::uuid) AS scenarios,
            (SELECT count(*)::text FROM trader_forecast_outcome_v2 WHERE organization_id = ${orgA}::uuid AND bundle_id = ${r1.bundleId}::uuid) AS outcomes,
            (SELECT count(*)::text FROM trader_forecast_calibration_observation_v2 WHERE organization_id = ${orgA}::uuid AND bundle_id = ${r1.bundleId}::uuid) AS calib
        `;
        expect(Number(counts[0]?.bundles)).toBe(1);
        expect(Number(counts[0]?.forecasts)).toBe(2);
        expect(Number(counts[0]?.scenarios)).toBe(7);
        expect(Number(counts[0]?.outcomes)).toBe(0);
        expect(Number(counts[0]?.calib)).toBe(0);
      } finally {
        await sqlA.end({ timeout: 5 });
        await sqlB.end({ timeout: 5 });
      }
    }, 180_000);

    it("Case B: concurrent same-org same-identity different-content never duplicates and fails closed", async () => {
      const sqlSetup = postgres(url!, { max: 1 });
      const family = familyFor(orgA);
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i + 200)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sqlSetup, pkg, {
        organizationId: orgA,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      const issuanceA = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_600_000,
        anchorRealizedVol20m_1m: 0.016,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      const issuanceB = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_600_000,
        anchorRealizedVol20m_1m: 0.028,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      expect(issuanceA.forecastContentDigestTerminal).not.toBe(
        issuanceB.forecastContentDigestTerminal,
      );
      await sqlSetup.end({ timeout: 5 });

      const sqlA = postgres(url!, { max: 1 });
      const sqlB = postgres(url!, { max: 1 });
      try {
        const base = {
          organizationId: orgA,
          packageId: persistedPackage.packageId,
          runId: "fv2-conc-conflict",
          cycleId: "12",
          symbol: family.symbol,
          anchorClosedBarEpochMs: 1_700_000_600_000,
        };
        const settled = await runConcurrentPair(
          sqlA,
          sqlB,
          () => persistForecastBundleV2(sqlA, { ...base, issuance: issuanceA }),
          () => persistForecastBundleV2(sqlB, { ...base, issuance: issuanceB }),
        );
        const fulfilled = settled.filter((s) => s.status === "fulfilled");
        const rejected = settled.filter((s) => s.status === "rejected");
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        const err = (rejected[0] as PromiseRejectedResult).reason as Error;
        expect(String(err.message)).toMatch(
          /natural-idempotent conflict|natural_idempotency|duplicate key/,
        );
        const count = await sqlA<{ n: string }[]>`
          SELECT count(*)::text AS n FROM trader_forecast_bundle_v2
          WHERE organization_id = ${orgA}::uuid AND run_id = 'fv2-conc-conflict' AND cycle_id = '12'
        `;
        expect(Number(count[0]?.n)).toBe(1);
        const winner = (fulfilled[0] as PromiseFulfilledResult<{ bundleId: string }>).value;
        const digest = await sqlA<{ d: Buffer }[]>`
          SELECT bundle_content_digest AS d FROM trader_forecast_bundle_v2
          WHERE id = ${winner.bundleId}::uuid
        `;
        expect(digest).toHaveLength(1);
      } finally {
        await sqlA.end({ timeout: 5 });
        await sqlB.end({ timeout: 5 });
      }
    }, 180_000);

    it("Case C: different orgs with same non-org natural components both succeed", async () => {
      const sqlA = postgres(url!, { max: 1 });
      const sqlB = postgres(url!, { max: 1 });
      try {
        const familyA = familyFor(orgA);
        const familyB = familyFor(orgB);
        const pkgA = buildPredictivePackageV1({
          family: familyA,
          sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i + 300)),
          kConfigDec: 3,
          mConfigDec: 4,
        });
        const pkgB = buildPredictivePackageV1({
          family: familyB,
          sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i + 400)),
          kConfigDec: 3,
          mConfigDec: 4,
        });
        const persistedA = await persistPredictivePackageV2(sqlA, pkgA, {
          organizationId: orgA,
          kmGlobalAnchorSetDigestHex: "f".repeat(64),
        });
        const persistedB = await persistPredictivePackageV2(sqlB, pkgB, {
          organizationId: orgB,
          kmGlobalAnchorSetDigestHex: "e".repeat(64),
        });
        const issuanceA = issueForecastV1({
          pkg: pkgA,
          anchorClosedBarEpochMs: 1_700_000_700_000,
          anchorRealizedVol20m_1m: 0.017,
          executionHorizonMinutes: familyA.executionHorizonMinutes,
          normalizationVersionDigestHex: familyA.normalizationVersionDigestHex,
        });
        const issuanceB = issueForecastV1({
          pkg: pkgB,
          anchorClosedBarEpochMs: 1_700_000_700_000,
          anchorRealizedVol20m_1m: 0.017,
          executionHorizonMinutes: familyB.executionHorizonMinutes,
          normalizationVersionDigestHex: familyB.normalizationVersionDigestHex,
        });
        const settled = await runConcurrentPair(
          sqlA,
          sqlB,
          () =>
            persistForecastBundleV2(sqlA, {
              organizationId: orgA,
              packageId: persistedA.packageId,
              runId: "fv2-conc-cross",
              cycleId: "13",
              symbol: "BTCUSDT",
              anchorClosedBarEpochMs: 1_700_000_700_000,
              issuance: issuanceA,
            }),
          () =>
            persistForecastBundleV2(sqlB, {
              organizationId: orgB,
              packageId: persistedB.packageId,
              runId: "fv2-conc-cross",
              cycleId: "13",
              symbol: "BTCUSDT",
              anchorClosedBarEpochMs: 1_700_000_700_000,
              issuance: issuanceB,
            }),
        );
        expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
        const rA = (settled[0] as PromiseFulfilledResult<{ bundleId: string }>).value;
        const rB = (settled[1] as PromiseFulfilledResult<{ bundleId: string }>).value;
        expect(rA.bundleId).not.toBe(rB.bundleId);
        const counts = await sqlA<{ a: string; b: string }[]>`
          SELECT
            (SELECT count(*)::text FROM trader_forecast_bundle_v2 WHERE organization_id = ${orgA}::uuid AND run_id = 'fv2-conc-cross') AS a,
            (SELECT count(*)::text FROM trader_forecast_bundle_v2 WHERE organization_id = ${orgB}::uuid AND run_id = 'fv2-conc-cross') AS b
        `;
        expect(Number(counts[0]?.a)).toBe(1);
        expect(Number(counts[0]?.b)).toBe(1);
      } finally {
        await sqlA.end({ timeout: 5 });
        await sqlB.end({ timeout: 5 });
      }
    }, 180_000);
  },
);
