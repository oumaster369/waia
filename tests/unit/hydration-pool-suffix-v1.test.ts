// @vitest-environment node
import { createHash, Hash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as suffix from "@/lib/trader/intelligence/forecast-v2/hydration-pool-suffix-v1";
import * as quantizer from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { buildPoolSemanticDigestStream, computePoolSemanticDigest, type PoolSemanticDigestInput } from "@/lib/trader/intelligence/forecast-v2/pool-semantic-digest-v1";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { computePredictivePackageContentDigest, computePredictivePackageGenerationIdentityDigest, computeReplicaArtifactDigestK,
  computeReplicaRootFamilyIdentityDigest, computeRuntimeContractDigest } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { computeTerminalTargetGridIdentityDigestHex, serializeReplicaArtifactPayloadV1,
  type PredictivePackageV1, type ReplicaArtifact } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { computeTerminalTargetGridFromDevelopmentReturns } from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { encodePredictivePackageV1, hydratePredictivePackageV1, hydratePredictivePackageAsyncV1,
  type EncodedPredictivePackageV1 } from "@/lib/trader/intelligence/forecast-v2/predictive-package-codec-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

afterEach(() => vi.restoreAllMocks());
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest();
const family = buildHistoricalForecastFamilyV2({ organizationId: "00000000-0000-4000-8000-000000000001", symbol: "BTCUSDT",
  primaryHorizonMinutes: 30, developmentDatasetDigestHex: "a".repeat(64), releaseSha: "b".repeat(40) });
function anchors(n: number): SourceAnchor[] {
  return Array.from({ length: n }, (_, i) => ({ venue: "htx", market: "spot", symbol: "BTCUSDT",
    closedBarEpochMs: (28_333_334 + i) * 60000, barContentDigest: hash(String(i)).toString("hex"), realizedVol20m_1m: (i % 3 + 1) / 100,
    outcome13d: Array.from({ length: 13 }, (_, j) => i === 0 && j === 0 ? -0 : (i + j / 3) / 1000) }));
}
function pool(source: SourceAnchor[], replicaOrdinal = 0, stateId: "S0" | "S1" | "S2" = "S0"): PoolSemanticDigestInput {
  return { ...family, replicaOrdinal, stateId, observations: source.map((anchor, i) => ({ resamplePositionOrdinal: i, anchor })) };
}
/** Canonical data-only fixture. Rotated pools are not claimed to replay sampling. */
function fixture(k = 2, source = anchors(36)): PredictivePackageV1 {
  const replicaRootFamilyIdentityDigest = computeReplicaRootFamilyIdentityDigest(family);
  const replicaArtifacts: ReplicaArtifact[] = [];
  for (let ordinal = 0; ordinal < k; ordinal++) {
    const pools: ReplicaArtifact["pools"] = { S0: [], S1: [], S2: [] };
    for (let position = 0; position < source.length; position++) {
      const index = (position + ordinal * 5) % source.length;
      pools[(["S0", "S1", "S2"] as const)[index % 3]!].push({ resamplePositionOrdinal: position, anchor: source[index]! });
    }
    const artifact: ReplicaArtifact = { replicaOrdinal: ordinal, bootstrapRootK: hash(`synthetic-root-${ordinal}`), blockLength: 10,
      q1: 0.015, q2: 0.025, q1Scale8: "0.01500000", q2Scale8: "0.02500000", nS0: pools.S0.length, nS1: pools.S1.length, nS2: pools.S2.length,
      poolSemanticDigestS0: computePoolSemanticDigest({ ...family, replicaOrdinal: ordinal, stateId: "S0", observations: pools.S0 }),
      poolSemanticDigestS1: computePoolSemanticDigest({ ...family, replicaOrdinal: ordinal, stateId: "S1", observations: pools.S1 }),
      poolSemanticDigestS2: computePoolSemanticDigest({ ...family, replicaOrdinal: ordinal, stateId: "S2", observations: pools.S2 }),
      replicaArtifactDigest: Buffer.alloc(32), pools };
    artifact.replicaArtifactDigest = computeReplicaArtifactDigestK(serializeReplicaArtifactPayloadV1({ artifact, symbol: family.symbol,
      primaryHorizonMinutes: family.primaryHorizonMinutes }));
    replicaArtifacts.push(artifact);
  }
  const generation = computePredictivePackageGenerationIdentityDigest({ replicaRootFamilyIdentityDigestHex: replicaRootFamilyIdentityDigest.toString("hex"),
    kConfigDec: k, mConfigDec: 20, alphaEpiConfigScale8: "0.10000000" });
  const grid = computeTerminalTargetGridFromDevelopmentReturns(source.map(a => a.outcome13d[3]!));
  return { family, canonicalSourceCorpus: source, replicaArtifacts, replicaRootFamilyIdentityDigest,
    predictivePackageGenerationIdentityDigest: generation,
    predictivePackageContentDigest: computePredictivePackageContentDigest(generation, replicaArtifacts.map(a => a.replicaArtifactDigest)),
    kConfigDec: k, mConfigDec: 20, alphaEpiConfigScale8: "0.10000000", terminalTargetGrid: grid,
    terminalTargetGridIdentityDigestHex: computeTerminalTargetGridIdentityDigestHex(grid),
    runtimeContractDigest: computeRuntimeContractDigest({ osClass: process.platform, arch: process.arch, nodeVersionExact: process.version,
      codeReleaseSha: family.codeReleaseSha, modelTransformVersion: family.modelTransformVersion }) };
}
async function* asyncChunks(wire: EncodedPredictivePackageV1) { for (const chunk of wire.chunks) { await Promise.resolve(); yield chunk; } }
function reseal(wire: EncodedPredictivePackageV1) {
  wire.manifest.chunks = wire.chunks.map((chunk, ordinal) => ({ ordinal, byteLength: chunk.length,
    recordCount: chunk.toString().split("\n").length - 1, sha256: hash(chunk).toString("hex") }));
  const m = wire.manifest, h = createHash("sha256");
  h.update(JSON.stringify([m.version, m.organizationId, m.generationDigestHex, m.contentDigestHex,
    m.chunkByteLimit, m.sourceCount, m.replicaCount, m.chunks.length]) + "\n");
  for (const c of m.chunks) h.update(JSON.stringify([c.ordinal, c.byteLength, c.recordCount, c.sha256]) + "\n");
  m.manifestDigestHex = h.digest("hex");
}
function editRecord(wire: EncodedPredictivePackageV1, kind: string, mutate: (record: unknown[]) => void) {
  for (let i = 0; i < wire.chunks.length; i++) {
    const rows = wire.chunks[i]!.toString().trimEnd().split("\n").map(line => JSON.parse(line) as [string, unknown[][]]);
    const row = rows.find(r => r[0] === "a" && r[1][0]?.[1] === kind);
    if (row) { mutate(row[1]); wire.chunks[i] = Buffer.from(rows.map(r => JSON.stringify(r)).join("\n") + "\n"); reseal(wire); return; }
  }
  throw Error("missing fixture record");
}
const numberTag = (value: number) => { const bytes = Buffer.alloc(8); bytes.writeDoubleBE(value); return ["n", bytes.toString("hex")]; };

describe("private hydration suffix reuse", () => {
  it("emits exactly the original full bytes for all states, headers, ordinals and repeated anchors", () => {
    const source = anchors(4); source[1]!.symbol = "ETHUSDT"; source[2]!.venue = "字\nvenue";
    const base = pool(source), update = Hash.prototype.update;
    suffix.withHydrationPoolDigestsV1(source.length, compute => {
      for (const stateId of ["S0", "S1", "S2"] as const) {
        const input = { ...base, symbol: "ETHUSDT", replicaOrdinal: 49, stateId, observations: [
          { anchor: source[3]!, resamplePositionOrdinal: 9 }, { anchor: source[0]!, resamplePositionOrdinal: -1 },
          { anchor: source[1]!, resamplePositionOrdinal: 0 }, { anchor: source[2]!, resamplePositionOrdinal: -0 },
          { anchor: source[0]!, resamplePositionOrdinal: 2 }] };
        const expectedBytes = buildPoolSemanticDigestStream(input), expectedDigest = computePoolSemanticDigest(input), chunks: Buffer[] = [];
        const spy = vi.spyOn(Hash.prototype, "update").mockImplementation(function (this: Hash, data: Parameters<Hash["update"]>[0], encoding?: BufferEncoding) {
          chunks.push(typeof data === "string" ? Buffer.from(data, encoding) : Buffer.from(data as Uint8Array));
          return update.call(this, data, encoding ?? "utf8");
        });
        expect(compute(input)).toEqual(expectedDigest); spy.mockRestore();
        expect(Buffer.concat(chunks)).toEqual(expectedBytes);
      }
      expect(compute({ ...base, observations: [] })).toEqual(computePoolSemanticDigest({ ...base, observations: [] }));
    });
  });
  it("uses the exact quantizer for extrema, subnormals, signed zero and rounding neighbors", () => {
    const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, 2 ** -1022,
      0.000000005, -0.000000005, Number.MAX_SAFE_INTEGER];
    const bytes = Buffer.alloc(8); bytes.writeDoubleBE(1.000000005); const bits = bytes.readBigUInt64BE();
    for (const delta of [-1n, 0n, 1n]) { bytes.writeBigUInt64BE(bits + delta); values.push(bytes.readDoubleBE()); }
    let random = 0x123456789abcdef0n;
    for (let i = 0; i < 128; i++) {
      random = (random * 6364136223846793005n + 1n) & ((1n << 64n) - 1n); bytes.writeBigUInt64BE(random);
      if (Number.isFinite(bytes.readDoubleBE())) values.push(bytes.readDoubleBE());
    }
    const source = anchors(values.length); source.forEach((a, i) => { a.outcome13d = Array(13).fill(values[i]); });
    const input = pool(source), expected = computePoolSemanticDigest(input);
    suffix.withHydrationPoolDigestsV1(source.length, compute => { expect(compute(input)).toEqual(expected); expect(compute(input)).toEqual(expected); });
  });
  it("covers full, partial and zero suffix-capacity without dropping any digest work", () => {
    for (const large of [0, 1, 4]) {
      const source = anchors(4); for (let i = 0; i < large; i++) source[i]!.outcome13d = Array(13).fill(Number.MAX_VALUE);
      const input = pool(source), expected = computePoolSemanticDigest(input), q = vi.spyOn(quantizer, "quantizeScale8HalfUp");
      suffix.withHydrationPoolDigestsV1(source.length, compute => {
        expect(compute(input)).toEqual(expected); expect(compute(input)).toEqual(expected);
      });
      expect(q).toHaveBeenCalledTimes(13 * (4 + large)); q.mockRestore();
    }
  });
  it("falls back fully for unsupported text or failed arena allocation", () => {
    const source = anchors(3); source[0]!.symbol = "a".repeat(257);
    const input = pool(source), expected = computePoolSemanticDigest(input);
    suffix.withHydrationPoolDigestsV1(source.length, compute => expect(compute(input)).toEqual(expected));
    const originalAllocate = Buffer.allocUnsafeSlow;
    const allocation = vi.spyOn(Buffer, "allocUnsafeSlow").mockImplementation(size => {
      if (size === source.length * 512) throw new RangeError("synthetic allocation refusal");
      return originalAllocate(size);
    });
    suffix.withHydrationPoolDigestsV1(source.length, compute => { expect(compute(input)).toEqual(expected); expect(compute(input)).toEqual(expected); });
    allocation.mockRestore();
  });
  it("has proportional allocation, a finite total backing cap and a bounded entry table", () => {
    const allocate = vi.spyOn(Buffer, "allocUnsafeSlow");
    suffix.withHydrationPoolDigestsV1(4, () => undefined); expect(allocate).toHaveBeenLastCalledWith(4 * 512);
    suffix.withHydrationPoolDigestsV1(1_580_000, () => undefined);
    expect(allocate).toHaveBeenLastCalledWith(64 * 1024 * 1024 - 262_144 * 8);
    // For a one-source private scope, even a second distinct anchor cannot grow its entry table.
    const source = anchors(2), input = pool(source), expected = computePoolSemanticDigest(input), q = vi.spyOn(quantizer, "quantizeScale8HalfUp");
    suffix.withHydrationPoolDigestsV1(1, compute => { expect(compute(input)).toEqual(expected); expect(compute(input)).toEqual(expected); });
    expect(q).toHaveBeenCalledTimes(39);
  });
  it("does not mutate/freeze owned records and releases reuse on return or throw", () => {
    const source = anchors(2), input = pool(source); let escaped = computePoolSemanticDigest;
    suffix.withHydrationPoolDigestsV1(2, compute => { escaped = compute; compute(input); });
    source[0]!.outcome13d = Array(13).fill(3);
    expect(escaped(input)).toEqual(computePoolSemanticDigest(input));
    expect(Object.isFrozen(source[0])).toBe(false);
    expect(() => suffix.withHydrationPoolDigestsV1(2, compute => { escaped = compute; compute(input); throw Error("abort"); })).toThrow("abort");
    source[0]!.outcome13d = Array(13).fill(5);
    expect(escaped(input)).toEqual(computePoolSemanticDigest(input));
    source[0]!.outcome13d = [Infinity, ...Array(12).fill(0)]; expect(() => escaped(input)).toThrow();
  });
  it.each([NaN, Infinity, -Infinity])("preserves nonfinite rejection: %s", value => {
    const source = anchors(1); source[0]!.outcome13d = [value, ...Array(12).fill(0)];
    suffix.withHydrationPoolDigestsV1(1, compute => expect(() => compute(pool(source))).toThrow());
  });
  it.each([0, 12, 14])("preserves malformed vector rejection: %s elements", length => {
    const source = anchors(1); source[0]!.outcome13d = Array(length).fill(0);
    suffix.withHydrationPoolDigestsV1(1, compute => expect(() => compute(pool(source))).toThrow());
  });
});

describe("complete sync/async hydration with unchanged scientific verification", () => {
  it.each([2, 50])("matches uncached full codec, encoding bytes and mutable return semantics at K%s", async k => {
    const pkg = fixture(k), wire = encodePredictivePackageV1(pkg, 8192);
    const countQuantization = vi.spyOn(quantizer, "quantizeScale8HalfUp");
    const optimized = hydratePredictivePackageV1(wire.manifest, wire.chunks, wire.manifest);
    expect(countQuantization).toHaveBeenCalledTimes(pkg.canonicalSourceCorpus.length * 13 + 6);
    countQuantization.mockRestore();
    const asyncOptimized = await hydratePredictivePackageAsyncV1(wire.manifest, asyncChunks(wire), wire.manifest);
    const bypass = vi.spyOn(suffix, "withHydrationPoolDigestsV1").mockImplementation((_count, validate) => validate(computePoolSemanticDigest));
    const original = hydratePredictivePackageV1(wire.manifest, wire.chunks, wire.manifest);
    expect(optimized).toStrictEqual(original); expect(asyncOptimized).toStrictEqual(original); expect(original).toStrictEqual(pkg);
    expect(encodePredictivePackageV1(optimized, 8192)).toStrictEqual(wire); bypass.mockRestore();
    expect(Object.isFrozen(optimized.canonicalSourceCorpus[0])).toBe(false);
    optimized.canonicalSourceCorpus[0]!.outcome13d = Array(13).fill(7);
    expect(() => encodePredictivePackageV1(optimized)).toThrow("SCIENTIFIC_DIGEST");
    expect(hydratePredictivePackageV1(wire.manifest, wire.chunks, wire.manifest)).toStrictEqual(pkg);
  });
  it("keeps encoding out of the private reuse scope", () => {
    const pkg = fixture(), spy = vi.spyOn(suffix, "withHydrationPoolDigestsV1"); encodePredictivePackageV1(pkg);
    expect(spy).not.toHaveBeenCalled();
  });
  it("complete codec still validates under no cache and partial capacity", async () => {
    const source = anchors(6); source[0]!.outcome13d = Array(13).fill(Number.MAX_VALUE);
    const pkg = fixture(2, source), wire = encodePredictivePackageV1(pkg);
    expect(hydratePredictivePackageV1(wire.manifest, wire.chunks, wire.manifest)).toStrictEqual(pkg);
    const originalAllocate = Buffer.allocUnsafeSlow;
    const allocate = vi.spyOn(Buffer, "allocUnsafeSlow").mockImplementation(size => {
      if (size === source.length * 512) throw new RangeError("synthetic allocation refusal");
      return originalAllocate(size);
    });
    expect(hydratePredictivePackageV1(wire.manifest, wire.chunks, wire.manifest)).toStrictEqual(pkg);
    expect(await hydratePredictivePackageAsyncV1(wire.manifest, asyncChunks(wire), wire.manifest)).toStrictEqual(pkg);
    allocate.mockRestore();
  });
  it("source iteration cannot reach private decoded anchors, and sync final validation does not yield", async () => {
    const pkg = fixture(), wire = encodePredictivePackageV1(pkg, 8192), chunksBefore = wire.chunks.map(b => Buffer.from(b));
    const originalScope = suffix.withHydrationPoolDigestsV1; let finalValidation = false, queuedRan = false;
    const spy = vi.spyOn(suffix, "withHydrationPoolDigestsV1").mockImplementation((count, validate) => {
      finalValidation = true; queueMicrotask(() => { queuedRan = true; });
      const result = originalScope(count, validate); expect(queuedRan).toBe(false); finalValidation = false; return result;
    });
    async function* reader() { for (const chunk of wire.chunks) { expect(finalValidation).toBe(false); yield chunk; } }
    const restored = await hydratePredictivePackageAsyncV1(wire.manifest, reader(), wire.manifest);
    expect(spy).toHaveBeenCalledOnce(); expect(restored).toStrictEqual(pkg); expect(wire.chunks).toEqual(chunksBefore);
    expect(restored.canonicalSourceCorpus[0]).not.toBe(pkg.canonicalSourceCorpus[0]);
  });
  it.each(["source-index", "ordinal", "pool-count", "pool-digest", "source-vector", "chunk"])("still rejects %s in both transports", async kind => {
    const wire = encodePredictivePackageV1(fixture(), 8192);
    if (kind === "source-index") editRecord(wire, "draw", r => { r[2] = numberTag(1_000_000); });
    if (kind === "ordinal") editRecord(wire, "draw", r => { r[1] = numberTag(1_000_000); });
    if (kind === "pool-count") editRecord(wire, "pool", r => { r[2] = numberTag(1_000_000); });
    if (kind === "pool-digest") editRecord(wire, "replica", r => {
      const object = r[1] as [string, [[string, string], unknown][]];
      object[1].find(([key]) => key[1] === "poolSemanticDigestS0")![1] = ["b", "0".repeat(64)];
    });
    if (kind === "source-vector") editRecord(wire, "anchor", r => {
      const object = r[1] as [string, [[string, string], unknown][]];
      object[1].find(([key]) => key[1] === "outcome13d")![1] = ["a", []];
    });
    if (kind === "chunk") wire.chunks[wire.chunks.length - 1]![10] ^= 1;
    const refusal = (work: () => unknown) => { try { work(); } catch (error) { return (error as Error).message; } throw Error("expected refusal"); };
    const optimizedError = refusal(() => hydratePredictivePackageV1(wire.manifest, wire.chunks, wire.manifest));
    await expect(hydratePredictivePackageAsyncV1(wire.manifest, asyncChunks(wire), wire.manifest)).rejects.toThrow(optimizedError);
    const noCache = vi.spyOn(suffix, "withHydrationPoolDigestsV1").mockImplementation((_count, validate) => validate(computePoolSemanticDigest));
    expect(refusal(() => hydratePredictivePackageV1(wire.manifest, wire.chunks, wire.manifest))).toBe(optimizedError); noCache.mockRestore();
  });
});
