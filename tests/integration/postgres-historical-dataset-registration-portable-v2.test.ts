/** DEE-962: real registration on fresh migrated stores; synthetic upstream
 * receipt and three bars only. This is NOT scientific/full-corpus qualification. */
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanonicalDecisionVerificationReceiptServiceV2 } from
  "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import { loadHistoricalSimulationBootstrapSourceSnapshotV2 } from
  "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";
import { historicalDatasetRegistrationIdentityV2 } from
  "@/lib/trader/historical-simulation-v2/dataset-registration-identity-v2";
import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { qualifyHtxKlineVolumeAuthority } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import type { FhvPreHoldoutQualificationReceiptV1 } from
  "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const inputUrl = process.env.DATABASE_URL_POSTGRES?.trim();
if (enabled) {
  const url = new URL(inputUrl ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search || url.hash ||
      url.port === "6543" || !/^\/(?:waia_it|waia_validate|waia_hsv2_it(?:_[a-z0-9]+)*)$/.test(url.pathname)) {
    throw new Error("DEE962_LOCAL_DISPOSABLE_POSTGRES_REQUIRED");
  }
}

describe.skipIf(!enabled)("DEE-962 portable PostgreSQL dataset registration (synthetic upstream)", () => {
  const organizationId = randomUUID(), userId = randomUUID();
  const releaseSha = "d".repeat(40), runId = `dee-962-${randomUUID()}`;
  const databaseNames: string[] = [];
  const stores: postgres.Sql[] = [];
  const priorReleaseSha = process.env.WAIA_RELEASE_SHA;
  let admin: postgres.Sql | undefined;
  let root = "";
  type Service = ReturnType<typeof createCanonicalDecisionVerificationReceiptServiceV2>;
  let base: Parameters<Service["registerPreHoldoutDatasetAuthorityFromSource"]>[0];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "waia-dee962-registration-"));
    const bars = [0, 1, 2].map(index => ({ symbol: "BTC/USDT" as const, interval: "1m" as const,
      open: "100", high: "103", low: "99", close: String(100 + index), volume: "10",
      barOpenTime: `2025-01-01T00:0${index}:00.000Z`,
      barCloseTime: `2025-01-01T00:0${index + 1}:00.000Z` }));
    const raw = bars.map(bar => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join("");
    const directory = join(root, "partitions", "development", "BTCUSDT");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "bars.v2.ndjson"), raw);
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const interval = { startUtc: bars[0]!.barOpenTime, endUtc: bars[2]!.barCloseTime };
    // This test supplies the upstream qualification boundary, like the existing
    // first-cycle fixture. Real receipt parsing, hashing, source loading, volume
    // qualification, cycle sealing and registration run without mocks.
    const body: Omit<FhvPreHoldoutQualificationReceiptV1, "qualificationReceiptDigest"> = {
      schemaVersion: "fhv-pre-holdout-qualification-receipt/v1",
      qualificationMode: "OFFICIAL_PRE_HOLDOUT_REAL_DATA", classification: "PRE_HOLDOUT_QUALIFICATION=PASS",
      releaseSha, organizationId, operatorId: "dee-962-synthetic-upstream-fixture",
      sourceCapabilityEvidenceDigest: sha("synthetic capability"),
      canonicalBoundaries: { development: interval, walkForward: interval,
        wfPredictive: interval, wfEconomic: interval },
      interval: "1m", symbols: ["BTCUSDT"], acquisitionReceiptDigests: [sha("synthetic acquisition")],
      partitions: [{ partition: "development", symbol: "BTCUSDT",
        acquisitionReceiptDigest: sha("synthetic acquisition"), rawSha256: sha(raw),
        semanticContentDigest: computeStableJsonDigest(bars), barCount: bars.length,
        expectedBarCount: bars.length, firstBarOpen: interval.startUtc, lastBarClose: interval.endUtc,
        gapDuplicateIntegrity: "PASS", normalizationIdentity: "dee-962-synthetic-fixture",
        pageCount: 1, retryCount: 0 }],
      scientificSubpartitions: [], developmentContentDigest: sha("synthetic development"),
      wfPredictiveContentDigest: sha("synthetic predictive"), wfEconomicContentDigest: sha("synthetic economic"),
      developmentWalkForwardContentDigest: sha("synthetic union"),
      walkForwardUnionCompatibilityDigest: sha("synthetic compatibility"),
      holdout: { canonicalBoundary: interval, status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED",
        sourceCapabilityEvidenceDigest: sha("synthetic capability") },
      revisionRiskEvidence: [], revisionRiskDisposition: "SAME", qualifiedAtUtc: interval.startUtc,
    };
    const qualificationReceiptPath = join(root, "qualification.json");
    writeFileSync(qualificationReceiptPath, JSON.stringify({ ...body,
      qualificationReceiptDigest: computeStableJsonDigest(body) }));
    const htxVolumeQualificationReceiptPath = join(root, "volume.json");
    writeFileSync(htxVolumeQualificationReceiptPath, JSON.stringify(qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT", qualifiedAtUtc: interval.startUtc,
      rows: [{ id: 1, open: 100, high: 103, low: 99, close: 100, amount: 10, vol: 1000, count: 1 }],
    })));
    base = { datasetRoot: root, qualificationReceiptPath,
      runtimeRequalificationReceiptPath: join(root, "unused-runtime.json"), htxVolumeQualificationReceiptPath,
      releaseSha, organizationId, runId, partition: "DEVELOPMENT", symbol: "BTCUSDT",
      initialRecordIndex: 1, cycleCount: 2 };
    process.env.WAIA_RELEASE_SHA = releaseSha;
    admin = postgres(inputUrl!, { max: 1, onnotice: () => {} });
    // Independent empty databases, each using the actual complete migration
    // chain. No seed restores, copied tables, disabled triggers or RLS changes.
    for (const side of ["a", "b"]) {
      const name = `waia_hsv2_it_dee962_${randomUUID().replaceAll("-", "")}_${side}`;
      await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE template0`);
      databaseNames.push(name);
      const url = new URL(inputUrl!); url.pathname = `/${name}`;
      const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
      stores.push(sql);
      await sql.unsafe(readFileSync("scripts/postgres-validation/prelude-auth-stub.sql", "utf8")).simple();
      await migrate(drizzle(sql), { migrationsFolder: "db/migrations_postgres" });
      expect(await sql`SELECT id FROM trader_historical_dataset_authority_v2`).toHaveLength(0);
      await sql`INSERT INTO auth.users(id) VALUES (${userId}::uuid)`;
      await sql`INSERT INTO users(id,identity_label,email)
        VALUES (${userId}::uuid,'DEE-962 synthetic registration',${`${userId}@invalid.local`})`;
      await sql`INSERT INTO organizations(id,owner_user_id,kind,name)
        VALUES (${organizationId}::uuid,${userId}::uuid,'personal','DEE-962 synthetic registration')`;
    }
  }, 120_000);

  afterAll(async () => {
    try {
      for (const sql of stores) await sql.end({ timeout: 5 });
      // Only databases successfully created by this invocation can be dropped.
      for (const name of databaseNames) await admin!.unsafe(`DROP DATABASE ${name}`);
    } finally {
      await admin?.end({ timeout: 5 });
      if (root) rmSync(root, { recursive: true, force: true });
      if (priorReleaseSha === undefined) delete process.env.WAIA_RELEASE_SHA;
      else process.env.WAIA_RELEASE_SHA = priorReleaseSha;
    }
  }, 30_000);

  it("inserts the same new IDs independently and preserves exact retries after reconnect", async () => {
    const first = await createCanonicalDecisionVerificationReceiptServiceV2(stores[0]!)
      .registerPreHoldoutDatasetAuthorityFromSource(base);
    const second = await createCanonicalDecisionVerificationReceiptServiceV2(stores[1]!)
      .registerPreHoldoutDatasetAuthorityFromSource(base);
    expect(first.cycleIds).toHaveLength(2);
    expect([...second.authorityIds]).toEqual([...first.authorityIds]);
    const before = await stores[0]!`SELECT row_to_json(t)::text AS raw
      FROM trader_historical_dataset_authority_v2 t WHERE run_id=${runId} ORDER BY cycle_id`;
    const url = new URL(inputUrl!); url.pathname = `/${databaseNames[0]}`;
    const reconnected = postgres(url.toString(), { max: 1 });
    try {
      const retried = await createCanonicalDecisionVerificationReceiptServiceV2(reconnected)
        .registerPreHoldoutDatasetAuthorityFromSource(base);
      expect([...retried.authorityIds]).toEqual([...first.authorityIds]);
      expect(await reconnected`SELECT row_to_json(t)::text AS raw
        FROM trader_historical_dataset_authority_v2 t WHERE run_id=${runId} ORDER BY cycle_id`).toEqual(before);
      for (const row of await reconnected`SELECT id::text,cycle_id,authority_content_digest_hex
        FROM trader_historical_dataset_authority_v2 WHERE run_id=${runId}`) {
        expect(row.id).toBe(historicalDatasetRegistrationIdentityV2({ organizationId, runId,
          cycleId: row.cycle_id, authorityContentDigestHex: row.authority_content_digest_hex }));
      }
    } finally { await reconnected.end({ timeout: 5 }); }
  });

  async function legacyFixture(conflict: boolean) {
    const input = { ...base, runId: `${runId}-${conflict ? "conflict" : "legacy"}`, cycleCount: 1 };
    const { sources: [{ cycle, membership }] } = await loadHistoricalSimulationBootstrapSourceSnapshotV2(input);
    const digest = computeStableJsonDigest({ organizationId, runId: input.runId, membership, sealedCycle: cycle });
    const id = randomUUID();
    await stores[0]!`INSERT INTO trader_historical_dataset_authority_v2 (
      id,organization_id,run_id,cycle_id,dataset_authority_class,dataset_authority_digest_hex,
      membership_content_digest_hex,sealed_cycle_content_digest_hex,membership_json,sealed_cycle_json,
      authority_content_digest_hex,schema_version
    ) VALUES (${id}::uuid,${organizationId}::uuid,${input.runId},${cycle.cycleId},
      ${membership.datasetAuthorityClass},${membership.datasetAuthorityDigestHex},${membership.contentDigestHex},
      ${cycle.contentDigestHex},${JSON.stringify(membership)}::text::jsonb,${JSON.stringify(cycle)}::text::jsonb,
      ${conflict ? "0".repeat(64) : digest},'waia.trader.historical_dataset_authority.v2')`;
    return { input, id, cycleId: cycle.cycleId };
  }

  it("retains a legacy random ID and every immutable field on exact retry", async () => {
    const fixture = await legacyFixture(false);
    const before = await stores[0]!`SELECT row_to_json(t)::text AS raw
      FROM trader_historical_dataset_authority_v2 t WHERE id=${fixture.id}::uuid`;
    const result = await createCanonicalDecisionVerificationReceiptServiceV2(stores[0]!)
      .registerPreHoldoutDatasetAuthorityFromSource(fixture.input);
    expect(result.authorityIds.get(fixture.cycleId)).toBe(fixture.id);
    expect(await stores[0]!`SELECT row_to_json(t)::text AS raw
      FROM trader_historical_dataset_authority_v2 t WHERE id=${fixture.id}::uuid`).toEqual(before);
  });

  it("rejects a same-scope conflicting authority without overwriting the row", async () => {
    const fixture = await legacyFixture(true);
    const before = await stores[0]!`SELECT row_to_json(t)::text AS raw
      FROM trader_historical_dataset_authority_v2 t WHERE id=${fixture.id}::uuid`;
    await expect(createCanonicalDecisionVerificationReceiptServiceV2(stores[0]!)
      .registerPreHoldoutDatasetAuthorityFromSource(fixture.input)).rejects.toThrow("HISTORICAL_DATASET_AUTHORITY_CONFLICT");
    expect(await stores[0]!`SELECT row_to_json(t)::text AS raw
      FROM trader_historical_dataset_authority_v2 t WHERE id=${fixture.id}::uuid`).toEqual(before);
  });
});
