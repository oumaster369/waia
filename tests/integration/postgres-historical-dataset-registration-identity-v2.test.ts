/** Opt-in on two newly restored SYNTHETIC local seed databases only. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanonicalDecisionVerificationReceiptServiceV2 } from
  "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import { loadHistoricalSimulationBootstrapSourceSnapshotV2 } from
  "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";
import { historicalDatasetRegistrationIdentityV2 } from
  "@/lib/trader/historical-simulation-v2/dataset-registration-identity-v2";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

const enabled = process.env.WAIA_DEE954_LOCAL_PG === "1";
const urls = [process.env.WAIA_DEE954_DATABASE_A, process.env.WAIA_DEE954_DATABASE_B];
const seed = process.env.WAIA_DEE954_SEED_DIRECTORY ?? "";
if (enabled) {
  urls.forEach((raw, index) => {
    const url = new URL(raw ?? "");
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55446" ||
      url.username !== "waia946_test" || url.search || url.hash ||
      !new RegExp(`^/waia_hsv2_it_dee954_[a-z0-9]+_${index === 0 ? "a" : "b"}$`).test(url.pathname)) {
      throw new Error("DEE954_LOCAL_SYNTHETIC_DATABASE_REQUIRED");
    }
  });
  if (!/^\/private\/tmp\/waia-historical-repeat-pair-[A-Za-z0-9]+\/seed$/.test(seed) ||
      realpathSync(seed) !== seed) throw new Error("DEE954_PRIVATE_SEED_REQUIRED");
}
describe.skipIf(!enabled)("DEE-954 actual dataset registration PostgreSQL identity", () => {
  let a: postgres.Sql, b: postgres.Sql;
  type Service = ReturnType<typeof createCanonicalDecisionVerificationReceiptServiceV2>;
  let base: Parameters<Service["registerPreHoldoutDatasetAuthorityFromSource"]>[0];
  const priorSha = process.env.WAIA_RELEASE_SHA;
  beforeAll(async () => {
    const seal = JSON.parse(readFileSync(join(seed, "seed-seal.json"), "utf8"));
    const raw = readFileSync(join(seed, "metadata.json"));
    expect(createHash("sha256").update(raw).digest("hex")).toBe(seal.metadataSha256);
    const metadata = JSON.parse(raw.toString());
    const preflight = metadata.metadata.preflight;
    expect(preflight.organizationId).toBe("3c50b4e9-1138-43a5-a29f-e65088124cfc");
    expect(preflight.releaseSha).toBe("d".repeat(40));
    process.env.WAIA_RELEASE_SHA = preflight.releaseSha;
    base = { datasetRoot: preflight.datasetRoot, qualificationReceiptPath: preflight.qualificationReceiptPath,
      runtimeRequalificationReceiptPath: preflight.runtimeRequalificationReceiptPath,
      htxVolumeQualificationReceiptPath: preflight.htxVolumeQualificationReceiptPaths.BTCUSDT,
      releaseSha: preflight.releaseSha, organizationId: preflight.organizationId,
      runId: "dee-954-new", partition: "DEVELOPMENT", symbol: "BTCUSDT",
      initialRecordIndex: 239, cycleCount: 1 };
    a = postgres(urls[0]!, { max: 2 }); b = postgres(urls[1]!, { max: 2 });
    for (const sql of [a, b]) {
      const occupied = await sql`SELECT 1 FROM trader_historical_dataset_authority_v2
        WHERE run_id LIKE 'dee-954-%' LIMIT 1`;
      expect(occupied).toHaveLength(0);
    }
  });
  afterAll(async () => {
    await a?.end({ timeout: 5 }); await b?.end({ timeout: 5 });
    if (priorSha === undefined) delete process.env.WAIA_RELEASE_SHA;
    else process.env.WAIA_RELEASE_SHA = priorSha;
  });
  it("uses the same new identity across independently restored stores and exact retries", async () => {
    const first = await createCanonicalDecisionVerificationReceiptServiceV2(a)
      .registerPreHoldoutDatasetAuthorityFromSource(base);
    const second = await createCanonicalDecisionVerificationReceiptServiceV2(b)
      .registerPreHoldoutDatasetAuthorityFromSource(base);
    expect([...first.authorityIds]).toEqual([...second.authorityIds]);
    const retry = await createCanonicalDecisionVerificationReceiptServiceV2(a)
      .registerPreHoldoutDatasetAuthorityFromSource(base);
    expect([...retry.authorityIds]).toEqual([...first.authorityIds]);
    const [row] = await a`SELECT id::text, authority_content_digest_hex
      FROM trader_historical_dataset_authority_v2 WHERE run_id=${base.runId}`;
    expect(row!.id).toBe(historicalDatasetRegistrationIdentityV2({
      organizationId: base.organizationId, runId: base.runId, cycleId: first.cycleIds[0]!,
      authorityContentDigestHex: row!.authority_content_digest_hex,
    }));
  });
  // Initial deliberately constructed synthetic rows only; never UPDATE old rows.
  async function legacyFixture(runId: string, conflict: boolean) {
    const input = { ...base, runId };
    const snapshot = await loadHistoricalSimulationBootstrapSourceSnapshotV2(input);
    const { cycle, membership } = snapshot.sources[0]!;
    const digest = computeStableJsonDigest({ organizationId: base.organizationId, runId,
      membership, sealedCycle: cycle });
    const id = randomUUID();
    await a`INSERT INTO trader_historical_dataset_authority_v2 (
      id, organization_id, run_id, cycle_id, dataset_authority_class, dataset_authority_digest_hex,
      membership_content_digest_hex, sealed_cycle_content_digest_hex,
      membership_json, sealed_cycle_json, authority_content_digest_hex, schema_version
    ) VALUES (${id}::uuid, ${base.organizationId}::uuid, ${runId}, ${cycle.cycleId},
      ${membership.datasetAuthorityClass}, ${membership.datasetAuthorityDigestHex},
      ${membership.contentDigestHex}, ${cycle.contentDigestHex},
      ${JSON.stringify(membership)}::text::jsonb, ${JSON.stringify(cycle)}::text::jsonb,
      ${conflict ? "0".repeat(64) : digest}, 'waia.trader.historical_dataset_authority.v2')`;
    return { input, id, cycleId: cycle.cycleId };
  }
  it("keeps the existing random identity and exact immutable row on a legacy retry", async () => {
    const fixture = await legacyFixture("dee-954-legacy", false);
    const before = await a`SELECT row_to_json(t)::text AS raw FROM trader_historical_dataset_authority_v2 t
      WHERE id=${fixture.id}::uuid`;
    const result = await createCanonicalDecisionVerificationReceiptServiceV2(a)
      .registerPreHoldoutDatasetAuthorityFromSource(fixture.input);
    expect(result.authorityIds.get(fixture.cycleId)).toBe(fixture.id);
    expect(await a`SELECT row_to_json(t)::text AS raw FROM trader_historical_dataset_authority_v2 t
      WHERE id=${fixture.id}::uuid`).toEqual(before);
  });
  it("refuses a same-scope conflicting authority without overwriting it", async () => {
    const fixture = await legacyFixture("dee-954-conflict", true);
    const before = await a`SELECT row_to_json(t)::text AS raw FROM trader_historical_dataset_authority_v2 t
      WHERE id=${fixture.id}::uuid`;
    await expect(createCanonicalDecisionVerificationReceiptServiceV2(a)
      .registerPreHoldoutDatasetAuthorityFromSource(fixture.input)).rejects.toThrow("HISTORICAL_DATASET_AUTHORITY_CONFLICT");
    expect(await a`SELECT row_to_json(t)::text AS raw FROM trader_historical_dataset_authority_v2 t
      WHERE id=${fixture.id}::uuid`).toEqual(before);
  });
});
