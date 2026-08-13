/**
 * DEE-527 — Forecast V2 package/bundle Postgres persistence roundtrip (opt-in).
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  persistForecastBundleV2,
  persistObjectiveForecastOutcomeResolutionV2,
  persistPredictivePackageV2,
  verifyPersistedForecastV2RoundTrip,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { cleanupForecastV2StorageRows } from "@/lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  buildPredictivePackageV1,
  issueForecastV1,
  verifyForecastDistributionReplayV1,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const WP518_PG_USER = "00000000-0000-4000-8000-000000051801";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

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

function buildFamily(): ReplicaRootFamilyInput {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
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
  "postgres forecast-v2 persistence service (DEE-527)",
  () => {
    let orgId: string;
    let sql: postgres.Sql;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP518_PG_USER);
      orgId = await seedWp13User(url!, WP518_PG_USER, "Forecast V2 Persistence");
      sql = postgres(url!, { max: 2 });
      await cleanupForecastV2StorageRows(sql, orgId);
    }, 600_000);

    beforeEach(async () => {
      await cleanupForecastV2StorageRows(sql, orgId);
    }, 120_000);

    afterAll(async () => {
      if (sql && orgId) {
        await cleanupForecastV2StorageRows(sql, orgId);
      }
      await sql?.end({ timeout: 10 });
      await cleanupWp13Org(url!, WP518_PG_USER);
    });

    it("persists package, replica artifacts, bundle and dual-role forecasts", async () => {
      const family = { ...buildFamily(), organizationId: orgId };
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgId,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });

      const issuance = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_360_000,
        anchorRealizedVol20m_1m: 0.015,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      verifyForecastDistributionReplayV1({
        issuance,
        expectedDistributionSemanticDigestExec: issuance.distributionSemanticDigestExec,
      });

      const bundle = await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-persist-run",
        cycleId: "0",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });

      const packageRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM trader_forecast_predictive_package_v2 WHERE organization_id = ${orgId}::uuid
      `;
      const artifactRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM trader_forecast_replica_artifact_v2 WHERE organization_id = ${orgId}::uuid
      `;
      const forecastRows = await sql<{ target_role_id: string }[]>`
        SELECT target_role_id FROM trader_forecast_v2 WHERE bundle_id = ${bundle.bundleId}::uuid
      `;

      expect(Number(packageRows[0]?.count ?? 0)).toBe(1);
      expect(Number(artifactRows[0]?.count ?? 0)).toBe(3);
      expect(forecastRows.map((r) => r.target_role_id).sort()).toEqual([
        "EXECUTION_OPPORTUNITY",
        "TERMINAL_RETURN",
      ]);

      const roundTrip = await verifyPersistedForecastV2RoundTrip({
        sql,
        organizationId: orgId,
        bundleId: bundle.bundleId,
        packageId: persistedPackage.packageId,
        issuance,
      });

      expect(roundTrip.replayDigestMatch).toBe(true);
      // Issuance seal: 7 Terminal scenarios; outcomes/calibration arrive later (append-only).
      expect(roundTrip.loadedDigests.terminalScenarioCount).toBe(7);
      expect(roundTrip.loadedDigests.calibrationObservationCount).toBe(0);
      expect(roundTrip.loadedDigests.replicaArtifactCount).toBe(3);

      const outcomeCount = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_forecast_outcome_v2
        WHERE organization_id = ${orgId}::uuid AND bundle_id = ${bundle.bundleId}::uuid
      `;
      expect(Number(outcomeCount[0]?.count ?? 0)).toBe(0);

      // DDL insert-legal value when outcomes absent — not a promotion lifecycle.
      const completeness = await sql<{ completeness_state: string }[]>`
        SELECT completeness_state
        FROM trader_forecast_bundle_v2
        WHERE organization_id = ${orgId}::uuid AND id = ${bundle.bundleId}::uuid
      `;
      expect(completeness[0]?.completeness_state).toBe("INCOMPLETE");

      const scenarios = await sql<
        {
          scenario_ordinal: number;
          lower_bound_scale8: string | null;
          upper_bound_scale8: string | null;
        }[]
      >`
        SELECT scenario_ordinal, lower_bound_scale8::text AS lower_bound_scale8,
               upper_bound_scale8::text AS upper_bound_scale8
        FROM trader_forecast_scenario_v2
        WHERE organization_id = ${orgId}::uuid AND forecast_id = ${bundle.terminalForecastId}::uuid
        ORDER BY scenario_ordinal
      `;
      expect(scenarios).toHaveLength(7);
      expect(scenarios[0]?.lower_bound_scale8).toBeNull();
      expect(scenarios[6]?.upper_bound_scale8).toBeNull();
      expect(scenarios[0]?.upper_bound_scale8).not.toBeNull();
      expect(scenarios[6]?.lower_bound_scale8).not.toBeNull();

      const buckets = await sql<
        {
          bucket_ordinal: number;
          tail_semantics: string;
          lower_bound_scale8: string | null;
          upper_bound_scale8: string | null;
        }[]
      >`
        SELECT bucket_ordinal, tail_semantics, lower_bound_scale8, upper_bound_scale8
        FROM trader_forecast_target_bucket_v2
        WHERE organization_id = ${orgId}::uuid
          AND target_definition_id = ${persistedPackage.terminalTargetDefinitionId}::uuid
        ORDER BY bucket_ordinal
      `;
      expect(buckets).toHaveLength(7);
      expect(buckets[0]?.tail_semantics).toBe("LOWER_TAIL");
      expect(buckets[0]?.lower_bound_scale8).toBeNull();
      expect(buckets[6]?.tail_semantics).toBe("UPPER_TAIL");
      expect(buckets[6]?.upper_bound_scale8).toBeNull();
      for (let i = 1; i <= 5; i += 1) {
        expect(buckets[i]?.tail_semantics).toBe("INTERIOR");
        expect(buckets[i]?.lower_bound_scale8).not.toBeNull();
        expect(buckets[i]?.upper_bound_scale8).not.toBeNull();
      }

      // Delayed objective resolution: append-only; no COMPLETE promotion required.
      const observedOutcomeDigestHex = createHash("sha256")
        .update("observed-outcome-terminal")
        .digest("hex");
      const contentDigestHex = createHash("sha256")
        .update("outcome-content-terminal")
        .digest("hex");
      const pitMeasurementIdentityDigestHex = createHash("sha256")
        .update("pit-measurement-terminal")
        .digest("hex");
      const eligibleIso = new Date(
        issuance.anchorClosedBarEpochMs + (family.primaryHorizonMinutes + 3) * 60_000 + 1,
      ).toISOString();
      await persistObjectiveForecastOutcomeResolutionV2(sql, {
        organizationId: orgId,
        bundleId: bundle.bundleId,
        forecastId: bundle.terminalForecastId,
        targetRoleId: "TERMINAL_RETURN",
        resolvedAtIso: eligibleIso,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        primaryHorizonMinutes: family.primaryHorizonMinutes,
        observedOutcomeDigestHex,
        contentDigestHex,
        pitMeasurementIdentityDigestHex,
      });
      const afterOutcome = await sql<{ completeness_state: string; count: string }[]>`
        SELECT b.completeness_state, count(o.forecast_id)::text AS count
        FROM trader_forecast_bundle_v2 b
        LEFT JOIN trader_forecast_outcome_v2 o
          ON o.bundle_id = b.id AND o.organization_id = b.organization_id
        WHERE b.organization_id = ${orgId}::uuid AND b.id = ${bundle.bundleId}::uuid
        GROUP BY b.completeness_state
      `;
      expect(afterOutcome[0]?.completeness_state).toBe("INCOMPLETE");
      expect(Number(afterOutcome[0]?.count ?? 0)).toBe(1);
    });

    it("natural-idempotent retry returns canonical existing bundle", async () => {
      const family = { ...buildFamily(), organizationId: orgId };
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgId,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      const issuance = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_360_000,
        anchorRealizedVol20m_1m: 0.015,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      const first = await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-idem-run",
        cycleId: "7",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });
      const second = await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-idem-run",
        cycleId: "7",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuance.anchorClosedBarEpochMs,
        issuance,
      });
      expect(second.retriedExisting).toBe(true);
      expect(second.bundleId).toBe(first.bundleId);
      const count = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_forecast_bundle_v2
        WHERE organization_id = ${orgId}::uuid
          AND run_id = 'fv2-idem-run'
          AND cycle_id = '7'
      `;
      expect(Number(count[0]?.count ?? 0)).toBe(1);
    });

    it("natural-idempotent conflict (same identity, different content) fails closed", async () => {
      const family = { ...buildFamily(), organizationId: orgId };
      const pkg = buildPredictivePackageV1({
        family,
        sourceCorpus: Array.from({ length: 120 }, (_, i) => anchor(i)),
        kConfigDec: 3,
        mConfigDec: 4,
      });
      const persistedPackage = await persistPredictivePackageV2(sql, pkg, {
        organizationId: orgId,
        kmGlobalAnchorSetDigestHex: "f".repeat(64),
      });
      const issuanceA = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_420_000,
        anchorRealizedVol20m_1m: 0.015,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      await persistForecastBundleV2(sql, {
        organizationId: orgId,
        packageId: persistedPackage.packageId,
        runId: "fv2-conflict-run",
        cycleId: "9",
        symbol: family.symbol,
        anchorClosedBarEpochMs: issuanceA.anchorClosedBarEpochMs,
        issuance: issuanceA,
      });
      const issuanceB = issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1_700_000_420_000,
        anchorRealizedVol20m_1m: 0.022,
        executionHorizonMinutes: family.executionHorizonMinutes,
        normalizationVersionDigestHex: family.normalizationVersionDigestHex,
      });
      await expect(
        persistForecastBundleV2(sql, {
          organizationId: orgId,
          packageId: persistedPackage.packageId,
          runId: "fv2-conflict-run",
          cycleId: "9",
          symbol: family.symbol,
          anchorClosedBarEpochMs: issuanceB.anchorClosedBarEpochMs,
          issuance: issuanceB,
        }),
      ).rejects.toThrow(/natural-idempotent conflict/);
    });
  },
);
