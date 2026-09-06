import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  PredictivePackageV1,
  ReplicaArtifact,
  RvState,
} from "./rv-state-conditional-empirical-joint-v1";
import {
  computeTerminalTargetGridIdentityDigestHex,
  serializeReplicaArtifactPayloadV1,
} from "./rv-state-conditional-empirical-joint-v1";
import {
  computePredictivePackageContentDigest,
  computePredictivePackageGenerationIdentityDigest,
  computeReplicaArtifactDigestK,
  computeReplicaRootFamilyIdentityDigest,
} from "./identity-digests";
import { computePoolSemanticDigest } from "./pool-semantic-digest-v1";
import {
  assertNoDuplicateSourceAnchors,
  canonicalizeSourceCorpusV1,
  sourceAnchorId,
} from "./source-corpus-canonical-v1";
import type { SourceAnchor } from "./source-anchor-v1";

export const PREDICTIVE_PACKAGE_CODEC_VERSION = "predictive-package-codec/v1";
export const PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES = 64 * 1024;
const STATES: RvState[] = ["S0", "S1", "S2"];
type Descriptor = { ordinal: number; byteLength: number; recordCount: number; sha256: string };
export type PredictivePackageCodecIdentityV1 = {
  organizationId: string;
  generationDigestHex: string;
  contentDigestHex: string;
};
export type PredictivePackageManifestV1 = PredictivePackageCodecIdentityV1 & {
  version: typeof PREDICTIVE_PACKAGE_CODEC_VERSION;
  chunkByteLimit: number;
  sourceCount: number;
  replicaCount: number;
  chunks: Descriptor[];
  manifestDigestHex: string;
};
export type EncodedPredictivePackageV1 = {
  manifest: PredictivePackageManifestV1;
  chunks: Buffer[];
};
function fail(reason: string): never {
  throw new Error(`PREDICTIVE_PACKAGE_CODEC_REFUSED:${reason}`);
}
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const integer = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const digest = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

// Tagged records avoid JSON's Buffer.toJSON and -0 loss. The budget is checked
// before stringify, so even malformed inputs cannot form an unbounded string.
function pack(value: unknown, budget = { left: 60_000 }, depth = 0): unknown {
  if (depth > 32 || (budget.left -= 32) < 0) return fail("RECORD_TOO_LARGE");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if ((budget.left -= value.length * 6) < 0) return fail("RECORD_TOO_LARGE");
    return ["s", value];
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fail("NONFINITE_NUMBER");
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
    return ["n", bytes.toString("hex")];
  }
  if (Buffer.isBuffer(value)) {
    if ((budget.left -= value.length * 2) < 0) return fail("RECORD_TOO_LARGE");
    return ["b", value.toString("hex")];
  }
  if (Array.isArray(value)) return ["a", value.map((v) => pack(v, budget, depth + 1))];
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return [
      "o",
      Object.entries(value).map(([k, v]) => [
        pack(k, budget, depth + 1),
        pack(v, budget, depth + 1),
      ]),
    ];
  }
  return fail("UNSUPPORTED_VALUE");
}
function unpack(value: unknown, depth = 0): unknown {
  if (depth > 32) return fail("RECORD_DEPTH");
  if (value === null || typeof value === "boolean") return value;
  if (!Array.isArray(value) || value.length !== 2) return fail("TAG");
  const [tag, data] = value;
  if (tag === "s" && typeof data === "string") return data;
  if ((tag === "n" || tag === "b") && typeof data === "string" && /^(?:[0-9a-f]{2})*$/.test(data)) {
    const bytes = Buffer.from(data, "hex");
    if (tag === "b") return bytes;
    if (bytes.length !== 8) return fail("NUMBER");
    const n = bytes.readDoubleBE();
    if (!Number.isFinite(n)) return fail("NONFINITE_NUMBER");
    return n;
  }
  if (tag === "a" && Array.isArray(data)) return data.map((v) => unpack(v, depth + 1));
  if (tag === "o" && Array.isArray(data)) {
    const object: Record<string, unknown> = {};
    for (const pair of data) {
      if (!Array.isArray(pair) || pair.length !== 2) return fail("OBJECT_PAIR");
      const key = unpack(pair[0], depth + 1);
      if (typeof key !== "string" || Object.hasOwn(object, key)) return fail("OBJECT_KEY");
      Object.defineProperty(object, key, {
        value: unpack(pair[1], depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return object;
  }
  return fail("TAG");
}
function sameDigest(actual: Buffer, expected: unknown): void {
  if (!Buffer.isBuffer(expected) || !actual.equals(expected)) fail("SCIENTIFIC_DIGEST");
}
function validatePackage(pkg: PredictivePackageV1): void {
  const corpus = pkg.canonicalSourceCorpus;
  for (const a of corpus) {
    if (
      !a ||
      typeof a.venue !== "string" ||
      typeof a.market !== "string" ||
      typeof a.symbol !== "string" ||
      !integer(a.closedBarEpochMs) ||
      !digest(a.barContentDigest) ||
      !Number.isFinite(a.realizedVol20m_1m) ||
      !Array.isArray(a.outcome13d) ||
      a.outcome13d.length !== 13 ||
      a.outcome13d.some((n) => !Number.isFinite(n))
    )
      fail("SOURCE_ANCHOR");
  }
  assertNoDuplicateSourceAnchors(corpus);
  const sorted = canonicalizeSourceCorpusV1(corpus);
  if (sorted.some((a, i) => a !== corpus[i])) fail("CORPUS_ORDER");
  if (
    !corpus.length ||
    !integer(pkg.kConfigDec) ||
    pkg.kConfigDec < 1 ||
    pkg.kConfigDec > 50 ||
    pkg.replicaArtifacts.length !== pkg.kConfigDec
  )
    fail("PACKAGE_COUNTS");
  sameDigest(
    computeReplicaRootFamilyIdentityDigest(pkg.family),
    pkg.replicaRootFamilyIdentityDigest,
  );
  sameDigest(
    computePredictivePackageGenerationIdentityDigest({
      replicaRootFamilyIdentityDigestHex: pkg.replicaRootFamilyIdentityDigest.toString("hex"),
      kConfigDec: pkg.kConfigDec,
      mConfigDec: pkg.mConfigDec,
      alphaEpiConfigScale8: pkg.alphaEpiConfigScale8,
    }),
    pkg.predictivePackageGenerationIdentityDigest,
  );
  for (const [ordinal, replica] of pkg.replicaArtifacts.entries()) {
    if (replica.replicaOrdinal !== ordinal) fail("REPLICA_ORDINAL");
    const positions = new Set<number>();
    for (const state of STATES) {
      if (replica[`n${state}`] !== replica.pools[state].length) fail("POOL_COUNT");
      for (const obs of replica.pools[state]) {
        if (
          !integer(obs.resamplePositionOrdinal) ||
          obs.resamplePositionOrdinal >= corpus.length ||
          positions.has(obs.resamplePositionOrdinal)
        )
          fail("RESAMPLE_ORDINAL");
        positions.add(obs.resamplePositionOrdinal);
      }
      sameDigest(
        computePoolSemanticDigest({
          ...pkg.family,
          replicaOrdinal: ordinal,
          stateId: state,
          observations: replica.pools[state],
        }),
        replica[`poolSemanticDigest${state}`],
      );
    }
    if (positions.size !== corpus.length) fail("RESAMPLE_COVERAGE");
    sameDigest(
      computeReplicaArtifactDigestK(
        serializeReplicaArtifactPayloadV1({
          artifact: replica,
          symbol: pkg.family.symbol,
          primaryHorizonMinutes: pkg.family.primaryHorizonMinutes,
        }),
      ),
      replica.replicaArtifactDigest,
    );
  }
  sameDigest(
    computePredictivePackageContentDigest(
      pkg.predictivePackageGenerationIdentityDigest,
      pkg.replicaArtifacts.map((r) => r.replicaArtifactDigest),
    ),
    pkg.predictivePackageContentDigest,
  );
  if (
    computeTerminalTargetGridIdentityDigestHex(pkg.terminalTargetGrid) !==
    pkg.terminalTargetGridIdentityDigestHex
  )
    fail("GRID_DIGEST");
}
function identity(pkg: PredictivePackageV1): PredictivePackageCodecIdentityV1 {
  return {
    organizationId: pkg.family.organizationId,
    generationDigestHex: pkg.predictivePackageGenerationIdentityDigest.toString("hex"),
    contentDigestHex: pkg.predictivePackageContentDigest.toString("hex"),
  };
}
function manifestDigest(m: Omit<PredictivePackageManifestV1, "manifestDigestHex">): string {
  const h = createHash("sha256");
  h.update(
    JSON.stringify([
      m.version,
      m.organizationId,
      m.generationDigestHex,
      m.contentDigestHex,
      m.chunkByteLimit,
      m.sourceCount,
      m.replicaCount,
      m.chunks.length,
    ]) + "\n",
  );
  for (const c of m.chunks)
    h.update(JSON.stringify([c.ordinal, c.byteLength, c.recordCount, c.sha256]) + "\n");
  return h.digest("hex");
}

/** Pure phase-1 encoding: no qualification, persistence, or authority is granted. */
export function* streamEncodePredictivePackageV1(
  pkg: PredictivePackageV1,
  chunkByteLimit = PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES,
): Generator<Buffer, PredictivePackageManifestV1> {
  if (
    !integer(chunkByteLimit) ||
    chunkByteLimit < 1024 ||
    chunkByteLimit > PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES
  )
    fail("CHUNK_LIMIT");
  validatePackage(pkg);
  const sourceIndices = new Map(pkg.canonicalSourceCorpus.map((a, i) => [sourceAnchorId(a), i]));
  const descriptors: Descriptor[] = [];
  let parts: Buffer[] = [],
    size = 0;
  const flush = (): Buffer => {
    const bytes = Buffer.concat(parts, size);
    descriptors.push({
      ordinal: descriptors.length,
      byteLength: size,
      recordCount: parts.length,
      sha256: hash(bytes),
    });
    parts = [];
    size = 0;
    return bytes;
  };
  const { canonicalSourceCorpus, replicaArtifacts, ...metadata } = pkg;
  function* rows(): Generator<unknown[]> {
    yield ["header", metadata];
    for (const anchor of canonicalSourceCorpus) yield ["anchor", anchor];
    for (const replica of replicaArtifacts) {
      const { pools, ...header } = replica;
      yield ["replica", header];
      for (const state of STATES) {
        yield ["pool", state, pools[state].length];
        for (const obs of pools[state]) {
          const index = sourceIndices.get(sourceAnchorId(obs.anchor));
          if (index === undefined || !isDeepStrictEqual(obs.anchor, canonicalSourceCorpus[index]))
            fail("ANCHOR_SUBSTITUTION");
          yield ["draw", obs.resamplePositionOrdinal, index];
        }
      }
    }
  }
  for (const row of rows()) {
    const bytes = Buffer.from(JSON.stringify(pack(row)) + "\n");
    if (bytes.length > chunkByteLimit) fail("RECORD_TOO_LARGE");
    if (size + bytes.length > chunkByteLimit) yield flush();
    parts.push(bytes);
    size += bytes.length;
  }
  if (parts.length) yield flush();
  const manifest: Omit<PredictivePackageManifestV1, "manifestDigestHex"> = {
    version: PREDICTIVE_PACKAGE_CODEC_VERSION,
    ...identity(pkg),
    chunkByteLimit,
    sourceCount: canonicalSourceCorpus.length,
    replicaCount: replicaArtifacts.length,
    chunks: descriptors,
  };
  return { ...manifest, manifestDigestHex: manifestDigest(manifest) };
}

/** Convenience collector for small/local callers; storage should drain the generator. */
export function encodePredictivePackageV1(
  pkg: PredictivePackageV1,
  chunkByteLimit = PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES,
): EncodedPredictivePackageV1 {
  const stream = streamEncodePredictivePackageV1(pkg, chunkByteLimit),
    chunks: Buffer[] = [];
  for (;;) {
    const next = stream.next();
    if (next.done) return { manifest: next.value, chunks };
    chunks.push(next.value);
  }
}

/** expected must come from a trusted scoped reference, not the received manifest. */
export function decodePredictivePackageV1(
  encoded: EncodedPredictivePackageV1,
  expected: PredictivePackageCodecIdentityV1 & { manifestDigestHex: string },
): PredictivePackageV1 {
  return hydratePredictivePackageV1(encoded.manifest, encoded.chunks, expected);
}

/** Consume one bounded chunk at a time; the restored scientific package remains in memory. */
export function hydratePredictivePackageV1(
  m: PredictivePackageManifestV1,
  chunks: Iterable<Buffer>,
  expected: PredictivePackageCodecIdentityV1 & { manifestDigestHex: string },
): PredictivePackageV1 {
  // Validate descriptor primitives before hashing: no unbounded attacker string
  // may reach even the small per-descriptor JSON serializer.
  if (
    !Array.isArray(m.chunks) ||
    !m.chunks.length ||
    m.chunks.some(
      (d, i) =>
        !d ||
        d.ordinal !== i ||
        !integer(d.byteLength) ||
        !d.byteLength ||
        d.byteLength > PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES ||
        !integer(d.recordCount) ||
        !d.recordCount ||
        d.recordCount > d.byteLength ||
        !digest(d.sha256),
    )
  )
    fail("CHUNK_DESCRIPTOR");
  if (
    m.version !== PREDICTIVE_PACKAGE_CODEC_VERSION ||
    !integer(m.chunkByteLimit) ||
    m.chunkByteLimit < 1024 ||
    m.chunkByteLimit > PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES ||
    !integer(m.sourceCount) ||
    !m.sourceCount ||
    !integer(m.replicaCount) ||
    m.replicaCount < 1 ||
    m.replicaCount > 50 ||
    !digest(expected.manifestDigestHex) ||
    !digest(m.generationDigestHex) ||
    !digest(m.contentDigestHex) ||
    m.organizationId !== expected.organizationId ||
    m.generationDigestHex !== expected.generationDigestHex ||
    m.contentDigestHex !== expected.contentDigestHex ||
    m.manifestDigestHex !== expected.manifestDigestHex ||
    manifestDigest(m) !== expected.manifestDigestHex
  )
    fail("MANIFEST");
  function* records(): Generator<unknown[]> {
    const input = chunks[Symbol.iterator]();
    try {
      for (const [i, d] of m.chunks.entries()) {
        const next = input.next(),
          bytes = next.value;
        if (next.done) fail("MISSING_CHUNK");
        if (
          !Buffer.isBuffer(bytes) ||
          d.ordinal !== i ||
          !integer(d.byteLength) ||
          !d.byteLength ||
          d.byteLength > m.chunkByteLimit ||
          bytes.length !== d.byteLength ||
          !integer(d.recordCount) ||
          !d.recordCount ||
          !digest(d.sha256) ||
          hash(bytes) !== d.sha256
        )
          fail("CHUNK");
        const text = bytes.toString("utf8");
        if (!Buffer.from(text).equals(bytes) || !text.endsWith("\n")) fail("CHUNK_ENCODING");
        const lines = text.slice(0, -1).split("\n");
        if (lines.length !== d.recordCount) fail("CHUNK_RECORD_COUNT");
        for (const line of lines) {
          const row = unpack(JSON.parse(line));
          if (!Array.isArray(row)) fail("RECORD");
          yield row;
        }
      }
      if (!input.next().done) fail("EXTRA_CHUNKS");
    } finally {
      input.return?.();
    }
  }
  const rows = records();
  try {
    const take = (kind: string, length: number): unknown[] => {
      const row = rows.next();
      if (row.done || row.value[0] !== kind || row.value.length !== length) fail("RECORD_ORDER");
      return row.value;
    };
    const metadata = take("header", 2)[1] as Omit<
      PredictivePackageV1,
      "canonicalSourceCorpus" | "replicaArtifacts"
    >;
    const corpus: SourceAnchor[] = [];
    for (let i = 0; i < m.sourceCount; i++) corpus.push(take("anchor", 2)[1] as SourceAnchor);
    assertNoDuplicateSourceAnchors(corpus);
    const replicas: ReplicaArtifact[] = [];
    for (let i = 0; i < m.replicaCount; i++) {
      const header = take("replica", 2)[1] as Omit<ReplicaArtifact, "pools">;
      const pools: ReplicaArtifact["pools"] = { S0: [], S1: [], S2: [] };
      for (const state of STATES) {
        const row = take("pool", 3),
          count = row[2];
        if (row[1] !== state || !integer(count) || count > corpus.length) fail("POOL_HEADER");
        for (let j = 0; j < count; j++) {
          const draw = take("draw", 3),
            ordinal = draw[1],
            index = draw[2];
          if (!integer(index) || index >= corpus.length || !integer(ordinal)) fail("SOURCE_INDEX");
          pools[state].push({ resamplePositionOrdinal: ordinal, anchor: corpus[index]! });
        }
      }
      replicas.push({ ...header, pools });
    }
    if (!rows.next().done) fail("EXTRA_RECORDS");
    const pkg = { ...metadata, canonicalSourceCorpus: corpus, replicaArtifacts: replicas };
    if (
      !isDeepStrictEqual(identity(pkg), {
        organizationId: expected.organizationId,
        generationDigestHex: expected.generationDigestHex,
        contentDigestHex: expected.contentDigestHex,
      })
    )
      fail("PACKAGE_IDENTITY");
    validatePackage(pkg);
    return pkg;
  } finally {
    rows.return(undefined);
  }
}
