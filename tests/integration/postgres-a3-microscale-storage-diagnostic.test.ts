/**
 * NON_AUTHORITATIVE_MICROSCALE_STORAGE_DIAGNOSTIC
 *
 * Opt-in: WAIA_PG_INTEGRATION=1 WAIA_A3_MICROSCALE=1
 * Does NOT run N=200000 / PHASE-02 / PHASE-03 / R5.
 */
import { execSync } from "node:child_process";
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";
import postgres from "postgres";

import { parseA3MicroscaleNs } from "@/lib/trader/intelligence/forecast-v2/a3-microscale-ns-parse-v1";
import {
  FORECAST_V2_PACKAGE_FIXED_TABLES,
  assertForecastV2TablesEmpty,
  runForecastV2StorageScalePhase01,
} from "@/lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1";
import { A3_REPO_ROOT } from "./a3-storage-scale-helpers";
import { seedWp13User, WP13_PG_USER_A } from "./wp13-intelligence-test-helpers";

const integrationEnabled =
  process.env.WAIA_PG_INTEGRATION === "1" && process.env.WAIA_A3_MICROSCALE === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const MARKER = "NON_AUTHORITATIVE_MICROSCALE_STORAGE_DIAGNOSTIC";

const PROPORTIONAL_TABLES = [
  "trader_forecast_bundle_v2",
  "trader_forecast_v2",
  "trader_forecast_outcome_v2",
  "trader_forecast_calibration_observation_v2",
  "trader_forecast_scenario_v2",
] as const;

function recreateValidationPostgres(): void {
  execSync("pnpm db:postgres:down", { cwd: A3_REPO_ROOT, stdio: "inherit" });
  execSync("pnpm db:postgres:bootstrap", {
    cwd: A3_REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL_POSTGRES: url },
  });
}

function sumBytes(
  rows: readonly { relname: string; totalBytes: number; tableBytes: number; indexBytes: number }[],
  tables: readonly string[],
): { total: number; table: number; index: number; byRel: Record<string, number> } {
  const set = new Set(tables);
  let total = 0;
  let table = 0;
  let index = 0;
  const byRel: Record<string, number> = {};
  for (const row of rows) {
    if (!set.has(row.relname)) continue;
    total += row.totalBytes;
    table += row.tableBytes;
    index += row.indexBytes;
    byRel[row.relname] = row.totalBytes;
  }
  return { total, table, index, byRel };
}

describe.skipIf(!integrationEnabled || !url)(
  "A3 NON_AUTHORITATIVE_MICROSCALE_STORAGE_DIAGNOSTIC",
  () => {
    it(
      "measures N=1000..50000 proportional bytes/bundle on fresh DBs",
      async () => {
        const ns = parseA3MicroscaleNs(process.env.A3_MICROSCALE_NS);
        const results: Array<{
          n: number;
          b0: number;
          b1: number;
          proportionalDelta: number;
          bytesPerBundleExact: string;
          bytesPerBundleNumber: number;
          tableBytesPerBundle: number;
          indexBytesPerBundle: number;
          relationDelta: Record<string, number>;
          runtimeMs: number;
          serverVersion: string;
          blockSize: string;
        }> = [];

        for (const n of ns) {
          console.log(`[${MARKER}] starting N=${n}`);
          const started = performance.now();
          recreateValidationPostgres();
          const sql = postgres(url!, { max: 4, idle_timeout: 30 });
          try {
            const orgId = await seedWp13User(url!, WP13_PG_USER_A, `A3 microscale N=${n}`);
            await assertForecastV2TablesEmpty(sql);
            const measured = await runForecastV2StorageScalePhase01(sql, orgId, n, A3_REPO_ROOT, {
              runId: `A3-MICROSCALE-N${n}`,
            });
            const b0Prop = sumBytes(measured.b0RelationBreakdown, PROPORTIONAL_TABLES);
            const b1Prop = sumBytes(measured.b1RelationBreakdown, PROPORTIONAL_TABLES);
            const proportionalDelta = b1Prop.total - b0Prop.total;
            const tableDelta = b1Prop.table - b0Prop.table;
            const indexDelta = b1Prop.index - b0Prop.index;
            const relationDelta: Record<string, number> = {};
            for (const name of PROPORTIONAL_TABLES) {
              relationDelta[name] = (b1Prop.byRel[name] ?? 0) - (b0Prop.byRel[name] ?? 0);
            }
            const num = BigInt(proportionalDelta);
            const den = BigInt(n);
            const result = {
              n,
              b0: measured.b0Bytes,
              b1: measured.b1Bytes,
              proportionalDelta,
              bytesPerBundleExact: `${num.toString()}/${den.toString()}`,
              bytesPerBundleNumber: Number(num) / Number(den),
              tableBytesPerBundle: tableDelta / n,
              indexBytesPerBundle: indexDelta / n,
              relationDelta,
              runtimeMs: performance.now() - started,
              serverVersion: measured.postgresMeasurementEnvironment.serverVersion,
              blockSize: measured.postgresMeasurementEnvironment.blockSize,
            };
            results.push(result);
            console.log(JSON.stringify({ marker: MARKER, result }, null, 2));
            expect(measured.postgresMeasurementEnvironment.serverVersion).not.toBe("unknown");
            expect(measured.postgresMeasurementEnvironment.blockSize).not.toBe("unknown");
            expect(measured.rowCounts.trader_forecast_scenario_v2).toBe(n * 7);
          } finally {
            await sql.end({ timeout: 30 });
          }
        }

        const largest = results[results.length - 1]!;
        console.log(
          JSON.stringify(
            {
              marker: MARKER,
              summary: {
                results: results.map((r) => ({
                  n: r.n,
                  b0: r.b0,
                  b1: r.b1,
                  bytesPerBundleExact: r.bytesPerBundleExact,
                  bytesPerBundleNumber: r.bytesPerBundleNumber,
                  marginVs4096: 4096 - r.bytesPerBundleNumber,
                  tableBytesPerBundle: r.tableBytesPerBundle,
                  indexBytesPerBundle: r.indexBytesPerBundle,
                  runtimeMs: r.runtimeMs,
                  relationDelta: r.relationDelta,
                })),
                largestN: largest.n,
                largestBytesPerBundle: largest.bytesPerBundleNumber,
                largestMarginVs4096: 4096 - largest.bytesPerBundleNumber,
                microscaleGoCriterion3800: largest.bytesPerBundleNumber <= 3800,
                packageFixedTables: FORECAST_V2_PACKAGE_FIXED_TABLES,
                note: "NOT final authority; no STORAGE_ACCEPTANCE_PASS; PHASE-02 not run",
              },
            },
            null,
            2,
          ),
        );

        // Explicit override (e.g. A3_MICROSCALE_NS=50000) requires exactly those N values.
        // Default multi-N list remains valid without a minimum-length fiction.
        expect(results.map((r) => r.n)).toEqual(ns);
        expect(largest.n).toBe(ns[ns.length - 1]);
      },
      3 * 60 * 60 * 1000,
    );
  },
);
