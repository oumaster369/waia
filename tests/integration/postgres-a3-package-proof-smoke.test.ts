/**
 * Non-authoritative cheap PostgreSQL package-surface proof smoke (DEE-518 A3).
 */

import { execSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import postgres from "postgres";

import { A3_CANONICAL_PACKAGE_TOTAL_COUNTS } from "@/lib/trader/intelligence/forecast-v2/a3-observed-package-surface-v1";
import { capturePostgresMeasurementEnvironment } from "@/lib/trader/intelligence/forecast-v2/a3-postgres-measurement-environment-v1";
import {
  assertObservedPackageSurfaceProof,
  queryObservedPackageSurfaceProof,
} from "@/lib/trader/intelligence/forecast-v2/a3-observed-package-surface-v1";
import {
  assertForecastV2TablesEmpty,
  insertA3FourCellPackageSurface,
  measurePackageFixedRelationBreakdown,
} from "@/lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1";
import { A3_REPO_ROOT } from "./a3-storage-scale-helpers";
import { seedWp13User, WP13_PG_USER_A } from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("A3 package-surface proof smoke", () => {
  it("observed package proof from real PostgreSQL", async () => {
    execSync("pnpm db:postgres:down", { cwd: A3_REPO_ROOT, stdio: "inherit" });
    execSync("pnpm db:postgres:bootstrap", {
      cwd: A3_REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL_POSTGRES: url },
    });

    const sql = postgres(url!, { max: 2, idle_timeout: 30 });
    try {
      const orgId = await seedWp13User(url!, WP13_PG_USER_A, "A3 package smoke");
      await assertForecastV2TablesEmpty(sql);
      await insertA3FourCellPackageSurface(sql, orgId);
      const observed = await queryObservedPackageSurfaceProof(sql, orgId);
      assertObservedPackageSurfaceProof(observed);
      const env = await capturePostgresMeasurementEnvironment(sql, A3_REPO_ROOT);
      const breakdown = await measurePackageFixedRelationBreakdown(sql);
      const packageFixedBytes = breakdown.reduce((acc, row) => acc + row.totalBytes, 0);

      expect(observed.totals.rawReplicaPayloadBytes).toBe(
        A3_CANONICAL_PACKAGE_TOTAL_COUNTS.rawReplicaPayloadBytes,
      );
      expect(breakdown.length).toBe(5);
      expect(env.postgresMeasurementEnvironmentDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(packageFixedBytes).toBeGreaterThan(0);
    } finally {
      await sql.end({ timeout: 10 });
    }
  }, 120_000);
});
