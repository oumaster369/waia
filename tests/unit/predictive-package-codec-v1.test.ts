import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import {
  buildPredictivePackageV1,
  verifyReplicaPoolReplayV1,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  decodePredictivePackageV1,
  encodePredictivePackageV1,
  hydratePredictivePackageV1,
  hydratePredictivePackageAsyncV1,
  streamEncodePredictivePackageV1,
  type EncodedPredictivePackageV1,
} from "@/lib/trader/intelligence/forecast-v2/predictive-package-codec-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

const family = buildHistoricalForecastFamilyV2({
  organizationId: "00000000-0000-4000-8000-000000000001",
  symbol: "BTCUSDT",
  primaryHorizonMinutes: 30,
  developmentDatasetDigestHex: "a".repeat(64),
  releaseSha: "b".repeat(40),
});
const corpus: SourceAnchor[] = Array.from({ length: 120 }, (_, i) => ({
  venue: "htx",
  market: "spot",
  symbol: "BTCUSDT",
  closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
  barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
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
const fixture = () =>
  buildPredictivePackageV1({ family, sourceCorpus: corpus, kConfigDec: 2, mConfigDec: 20 });
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
function clone(w: EncodedPredictivePackageV1): EncodedPredictivePackageV1 {
  return {
    manifest: { ...w.manifest, chunks: w.manifest.chunks.map((d) => ({ ...d })) },
    chunks: w.chunks.map((b) => Buffer.from(b)),
  };
}
// Independent wire resealing lets structural tests reach decoder checks even
// when a publisher has hashed malformed content. Production needs a trusted seal.
function reseal(w: EncodedPredictivePackageV1): void {
  for (let i = 0; i < w.chunks.length; i++) {
    w.manifest.chunks[i] = {
      ordinal: i,
      byteLength: w.chunks[i]!.length,
      recordCount: w.chunks[i]!.toString().split("\n").length - 1,
      sha256: sha(w.chunks[i]!),
    };
  }
  const m = w.manifest,
    h = createHash("sha256");
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
  m.manifestDigestHex = h.digest("hex");
}
type TaggedRow = [string, unknown[][]];
function editFirstDraw(w: EncodedPredictivePackageV1, edit: (row: TaggedRow) => void) {
  for (let i = 0; i < w.chunks.length; i++) {
    const rows: TaggedRow[] = w.chunks[i]!.toString()
      .trimEnd()
      .split("\n")
      .map((s) => JSON.parse(s));
    const row = rows.find((r) => r[1][0]?.[1] === "draw");
    if (!row) continue;
    edit(row);
    w.chunks[i] = Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    reseal(w);
    return;
  }
  throw new Error("missing draw fixture");
}
function numberTag(n: number): unknown[] {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n);
  return ["n", b.toString("hex")];
}

describe("bounded lossless predictive package codec phase 1", () => {
  it("hydrates async cursor input with exact parity, one outstanding read and awaited cleanup", async () => {
    const pkg = fixture(),
      w = encodePredictivePackageV1(pkg, 8192);
    let cursor = 0,
      outstanding = 0,
      peak = 0,
      closed = false;
    const next = vi.fn(async () => {
      peak = Math.max(peak, ++outstanding);
      await Promise.resolve();
      outstanding--;
      return cursor < w.chunks.length
        ? { done: false as const, value: w.chunks[cursor++]! }
        : { done: true as const, value: undefined };
    });
    const close = vi.fn(async () => {
      await Promise.resolve();
      closed = true;
      return { done: true as const, value: undefined };
    });
    const reader = { [Symbol.asyncIterator]: () => ({ next, return: close }) };
    const restored = await hydratePredictivePackageAsyncV1(w.manifest, reader, w.manifest);
    expect(restored).toStrictEqual(pkg);
    expect(peak).toBe(1);
    expect(next).toHaveBeenCalledTimes(w.chunks.length + 1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(closed).toBe(true);
    for (const artifact of restored.replicaArtifacts)
      verifyReplicaPoolReplayV1({
        family: restored.family,
        canonicalSourceCorpus: restored.canonicalSourceCorpus,
        artifact,
      });
  });
  it.each(["byte", "missing", "extra", "order", "source-index"])(
    "async hydration rejects %s and closes the source",
    async (kind) => {
      const w = encodePredictivePackageV1(fixture(), 8192);
      if (kind === "byte") w.chunks[0]![10] ^= 1;
      if (kind === "missing") w.chunks.pop();
      if (kind === "extra") w.chunks.push(w.chunks[0]!);
      if (kind === "order") [w.chunks[0], w.chunks[1]] = [w.chunks[1]!, w.chunks[0]!];
      if (kind === "source-index")
        editFirstDraw(w, (r) => {
          r[1][2] = numberTag(-1);
        });
      let closed = false;
      async function* reader() {
        try {
          yield* w.chunks;
        } finally {
          await Promise.resolve();
          closed = true;
        }
      }
      await expect(
        hydratePredictivePackageAsyncV1(w.manifest, reader(), w.manifest),
      ).rejects.toThrow();
      expect(closed).toBe(true);
    },
  );
  it("rejects an untrusted async manifest before opening the cursor", async () => {
    const w = encodePredictivePackageV1(fixture());
    const open = vi.fn();
    await expect(
      hydratePredictivePackageAsyncV1(
        w.manifest,
        { [Symbol.asyncIterator]: open },
        {
          ...w.manifest,
          organizationId: "other-org",
        },
      ),
    ).rejects.toThrow("MANIFEST");
    expect(open).not.toHaveBeenCalled();
  });
  it("retains the admitted manifest across asynchronous caller mutations", async () => {
    const pkg = fixture(),
      w = encodePredictivePackageV1(pkg, 8192);
    const expected = { ...w.manifest };
    async function* reader() {
      w.manifest.chunks[0]!.sha256 = "0".repeat(64);
      w.manifest.chunks.length = 0;
      w.manifest.sourceCount = 0;
      expected.organizationId = "mutated";
      yield* w.chunks;
    }
    expect(await hydratePredictivePackageAsyncV1(w.manifest, reader(), expected)).toStrictEqual(
      pkg,
    );
  });
  it("propagates async transport failures and awaits cursor cleanup", async () => {
    const w = encodePredictivePackageV1(fixture());
    const failure = new Error("cursor transport failed");
    let closed = false;
    const close = vi.fn(async () => {
      await Promise.resolve();
      closed = true;
      return { done: true as const, value: undefined };
    });
    await expect(
      hydratePredictivePackageAsyncV1(
        w.manifest,
        {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw failure;
            },
            return: close,
          }),
        },
        w.manifest,
      ),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledTimes(1);
    expect(closed).toBe(true);
  });
  it("retains both transport and cleanup failures instead of masking the primary cause", async () => {
    const w = encodePredictivePackageV1(fixture());
    const primary = new Error("read failure"),
      cleanup = new Error("close failure");
    await expect(
      hydratePredictivePackageAsyncV1(
        w.manifest,
        {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw primary;
            },
            return: async () => {
              throw cleanup;
            },
          }),
        },
        w.manifest,
      ),
    ).rejects.toMatchObject({
      message: "PREDICTIVE_PACKAGE_CODEC_REFUSED:READ_AND_CLEANUP",
      cause: primary,
      errors: [primary, cleanup],
    });
  });
  it("does not return a package when cursor cleanup fails after a complete read", async () => {
    const w = encodePredictivePackageV1(fixture());
    const input = w.chunks[Symbol.iterator]();
    const cleanup = new Error("close failure");
    await expect(
      hydratePredictivePackageAsyncV1(
        w.manifest,
        {
          [Symbol.asyncIterator]: () => ({
            next: async () => input.next(),
            return: async () => {
              throw cleanup;
            },
          }),
        },
        w.manifest,
      ),
    ).rejects.toBe(cleanup);
  });
  it("supports incremental byte emission and hydration without assembling a wire string", () => {
    const pkg = fixture(),
      reference = encodePredictivePackageV1(pkg, 8192);
    const producer = streamEncodePredictivePackageV1(pkg, 8192);
    let count = 0;
    for (;;) {
      const next = producer.next();
      if (next.done) {
        expect(next.value).toStrictEqual(reference.manifest);
        break;
      }
      expect(next.value).toEqual(reference.chunks[count++]);
    }
    let consumed = 0;
    function* reader() {
      for (const chunk of reference.chunks) {
        consumed++;
        yield chunk;
      }
    }
    expect(
      hydratePredictivePackageV1(reference.manifest, reader(), reference.manifest),
    ).toStrictEqual(pkg);
    expect(consumed).toBe(reference.chunks.length);
  });
  it("round trips the real builder and existing replay validators without refitting in the codec", () => {
    const pkg = fixture(),
      wire = encodePredictivePackageV1(pkg, 8192);
    const restored = decodePredictivePackageV1(wire, wire.manifest);
    expect(restored).toStrictEqual(pkg);
    expect(Object.is(restored.canonicalSourceCorpus[0]!.outcome13d[0], -0)).toBe(true);
    expect(Buffer.isBuffer(restored.runtimeContractDigest)).toBe(true);
    for (const artifact of restored.replicaArtifacts) {
      verifyReplicaPoolReplayV1({
        family: restored.family,
        canonicalSourceCorpus: restored.canonicalSourceCorpus,
        artifact,
      });
      for (const pool of Object.values(artifact.pools))
        for (const obs of pool) {
          expect(restored.canonicalSourceCorpus).toContain(obs.anchor);
        }
    }
    expect(wire.chunks.length).toBeGreaterThan(5);
    expect(wire.chunks.every((c) => c.length <= 8192)).toBe(true);
    expect(wire.manifest.chunks.reduce((n, d) => n + d.recordCount, 0)).toBe(
      1 + corpus.length + pkg.kConfigDec * (4 + corpus.length),
    );
    expect(encodePredictivePackageV1(pkg, 8192)).toStrictEqual(wire);
  });
  it("retains duplicate bootstrap draws and exact pool ordering", () => {
    const pkg = fixture(),
      decoded = decodePredictivePackageV1(
        encodePredictivePackageV1(pkg),
        encodePredictivePackageV1(pkg).manifest,
      );
    const draws = Object.values(decoded.replicaArtifacts[0]!.pools).flat();
    expect(new Set(draws.map((o) => o.anchor.closedBarEpochMs)).size).toBeLessThan(draws.length);
    expect(decoded.replicaArtifacts.map((a) => a.pools)).toStrictEqual(
      pkg.replicaArtifacts.map((a) => a.pools),
    );
  });
  it.each(["byte", "missing", "extra", "order", "length", "count", "digest"])(
    "rejects %s chunk corruption",
    (kind) => {
      const original = encodePredictivePackageV1(fixture(), 8192),
        w = clone(original);
      if (kind === "byte") w.chunks[0]![10] ^= 1;
      if (kind === "missing") w.chunks.pop();
      if (kind === "extra") w.chunks.push(Buffer.from(w.chunks[0]!));
      if (kind === "order") [w.chunks[0], w.chunks[1]] = [w.chunks[1]!, w.chunks[0]!];
      if (kind === "length") w.manifest.chunks[0]!.byteLength++;
      if (kind === "count") w.manifest.chunks[0]!.recordCount++;
      if (kind === "digest") w.manifest.chunks[0]!.sha256 = "0".repeat(64);
      expect(() => decodePredictivePackageV1(w, original.manifest)).toThrow();
    },
  );
  it.each([
    "organizationId",
    "generationDigestHex",
    "contentDigestHex",
    "manifestDigestHex",
  ] as const)("rejects wrong trusted %s", (key) => {
    const w = encodePredictivePackageV1(fixture());
    expect(() => decodePredictivePackageV1(w, { ...w.manifest, [key]: "0".repeat(64) })).toThrow(
      "MANIFEST",
    );
  });
  it("rejects package substitution even if the attacker recomputes all chunk seals", () => {
    const expected = encodePredictivePackageV1(fixture());
    const other = encodePredictivePackageV1(
      buildPredictivePackageV1({
        family,
        sourceCorpus: corpus.slice(1),
        kConfigDec: 2,
        mConfigDec: 20,
      }),
    );
    expect(() => decodePredictivePackageV1(other, expected.manifest)).toThrow("MANIFEST");
  });
  it.each([-1, 0.5, corpus.length])("rejects sealed invalid source index %s", (index) => {
    const w = encodePredictivePackageV1(fixture());
    editFirstDraw(w, (row) => {
      row[1][2] = numberTag(index);
    });
    expect(() => decodePredictivePackageV1(w, w.manifest)).toThrow("SOURCE_INDEX");
  });
  it("closes incremental input on a malformed indexed record", () => {
    const w = encodePredictivePackageV1(fixture());
    editFirstDraw(w, (row) => {
      row[1][2] = numberTag(-1);
    });
    let closed = false;
    function* reader() {
      try {
        yield* w.chunks;
      } finally {
        closed = true;
      }
    }
    expect(() => hydratePredictivePackageV1(w.manifest, reader(), w.manifest)).toThrow(
      "SOURCE_INDEX",
    );
    expect(closed).toBe(true);
  });
  it("rejects incomplete 13D outcomes in source anchors including unsampled rows", () => {
    const pkg = fixture();
    pkg.canonicalSourceCorpus[0] = { ...pkg.canonicalSourceCorpus[0]!, outcome13d: [0] };
    expect(() => encodePredictivePackageV1(pkg)).toThrow("SOURCE_ANCHOR");
  });
  it("rejects sealed duplicate resample ordinals, not legitimate repeated source indices", () => {
    const pkg = fixture(),
      w = encodePredictivePackageV1(pkg);
    editFirstDraw(w, (row) => {
      row[1][1] = numberTag(pkg.replicaArtifacts[0]!.pools.S0[1]!.resamplePositionOrdinal);
    });
    expect(() => decodePredictivePackageV1(w, w.manifest)).toThrow("RESAMPLE_ORDINAL");
  });
  it("rejects duplicate source identity despite differing digest", () => {
    const pkg = fixture();
    pkg.canonicalSourceCorpus.push({
      ...pkg.canonicalSourceCorpus[0]!,
      barContentDigest: "c".repeat(64),
    });
    expect(() => encodePredictivePackageV1(pkg)).toThrow("SOURCE_CORPUS_DUPLICATE_ANCHOR");
  });
  it("rejects duplicate anchors during hydration even under a recomputed publisher seal", () => {
    const w = encodePredictivePackageV1(fixture());
    const rows: TaggedRow[] = w.chunks[0]!.toString()
      .trimEnd()
      .split("\n")
      .map((s) => JSON.parse(s));
    const anchors = rows.map((r, i) => (r[1][0]?.[1] === "anchor" ? i : -1)).filter((i) => i >= 0);
    expect(anchors.length).toBeGreaterThan(1);
    rows[anchors[1]!] = rows[anchors[0]!]!;
    w.chunks[0] = Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    reseal(w);
    expect(() => decodePredictivePackageV1(w, w.manifest)).toThrow(
      "SOURCE_CORPUS_DUPLICATE_ANCHOR",
    );
  });
  it("rejects an oversized individual metadata record rather than stringify an unbounded body", () => {
    const pkg = { ...fixture(), extraMetadata: "x".repeat(70_000) };
    expect(() => encodePredictivePackageV1(pkg)).toThrow("RECORD_TOO_LARGE");
  });
  it("rejects same-ID sub-quantizer outcome substitution instead of silently normalizing it", () => {
    const pkg = fixture(),
      obs = pkg.replicaArtifacts[0]!.pools.S0[0]!;
    obs.anchor = {
      ...obs.anchor,
      outcome13d: obs.anchor.outcome13d.map((n, i) => (i === 0 ? n + 1e-12 : n)),
    };
    expect(() => encodePredictivePackageV1(pkg)).toThrow("ANCHOR_SUBSTITUTION");
  });
  it("rejects stubbed scientific digests and invalid chunk limits", () => {
    const pkg = fixture();
    pkg.replicaArtifacts[0]!.replicaArtifactDigest = Buffer.alloc(32);
    expect(() => encodePredictivePackageV1(pkg)).toThrow("SCIENTIFIC_DIGEST");
    for (const limit of [0, 1023, 65537, Infinity, NaN])
      expect(() => encodePredictivePackageV1(fixture(), limit)).toThrow("CHUNK_LIMIT");
  });
});
