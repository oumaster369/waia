import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCanonicalDecisionVerificationReceiptServiceV2,
  historicalDatasetAuthorityRunLockKeyV2,
} from
  "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import type { FhvPreHoldoutQualificationReceiptV1 } from
  "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { qualifyHtxKlineVolumeAuthority } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { TEST_ONLY_loadKmFourSurfaceDurableDatasetAuthorityV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2";
import {
  TEST_ONLY_assertKmFourSurfaceProductionRunUnusedV2,
  TEST_ONLY_withKmFourSurfaceProductionSessionLockV2,
} from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2";

const explicitlyEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const parsed = (() => {
  try { return url ? new URL(url) : null; } catch { return null; }
})();
const databaseName = parsed?.pathname.replace(/^\//, "") ?? "";
const disposable = Boolean(
  parsed && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
  ["waia_it", "waia_validate"].includes(databaseName),
);

if (explicitlyEnabled && url && !disposable) {
  throw new Error(
    "DEE917_PG_INTEGRATION_REFUSED: requires local disposable waia_it/waia_validate; production mutation is forbidden",
  );
}

const RELEASE_SHA = "9".repeat(40);
const QUALIFIED_AT = "2026-08-01T00:00:00.000Z";
const DIGESTS = ["1", "2", "3", "4", "5", "6", "7", "8"].map((value) =>
  value.repeat(64));

type Fixture = Readonly<{
  root: string;
  qualificationReceiptPath: string;
  volumePaths: Readonly<Record<"BTCUSDT" | "ETHUSDT", string>>;
  partitionRawSha256Hex: Readonly<Record<"BTCUSDT" | "ETHUSDT", string>>;
  qualificationReceiptDigestHex: string;
}>;

function createFixture(organizationId: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "dee-917-pg-integration-"));
  const partitionRawSha256Hex = {} as Record<"BTCUSDT" | "ETHUSDT", string>;
  const partitions: FhvPreHoldoutQualificationReceiptV1["partitions"][number][] = [];
  const volumePaths = {} as Record<"BTCUSDT" | "ETHUSDT", string>;

  for (const [symbolIndex, symbol] of (["BTCUSDT", "ETHUSDT"] as const).entries()) {
    const instrument = symbol === "BTCUSDT" ? "BTC/USDT" as const : "ETH/USDT" as const;
    const bars = [0, 1, 2, 3].map((index) => ({
      symbol: instrument,
      interval: "1m" as const,
      open: String(100 + symbolIndex * 10 + index),
      high: "200",
      low: "90",
      close: String(101 + symbolIndex * 10 + index),
      volume: "10",
      barOpenTime: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      barCloseTime: new Date(Date.UTC(2026, 0, 1, 0, index + 1)).toISOString(),
    }));
    const raw = bars.map((bar) =>
      serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join("");
    const directory = join(root, "partitions", "development", symbol);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "bars.v2.ndjson"), raw);
    partitionRawSha256Hex[symbol] = createHash("sha256").update(raw).digest("hex");
    partitions.push({
      partition: "development",
      symbol,
      acquisitionReceiptDigest: DIGESTS[symbolIndex]!,
      rawSha256: partitionRawSha256Hex[symbol],
      semanticContentDigest: DIGESTS[symbolIndex + 2]!,
      barCount: bars.length,
      expectedBarCount: bars.length,
      firstBarOpen: bars[0]!.barOpenTime,
      lastBarClose: bars.at(-1)!.barCloseTime,
      gapDuplicateIntegrity: "PASS",
      normalizationIdentity: "fhv-bars-v2-test-fixture",
      pageCount: 1,
      retryCount: 0,
    });
    const volume = qualifyHtxKlineVolumeAuthority({
      symbol,
      qualifiedAtUtc: QUALIFIED_AT,
      rows: [{ id: 1, open: 100, high: 200, low: 90, close: 101,
        amount: 10, vol: 1_010, count: 1 }],
    });
    volumePaths[symbol] = join(root, `${symbol}.volume.json`);
    writeFileSync(volumePaths[symbol], JSON.stringify(volume));
  }

  const body: Omit<FhvPreHoldoutQualificationReceiptV1,
    "qualificationReceiptDigest"> = {
    schemaVersion: "fhv-pre-holdout-qualification-receipt/v1",
    qualificationMode: "OFFICIAL_PRE_HOLDOUT_REAL_DATA",
    classification: "PRE_HOLDOUT_QUALIFICATION=PASS",
    releaseSha: RELEASE_SHA,
    organizationId,
    operatorId: "dee-917-postgres-integration",
    sourceCapabilityEvidenceDigest: DIGESTS[4]!,
    canonicalBoundaries: {
      development: { startUtc: "2026-01-01T00:00:00.000Z", endUtc: "2026-01-01T00:04:00.000Z" },
      walkForward: { startUtc: "2026-02-01T00:00:00.000Z", endUtc: "2026-02-01T00:04:00.000Z" },
      wfPredictive: { startUtc: "2026-02-01T00:00:00.000Z", endUtc: "2026-02-01T00:02:00.000Z" },
      wfEconomic: { startUtc: "2026-02-01T00:02:00.000Z", endUtc: "2026-02-01T00:04:00.000Z" },
    },
    interval: "1m",
    symbols: ["BTCUSDT", "ETHUSDT"],
    acquisitionReceiptDigests: [DIGESTS[0]!, DIGESTS[1]!],
    partitions,
    scientificSubpartitions: [],
    developmentContentDigest: DIGESTS[5]!,
    wfPredictiveContentDigest: DIGESTS[6]!,
    wfEconomicContentDigest: DIGESTS[7]!,
    developmentWalkForwardContentDigest: "a".repeat(64),
    walkForwardUnionCompatibilityDigest: "b".repeat(64),
    holdout: {
      canonicalBoundary: {
        startUtc: "2027-01-01T00:00:00.000Z",
        endUtc: "2027-02-01T00:00:00.000Z",
      },
      status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED",
      sourceCapabilityEvidenceDigest: DIGESTS[4]!,
    },
    revisionRiskEvidence: [],
    revisionRiskDisposition: "SAME",
    qualifiedAtUtc: QUALIFIED_AT,
  };
  const receipt: FhvPreHoldoutQualificationReceiptV1 = {
    ...body,
    qualificationReceiptDigest: computeStableJsonDigest(body),
  };
  const qualificationReceiptPath = join(root, "qualification.json");
  writeFileSync(qualificationReceiptPath, JSON.stringify(receipt));
  return Object.freeze({
    root,
    qualificationReceiptPath,
    volumePaths: Object.freeze(volumePaths),
    partitionRawSha256Hex: Object.freeze(partitionRawSha256Hex),
    qualificationReceiptDigestHex: receipt.qualificationReceiptDigest,
  });
}

function registrationInput(input: Readonly<{
  fixture: Fixture;
  organizationId: string;
  runId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  initialRecordIndex?: number;
  cycleCount?: number;
}>) {
  return {
    datasetRoot: input.fixture.root,
    qualificationReceiptPath: input.fixture.qualificationReceiptPath,
    runtimeRequalificationReceiptPath: join(input.fixture.root, "runtime-unused.json"),
    htxVolumeQualificationReceiptPath: input.fixture.volumePaths[input.symbol],
    releaseSha: RELEASE_SHA,
    organizationId: input.organizationId,
    runId: input.runId,
    partition: "DEVELOPMENT" as const,
    symbol: input.symbol,
    initialRecordIndex: input.initialRecordIndex ?? 0,
    cycleCount: input.cycleCount ?? 2,
  };
}

describe.skipIf(!explicitlyEnabled || !url || !disposable)(
  "DEE-917 production authority PostgreSQL integration",
  () => {
    const sql = postgres(url!, { max: 6 });
    const userId = randomUUID();
    const organizationId = randomUUID();
    let fixture: Fixture;

    beforeAll(async () => {
      const migrated = await sql<{ relation: string | null; authority_class: string | null }[]>`
        SELECT to_regclass('public.trader_historical_dataset_authority_v2')::text AS relation,
          (SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='trader_historical_dataset_authority_v2'
             AND column_name='dataset_authority_class') AS authority_class
      `;
      expect(migrated[0]).toEqual({
        relation: "trader_historical_dataset_authority_v2",
        authority_class: "dataset_authority_class",
      });
      await sql`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
      await sql`INSERT INTO users (id, identity_label, email)
        VALUES (${userId}::uuid, 'DEE-917 PostgreSQL integration',
          ${`dee-917-${userId}@invalid.local`})`;
      await sql`INSERT INTO organizations (id, owner_user_id, kind, name)
        VALUES (${organizationId}::uuid, ${userId}::uuid, 'personal',
          'DEE-917 PostgreSQL integration')`;
      fixture = createFixture(organizationId);
    });

    afterAll(async () => {
      if (fixture?.root) rmSync(fixture.root, { recursive: true, force: true });
      await sql.end({ timeout: 5 });
    });

    it("canonically registers both surfaces, retries a partial registration idempotently, and loads the exact durable set", async () => {
      const runId = `dee-917-idempotent-${randomUUID()}`;
      const service = createCanonicalDecisionVerificationReceiptServiceV2(sql);
      const btcInput = registrationInput({ fixture, organizationId, runId, symbol: "BTCUSDT" });
      const btcFirst = await service.registerPreHoldoutDatasetAuthorityFromSource(btcInput);
      const btcRetry = await service.registerPreHoldoutDatasetAuthorityFromSource(btcInput);
      const eth = await service.registerPreHoldoutDatasetAuthorityFromSource(
        registrationInput({ fixture, organizationId, runId, symbol: "ETHUSDT" }),
      );

      expect([...btcRetry.authorityIds]).toEqual([...btcFirst.authorityIds]);
      expect(eth.authorityIds.size).toBe(2);
      const durable = await TEST_ONLY_loadKmFourSurfaceDurableDatasetAuthorityV2(sql, {
        organizationId,
        runId,
      });
      const expectedCycleIds = (["BTCUSDT", "ETHUSDT"] as const).flatMap((symbol) =>
        [0, 1].map((index) => `${runId}:DEVELOPMENT:${symbol}:${index}`)).sort();
      expect(durable.cycleIds).toEqual(expectedCycleIds);
      expect(durable.authorityRowCount).toBe(4);
      expect(durable.qualificationReceiptDigestHex)
        .toBe(fixture.qualificationReceiptDigestHex);
      expect(durable.developmentPartitionRawSha256Hex)
        .toEqual(fixture.partitionRawSha256Hex);

      await expect(service.registerPreHoldoutDatasetAuthorityFromSource(registrationInput({
        fixture,
        organizationId,
        runId,
        symbol: "BTCUSDT",
        initialRecordIndex: 1,
      }))).rejects.toThrow("HISTORICAL_DATASET_AUTHORITY_RANGE_CONFLICT");
      const rows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM trader_historical_dataset_authority_v2
        WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
      `;
      expect(rows[0]?.count).toBe("4");
    });

    it("serializes concurrent differing ranges on the shared org/run lock and refuses the loser", async () => {
      const runId = `dee-917-concurrent-${randomUUID()}`;
      const competingSql = postgres(url!, {
        max: 1,
        connection: { application_name: `dee917-${runId}` },
      });
      let competing: Promise<unknown> | undefined;
      try {
        await TEST_ONLY_withKmFourSurfaceProductionSessionLockV2(sql, {
          organizationId,
          runId,
        }, async (connection) => {
          competing = createCanonicalDecisionVerificationReceiptServiceV2(competingSql)
            .registerPreHoldoutDatasetAuthorityFromSource(registrationInput({
              fixture,
              organizationId,
              runId,
              symbol: "BTCUSDT",
              initialRecordIndex: 1,
            }));
          let advisoryWaitObserved = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const waits = await sql<{ wait_event_type: string | null; wait_event: string | null }[]>`
              SELECT wait_event_type, wait_event FROM pg_stat_activity
              WHERE application_name=${`dee917-${runId}`}
            `;
            if (waits.some((row) =>
              row.wait_event_type === "Lock" && row.wait_event === "advisory")) {
              advisoryWaitObserved = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(advisoryWaitObserved).toBe(true);
          await createCanonicalDecisionVerificationReceiptServiceV2(connection)
            .registerPreHoldoutDatasetAuthorityFromSource(registrationInput({
              fixture,
              organizationId,
              runId,
              symbol: "BTCUSDT",
            }));
        });
        await expect(competing).rejects.toThrow("HISTORICAL_DATASET_AUTHORITY_RANGE_CONFLICT");
        const held = await sql<{ held: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype='advisory' AND granted
              AND objid=(hashtextextended(${historicalDatasetAuthorityRunLockKeyV2({
                organizationId,
                runId,
              })},0) & 4294967295)::oid
          ) AS held
        `;
        expect(held[0]?.held).toBe(false);
      } finally {
        await competing?.catch(() => undefined);
        await competingSql.end({ timeout: 5 });
      }
    });

    it("refuses start and preregistration races on the final real-SQL unused-run check", async () => {
      const preregisteredRunId = `dee-917-preregistered-${randomUUID()}`;
      const startedRunId = `dee-917-started-${randomUUID()}`;
      const reserved = await sql.reserve();
      const connection = reserved as unknown as postgres.Sql;
      try {
        await TEST_ONLY_assertKmFourSurfaceProductionRunUnusedV2(connection, {
          organizationId,
          runId: preregisteredRunId,
        });
        await connection`
          CREATE TEMP TABLE trader_dee659_authority_preregistration_v2 (
            organization_id uuid NOT NULL,
            run_id text NOT NULL
          ) ON COMMIT PRESERVE ROWS
        `;
        await connection`
          CREATE TEMP TABLE trader_historical_simulation_run_start_v2 (
            organization_id uuid NOT NULL,
            run_id text NOT NULL
          ) ON COMMIT PRESERVE ROWS
        `;
        await connection`
          INSERT INTO trader_dee659_authority_preregistration_v2 (organization_id, run_id)
          VALUES (${organizationId}::uuid, ${preregisteredRunId})
        `;
        await expect(TEST_ONLY_assertKmFourSurfaceProductionRunUnusedV2(connection, {
          organizationId,
          runId: preregisteredRunId,
        })).rejects.toThrow("RUN_ALREADY_CONSUMED");

        await connection`
          INSERT INTO trader_historical_simulation_run_start_v2 (organization_id, run_id)
          VALUES (${organizationId}::uuid, ${startedRunId})
        `;
        await expect(TEST_ONLY_assertKmFourSurfaceProductionRunUnusedV2(connection, {
          organizationId,
          runId: startedRunId,
        })).rejects.toThrow("RUN_ALREADY_CONSUMED");
      } finally {
        await connection`
          DROP TABLE IF EXISTS pg_temp.trader_dee659_authority_preregistration_v2,
            pg_temp.trader_historical_simulation_run_start_v2
        `;
        reserved.release();
      }
    });
  },
);
