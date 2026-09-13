import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { withPostgresSerializableTransactionRetry } from "@/db/postgres-session-transaction";
import {
  PREDICTIVE_PACKAGE_CODEC_VERSION,
  hydratePredictivePackageAsyncV1,
  streamEncodePredictivePackageV1,
  validatePredictivePackageManifestV1,
  type PredictivePackageCodecIdentityV1,
  type PredictivePackageManifestV1,
} from "./predictive-package-codec-v1";
import type { PredictivePackageV1 } from "./rv-state-conditional-empirical-joint-v1";

// No authority is minted here. The caller must authorize the organization and
// obtain this immutable reference from its admitted canonical input/outcome.
export type PredictivePackageStorageReferenceV1 = PredictivePackageCodecIdentityV1 & {
  packageId: string;
  codecVersion: typeof PREDICTIVE_PACKAGE_CODEC_VERSION;
  manifestDigestHex: string;
};
type Key = PredictivePackageCodecIdentityV1 & { packageId: string };
type ManifestRow = {
  codec_version: typeof PREDICTIVE_PACKAGE_CODEC_VERSION;
  generation_digest_hex: string;
  content_digest_hex: string;
  manifest_digest_hex: string;
  chunk_byte_limit: number;
  source_count: number;
  replica_count: number;
  chunk_count: number;
};
const PAGE_SIZE = 8; // <=512 KiB of payload per insert/read, independent of corpus size.
function refuse(reason: string): never {
  throw new Error(`PREDICTIVE_PACKAGE_STORAGE_REFUSED:${reason}`);
}
function checkKey(key: Key) {
  if (
    ![key.organizationId, key.packageId].every((v) =>
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v),
    ) ||
    ![key.generationDigestHex, key.contentDigestHex].every((v) => /^[0-9a-f]{64}$/.test(v))
  )
    refuse("IDENTITY");
}
async function readManifest(
  sql: postgres.Sql,
  key: Key,
): Promise<PredictivePackageManifestV1 | null> {
  const [row] = await sql<ManifestRow[]>`
    SELECT codec_version, generation_digest_hex, content_digest_hex, manifest_digest_hex,
      chunk_byte_limit, source_count, replica_count, chunk_count
    FROM public.trader_predictive_package_manifest_v1
    WHERE organization_id=${key.organizationId}::uuid AND package_id=${key.packageId}::uuid
      AND codec_version=${PREDICTIVE_PACKAGE_CODEC_VERSION}`;
  if (!row) return null;
  const chunks: PredictivePackageManifestV1["chunks"] = [];
  // Descriptor metadata is retained for the codec seal; payload bytes are not.
  let after = -1;
  for (;;) {
    const page = await sql<
      { ordinal: number; byte_length: number; record_count: number; sha256_hex: string }[]
    >`
      SELECT ordinal, byte_length, record_count, sha256_hex
      FROM public.trader_predictive_package_chunk_v1
      WHERE organization_id=${key.organizationId}::uuid AND package_id=${key.packageId}::uuid
        AND codec_version=${PREDICTIVE_PACKAGE_CODEC_VERSION} AND ordinal > ${after}
      ORDER BY ordinal LIMIT 256`;
    if (!page.length) break;
    for (const chunk of page)
      chunks.push({
        ordinal: chunk.ordinal,
        byteLength: chunk.byte_length,
        recordCount: chunk.record_count,
        sha256: chunk.sha256_hex,
      });
    after = page[page.length - 1]!.ordinal;
    if (chunks.length > row.chunk_count) refuse("EXTRA_DESCRIPTOR");
  }
  if (chunks.length !== row.chunk_count) refuse("MISSING_DESCRIPTOR");
  const manifest: PredictivePackageManifestV1 = {
    version: row.codec_version,
    organizationId: key.organizationId,
    generationDigestHex: row.generation_digest_hex,
    contentDigestHex: row.content_digest_hex,
    manifestDigestHex: row.manifest_digest_hex,
    chunkByteLimit: row.chunk_byte_limit,
    sourceCount: row.source_count,
    replicaCount: row.replica_count,
    chunks,
  };
  // Integrity against the immutable DB seal, NOT authorization of a caller.
  validatePredictivePackageManifestV1(manifest, {
    ...key,
    manifestDigestHex: row.manifest_digest_hex,
  });
  return manifest;
}

/** Enclose metadata creation + this call in the SAME existing package transaction. */
export async function persistPredictivePackageStorageV1(
  sql: postgres.Sql,
  packageId: string,
  pkg: PredictivePackageV1,
): Promise<PredictivePackageStorageReferenceV1> {
  const key: Key = {
    packageId,
    organizationId: pkg.family.organizationId,
    generationDigestHex: pkg.predictivePackageGenerationIdentityDigest.toString("hex"),
    contentDigestHex: pkg.predictivePackageContentDigest.toString("hex"),
  };
  checkKey(key);
  return withPostgresSerializableTransactionRetry(sql, async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(
      ${`predictive-package-storage/v1|${key.organizationId}|${packageId}`}, 0))`;
    const existing = await readManifest(tx, key);
    if (existing)
      return {
        ...key,
        codecVersion: existing.version,
        manifestDigestHex: existing.manifestDigestHex,
      };

    const encoder = streamEncodePredictivePackageV1(pkg);
    let ordinal = 0;
    let pending: {
      organization_id: string;
      package_id: string;
      codec_version: string;
      ordinal: number;
      byte_length: number;
      record_count: number;
      sha256_hex: string;
      payload: Buffer;
    }[] = [];
    const flush = async () => {
      if (!pending.length) return;
      await tx`INSERT INTO public.trader_predictive_package_chunk_v1 ${tx(pending)}`;
      pending = [];
    };
    try {
      for (;;) {
        const step = encoder.next();
        if (step.done) {
          await flush();
          const m = step.value;
          validatePredictivePackageManifestV1(m, {
            ...key,
            manifestDigestHex: m.manifestDigestHex,
          });
          if (m.chunks.length !== ordinal) refuse("ENCODER_COUNT");
          await tx`INSERT INTO public.trader_predictive_package_manifest_v1
            (organization_id, package_id, codec_version, generation_digest_hex, content_digest_hex,
             manifest_digest_hex, chunk_byte_limit, source_count, replica_count, chunk_count)
            VALUES (${key.organizationId}::uuid, ${packageId}::uuid, ${m.version}, ${m.generationDigestHex},
              ${m.contentDigestHex}, ${m.manifestDigestHex}, ${m.chunkByteLimit}, ${m.sourceCount},
              ${m.replicaCount}, ${m.chunks.length})`;
          return { ...key, codecVersion: m.version, manifestDigestHex: m.manifestDigestHex };
        }
        const payload = step.value;
        let records = 0;
        for (const byte of payload) if (byte === 10) records++;
        pending.push({
          organization_id: key.organizationId,
          package_id: packageId,
          codec_version: PREDICTIVE_PACKAGE_CODEC_VERSION,
          ordinal: ordinal++,
          byte_length: payload.length,
          record_count: records,
          sha256_hex: createHash("sha256").update(payload).digest("hex"),
          payload,
        });
        if (pending.length === PAGE_SIZE) await flush();
      }
    } finally {
      encoder.return(undefined as never);
    }
  });
}

/** Keyset pages, no long-lived server cursor and no all-payload JSON/array. */
export async function hydratePredictivePackageStorageV1(
  sql: postgres.Sql,
  trustedReference: PredictivePackageStorageReferenceV1,
): Promise<PredictivePackageV1> {
  const reference = { ...trustedReference };
  checkKey(reference);
  if (
    reference.codecVersion !== PREDICTIVE_PACKAGE_CODEC_VERSION ||
    !/^[0-9a-f]{64}$/.test(reference.manifestDigestHex)
  )
    refuse("REFERENCE");
  const manifest = await readManifest(sql, reference);
  if (!manifest) refuse("NOT_FOUND_OR_NOT_VISIBLE");
  // Admission before any payload read. Immutable tables make pages restart-safe.
  validatePredictivePackageManifestV1(manifest, reference);
  async function* payloads() {
    let after = -1;
    for (;;) {
      const page = await sql<{ ordinal: number; payload: Buffer }[]>`
        SELECT ordinal, payload FROM public.trader_predictive_package_chunk_v1
        WHERE organization_id=${reference.organizationId}::uuid AND package_id=${reference.packageId}::uuid
          AND codec_version=${reference.codecVersion} AND ordinal > ${after}
        ORDER BY ordinal LIMIT ${PAGE_SIZE}`;
      if (!page.length) return;
      for (const row of page) {
        if (row.ordinal !== after + 1) refuse("PAYLOAD_ORDINAL");
        after = row.ordinal;
        yield row.payload;
      }
    }
  }
  return hydratePredictivePackageAsyncV1(manifest, payloads(), reference);
}
