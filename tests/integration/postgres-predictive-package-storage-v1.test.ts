import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withPostgresSessionTransaction } from "@/db/postgres-session-transaction";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { buildPredictivePackageV1 } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { persistPredictivePackageV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { SAMPLER_CONTRACT_VERSION, QUANTIZER_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { encodePredictivePackageV1 } from "@/lib/trader/intelligence/forecast-v2/predictive-package-codec-v1";
import {
  hydratePredictivePackageStorageV1,
  persistPredictivePackageStorageV1,
} from "@/lib/trader/intelligence/forecast-v2/predictive-package-storage-postgres-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

const ORG = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const url = process.env.DATABASE_URL_POSTGRES;
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const rollback = new Error("ROLLBACK_DEE946_TEST");
const corpus: SourceAnchor[] = Array.from({ length: 120 }, (_, i) => ({
  venue: "htx",
  market: "spot",
  symbol: "BTCUSDT",
  closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
  barContentDigest: sha(String(i)),
  realizedVol20m_1m: 0.005 + (i % 30) * 0.001,
  outcome13d: [
    i === 0 ? -0 : 0.001,
    0.002,
    0.003,
    ((i % 11) - 5) / 1000,
    0.004,
    0.005,
    0.006,
    100,
    101,
    102,
    103,
    104,
    105,
  ],
}));
const fixture = (organizationId = ORG) =>
  buildPredictivePackageV1({
    family: buildHistoricalForecastFamilyV2({
      organizationId,
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      developmentDatasetDigestHex: sha(randomUUID()),
      releaseSha: "b".repeat(40),
    }),
    sourceCorpus: corpus,
    kConfigDec: 2,
    mConfigDec: 20,
  });

describe.skipIf(!enabled)("DEE-946 immutable bounded PostgreSQL package storage", () => {
  let sql: postgres.Sql;
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url!).hostname))
      throw new Error("PACKAGE_STORAGE_TEST_LOCALHOST_ONLY");
    sql = postgres(url!, { max: 4, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  async function seed(tx: postgres.Sql, organizationId = ORG) {
    if (!(await tx`SELECT id FROM organizations WHERE id=${organizationId}::uuid`).length) {
      const user = randomUUID();
      await tx`INSERT INTO auth.users(id) VALUES (${user}::uuid)`;
      await tx`INSERT INTO users(id,identity_label,email) VALUES (${user}::uuid,'DEE946 local fixture',${`${user}@invalid.local`})`;
      await tx`INSERT INTO organizations(id,owner_user_id,kind,name) VALUES (${organizationId}::uuid,${user}::uuid,'personal','DEE946 local fixture')`;
    }
    const pkg = fixture(organizationId);
    // Low-level storage probes need an unsealed canonical metadata parent. The
    // production persistence path now seals storage atomically (tested below).
    const packageId = randomUUID();
    await tx`INSERT INTO trader_forecast_predictive_package_v2
      (id, organization_id, venue, market, symbol, primary_horizon_minutes,
       execution_horizon_minutes, model_transform_version, replica_root_family_identity_digest,
       predictive_package_generation_identity_digest, predictive_package_content_digest,
       k_config_dec, m_config_dec, alpha_epi_config_scale8, km_global_anchor_set_digest,
       development_dataset_digest, feature_version, sampler_contract_version, quantizer_version,
       normalization_version_digest, runtime_contract_digest, package_subject_version, schema_version, idempotency_key)
      VALUES (${packageId}::uuid, ${organizationId}::uuid, ${pkg.family.venue}, ${pkg.family.market},
       ${pkg.family.symbol}, ${pkg.family.primaryHorizonMinutes}, ${pkg.family.executionHorizonMinutes},
       ${pkg.family.modelTransformVersion}, ${pkg.replicaRootFamilyIdentityDigest.toString("hex")},
       ${pkg.predictivePackageGenerationIdentityDigest.toString("hex")}, ${pkg.predictivePackageContentDigest.toString("hex")},
       ${pkg.kConfigDec}, ${pkg.mConfigDec}, ${pkg.alphaEpiConfigScale8}, ${sha("DEE946 local corpus")},
       ${pkg.family.developmentDatasetDigestHex}, ${pkg.family.featureVersion}, ${SAMPLER_CONTRACT_VERSION},
       ${QUANTIZER_VERSION}, ${pkg.family.normalizationVersionDigestHex}, ${pkg.runtimeContractDigest.toString("hex")},
       ${pkg.family.packageSubjectVersion}, 'predictive-package/v2', ${randomUUID()})`;
    return { pkg, packageId };
  }
  async function probe(
    work: (tx: postgres.Sql, f: Awaited<ReturnType<typeof seed>>) => Promise<void>,
  ) {
    await expect(
      withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        const f = await seed(tx);
        await work(tx, f);
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }
  async function chunk(
    tx: postgres.Sql,
    packageId: string,
    ordinal = 0,
    payload = Buffer.from("x\n"),
    org = ORG,
  ) {
    await tx`INSERT INTO trader_predictive_package_chunk_v1
      (organization_id,package_id,codec_version,ordinal,byte_length,record_count,sha256_hex,payload)
      VALUES (${org}::uuid,${packageId}::uuid,'predictive-package-codec/v1',${ordinal},${payload.length},1,${sha(payload)},${payload})`;
  }
  async function seal(
    tx: postgres.Sql,
    f: Awaited<ReturnType<typeof seed>>,
    count: number,
    limit = 65536,
  ) {
    await tx`INSERT INTO trader_predictive_package_manifest_v1
      (organization_id,package_id,codec_version,generation_digest_hex,content_digest_hex,manifest_digest_hex,
       chunk_byte_limit,source_count,replica_count,chunk_count)
      VALUES (${ORG}::uuid,${f.packageId}::uuid,'predictive-package-codec/v1',
        ${f.pkg.predictivePackageGenerationIdentityDigest.toString("hex")},
        ${f.pkg.predictivePackageContentDigest.toString("hex")},${sha("untrusted test seal")},${limit},120,2,${count})`;
  }

  it("publishes and hydrates the exact real-builder package under actual runner role", async () => {
    await probe(async (tx, { pkg, packageId }) => {
      await tx`SET LOCAL ROLE waia_historical_runner`;
      const ref = await persistPredictivePackageStorageV1(tx, packageId, pkg);
      expect(await hydratePredictivePackageStorageV1(tx, ref)).toStrictEqual(pkg);
      expect(ref.manifestDigestHex).toBe(encodePredictivePackageV1(pkg).manifest.manifestDigestHex);
      const before =
        await tx`SELECT count(*)::int n FROM trader_predictive_package_chunk_v1 WHERE package_id=${packageId}::uuid`;
      expect(await persistPredictivePackageStorageV1(tx, packageId, pkg)).toEqual(ref);
      expect(
        await tx`SELECT count(*)::int n FROM trader_predictive_package_chunk_v1 WHERE package_id=${packageId}::uuid`,
      ).toEqual(before);
      expect(
        (
          await tx`SELECT max(byte_length)::int n FROM trader_predictive_package_chunk_v1 WHERE package_id=${packageId}::uuid`
        )[0]?.n,
      ).toBeLessThanOrEqual(65536);
      await expect(
        hydratePredictivePackageStorageV1(tx, { ...ref, manifestDigestHex: sha("wrong") }),
      ).rejects.toThrow("MANIFEST");
      await expect(
        hydratePredictivePackageStorageV1(tx, { ...ref, organizationId: randomUUID() }),
      ).rejects.toThrow("NOT_FOUND_OR_NOT_VISIBLE");
      await expect(
        hydratePredictivePackageStorageV1(tx, { ...ref, generationDigestHex: sha("wrong") }),
      ).rejects.toThrow("MANIFEST");
    });
  });

  it("canonical persistence atomically seals storage and preserves idempotent retry", async () => {
    await probe(async (tx) => {
      const pkg = fixture();
      await tx`SET LOCAL ROLE waia_historical_runner`;
      const input = { organizationId: ORG, kmGlobalAnchorSetDigestHex: sha("DEE946 local corpus") };
      const persisted = await persistPredictivePackageV2(tx, pkg, input);
      const manifest = await tx`SELECT manifest_digest_hex FROM trader_predictive_package_manifest_v1
        WHERE organization_id=${ORG}::uuid AND package_id=${persisted.packageId}::uuid`;
      expect(manifest).toHaveLength(1);
      expect(manifest[0]!.manifest_digest_hex).toBe(encodePredictivePackageV1(pkg).manifest.manifestDigestHex);
      expect(await persistPredictivePackageV2(tx, pkg, input)).toEqual(persisted);
    });
  });

  it.each(["missing-seal", "empty-seal", "gap", "extra", "too-large"])(
    "refuses %s publication and rolls it all back",
    async (kind) => {
      let packageId = "";
      await expect(
        withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
          const f = await seed(tx);
          packageId = f.packageId;
          await tx`SET LOCAL ROLE waia_historical_runner`;
          if (kind !== "empty-seal")
            await chunk(
              tx,
              packageId,
              kind === "gap" ? 1 : 0,
              kind === "too-large" ? Buffer.alloc(65537) : undefined,
            );
          if (kind === "extra") await chunk(tx, packageId, 1);
          if (kind !== "missing-seal") await seal(tx, f, 1);
        }),
      ).rejects.toMatchObject({ code: kind === "missing-seal" ? "23503" : "23514" });
      expect(
        await sql`SELECT ordinal FROM trader_predictive_package_chunk_v1 WHERE package_id=${packageId}::uuid`,
      ).toEqual([]);
    },
  );

  it("refuses byte tampering at the database boundary", async () => {
    await expect(
      withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        const { packageId } = await seed(tx);
        await tx`INSERT INTO trader_predictive_package_chunk_v1
        (organization_id,package_id,codec_version,ordinal,byte_length,record_count,sha256_hex,payload)
        VALUES (${ORG}::uuid,${packageId}::uuid,'predictive-package-codec/v1',0,2,1,${sha("original")},${Buffer.from("x\n")})`;
      }),
    ).rejects.toMatchObject({ code: "23514", constraint_name: "tppc_v1_payload_digest" });
  });

  it.each(["UPDATE", "DELETE", "TRUNCATE"])("denies runner %s privileges", async (verb) => {
    await expect(
      withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        const { pkg, packageId } = await seed(tx);
        await persistPredictivePackageStorageV1(tx, packageId, pkg);
        await tx`SET LOCAL ROLE waia_historical_runner`;
        await tx.unsafe(
          verb === "UPDATE"
            ? "UPDATE trader_predictive_package_chunk_v1 SET ordinal=ordinal"
            : `${verb}${verb === "DELETE" ? " FROM" : ""} trader_predictive_package_chunk_v1`,
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("denies cross-organization insertion by runner", async () => {
    await expect(
      withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        const { packageId } = await seed(tx);
        await tx`SET LOCAL ROLE waia_historical_runner`;
        await chunk(tx, packageId, 0, undefined, randomUUID());
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("hides actual other-tenant manifest and payload rows from the runner", async () => {
    await probe(async (tx) => {
      const other = await seed(tx, randomUUID());
      const reference = await persistPredictivePackageStorageV1(tx, other.packageId, other.pkg);
      expect(await hydratePredictivePackageStorageV1(tx, reference)).toStrictEqual(other.pkg);
      await tx`SET LOCAL ROLE waia_historical_runner`;
      expect(
        await tx`SELECT package_id FROM trader_predictive_package_manifest_v1 WHERE package_id=${other.packageId}::uuid`,
      ).toEqual([]);
      expect(
        await tx`SELECT ordinal FROM trader_predictive_package_chunk_v1 WHERE package_id=${other.packageId}::uuid`,
      ).toEqual([]);
      await expect(hydratePredictivePackageStorageV1(tx, reference)).rejects.toThrow(
        "NOT_FOUND_OR_NOT_VISIBLE",
      );
    });
  });

  it("rejects extension even by the owner after the package is sealed", async () => {
    await expect(
      withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        const { pkg, packageId } = await seed(tx);
        await persistPredictivePackageStorageV1(tx, packageId, pkg);
        await chunk(tx, packageId, 999);
      }),
    ).rejects.toThrow("ALREADY_SEALED");
  });

  it.each(["UPDATE", "DELETE", "TRUNCATE"])("owner also cannot %s sealed bytes", async (verb) => {
    await expect(
      withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        const { pkg, packageId } = await seed(tx);
        await persistPredictivePackageStorageV1(tx, packageId, pkg);
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
        await tx.unsafe(
          verb === "UPDATE"
            ? "UPDATE trader_predictive_package_chunk_v1 SET ordinal=ordinal"
            : `${verb}${verb === "DELETE" ? " FROM" : ""} trader_predictive_package_chunk_v1`,
        );
      }),
    ).rejects.toThrow("STORAGE_IMMUTABLE");
  });

  it("concurrent identical publication converges and survives a new connection", async () => {
    // Committed synthetic fixture stays in this disposable DB. Do not disable
    // guards or delete immutable evidence as a test cleanup shortcut.
    const { pkg, packageId } = await withPostgresSessionTransaction(sql, "SERIALIZABLE", seed);
    const [first, second] = await Promise.all([
      persistPredictivePackageStorageV1(sql, packageId, pkg),
      persistPredictivePackageStorageV1(sql, packageId, pkg),
    ]);
    expect(second).toEqual(first);
    const restarted = postgres(url!, { max: 1, onnotice: () => {} });
    try {
      const restored = await withPostgresSessionTransaction(
        restarted,
        "REPEATABLE READ",
        async (tx) => {
          await tx`SET LOCAL ROLE waia_historical_runner`;
          return hydratePredictivePackageStorageV1(tx, first);
        },
      );
      expect(restored).toStrictEqual(pkg);
      expect(
        (
          await restarted`SELECT count(*)::int n FROM trader_predictive_package_manifest_v1
        WHERE organization_id=${ORG}::uuid AND package_id=${packageId}::uuid`
        )[0]?.n,
      ).toBe(1);
    } finally {
      await restarted.end({ timeout: 5 });
    }
  });

  it("applies 0203 as a restricted administrator without role mutation or bypass", async () => {
    const migration = readFileSync(
      new URL(
        "../../db/migrations_postgres/0203_predictive_package_storage_v1.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const admin = `waia946_probe_${randomUUID().replaceAll("-", "")}`;
    await expect(
      withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        await tx`DROP TABLE public.trader_predictive_package_chunk_v1`;
        await tx`DROP TABLE public.trader_predictive_package_manifest_v1`;
        await tx`DROP FUNCTION public.trader_predictive_package_storage_guard_v1()`;
        await tx.unsafe(
          `CREATE ROLE ${admin} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`,
        );
        await tx.unsafe(`GRANT USAGE, CREATE ON SCHEMA public TO ${admin}`);
        await tx.unsafe(
          `GRANT REFERENCES ON organizations,trader_forecast_predictive_package_v2 TO ${admin}`,
        );
        await tx.unsafe(`SET LOCAL ROLE ${admin}`);
        expect(
          (
            await tx`SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user`
          )[0],
        ).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
        await tx.unsafe(migration).simple();
        expect(
          (
            await tx`SELECT count(*)::int n FROM pg_class WHERE relname IN
        ('trader_predictive_package_chunk_v1','trader_predictive_package_manifest_v1') AND relrowsecurity`
          )[0]?.n,
        ).toBe(2);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
