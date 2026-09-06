// @vitest-environment node
import { constants } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { SourceAnchor } from
  "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { canonicalizeSemanticJsonString } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  canonicalSourceCorporaEqualV2,
  computeKmDevelopmentCorpusDigestV2,
} from "@/lib/trader/research/execopp-qualification/km-corpus-serialization-v2";

function anchor(index = 0): SourceAnchor {
  return {
    venue: "htx", market: "spot", symbol: "BTCUSDT",
    closedBarEpochMs: (26_297_280 + index) * 60_000,
    barContentDigest: "a".repeat(64), realizedVol20m_1m: 0.01,
    outcome13d: [0, -0, -0.00001, 1e-8, 1e21, 0.5, 2, 100, 101, 102, 103, 104, 105],
  };
}

function input(corpus: readonly SourceAnchor[]) {
  return {
    schemaVersion: "km-development-corpus/v2" as const,
    organizationId: "org-\"\\\n😀\ud800",
    datasetAuthorityIdentityDigestHex: "b".repeat(64),
    surface: { symbol: "BTCUSDT" as const, primaryHorizonMinutes: 30 as const },
    corpus,
  };
}

// Frozen canonical algorithm from BF, not the production streaming helper.
function legacyCanonical(value: unknown): string {
  function sort(value: unknown): unknown {
    if (value === null || ["boolean", "string"].includes(typeof value)) return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw Error("non-finite");
      return value;
    }
    if (Array.isArray(value)) return value.map(sort);
    if (typeof value === "object" && value !== null) {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
        result[key] = sort((value as Record<string, unknown>)[key]);
      }
      return result;
    }
    throw Error("unsupported");
  }
  return JSON.stringify(sort(value));
}

describe("bounded canonical DEVELOPMENT corpus serialization", () => {
  it.each([0, 1, 7, 4_100])("preserves legacy SHA256 for %i anchors", (count) => {
    const value = input(Array.from({ length: count }, (_, i) => anchor(i)));
    const expected = createHash("sha256").update(legacyCanonical(value)).digest("hex");
    expect(computeKmDevelopmentCorpusDigestV2(value)).toBe(expected);
  });

  it("preserves equality for reordered object keys and JSON numeric semantics", () => {
    const a = anchor();
    const b = Object.fromEntries(Object.entries(a).reverse()) as SourceAnchor;
    expect(canonicalSourceCorporaEqualV2([a], [b])).toBe(true);
    expect(canonicalSourceCorporaEqualV2([a, anchor(1)], [anchor(1), a])).toBe(false);
    expect(canonicalSourceCorporaEqualV2([a], [])).toBe(false);
    expect(canonicalSourceCorporaEqualV2([a], [{ ...a, realizedVol20m_1m: 0.02 }])).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity])("does not admit invalid numeric data: %s", (n) => {
    const bad = { ...anchor(), realizedVol20m_1m: n };
    expect(() => computeKmDevelopmentCorpusDigestV2(input([bad])))
      .toThrow("non-finite number prohibited");
    expect(() => canonicalSourceCorporaEqualV2([bad], [bad]))
      .toThrow("non-finite number prohibited");
  });

  it("never calls JSON.stringify on the complete array or corpus envelope", () => {
    const value = input(Array.from({ length: 4_100 }, (_, i) => anchor(i)));
    const stringify = JSON.stringify;
    const spy = vi.spyOn(JSON, "stringify").mockImplementation((object, ...rest) => {
      if ((Array.isArray(object) && object.length >= 4_100) ||
          (object && typeof object === "object" && "corpus" in object)) {
        throw Error("whole-corpus serialization forbidden");
      }
      return stringify(object, ...rest);
    });
    try {
      expect(canonicalSourceCorporaEqualV2(value.corpus, value.corpus)).toBe(true);
      expect(computeKmDevelopmentCorpusDigestV2(value)).toMatch(/^[a-f0-9]{64}$/);
    } finally { spy.mockRestore(); }
  });

  it("hashes canonical bytes beyond V8's string limit without a corpus-sized string", () => {
    // Shared immutable anchor avoids retaining >512MB of unique input. This is a
    // serialization-capacity regression, not a realistic forecast/scientific fixture.
    const largeAnchor = { ...anchor(), barContentDigest: "a".repeat(128 * 1024) };
    const serializedAnchor = canonicalizeSemanticJsonString(largeAnchor);
    const count = Math.ceil((constants.MAX_STRING_LENGTH + 1) / (serializedAnchor.length + 1));
    const corpus = Array.from({ length: count }, () => largeAnchor);
    expect((serializedAnchor.length + 1) * count).toBeGreaterThan(constants.MAX_STRING_LENGTH);
    // Native legacy operation really fails at its string-size boundary.
    expect(() => JSON.stringify(corpus)).toThrow(RangeError);
    const value = input(corpus);
    const smallEnvelope = legacyCanonical(input([]));
    const marker = '"corpus":[]';
    const split = smallEnvelope.indexOf(marker);
    expect(split).toBeGreaterThanOrEqual(0);
    const oracle = createHash("sha256").update(smallEnvelope.slice(0, split) + '"corpus":[');
    for (let i = 0; i < count; i += 1) {
      if (i) oracle.update(",");
      oracle.update(serializedAnchor);
    }
    oracle.update("]" + smallEnvelope.slice(split + marker.length));
    expect(computeKmDevelopmentCorpusDigestV2(value)).toBe(oracle.digest("hex"));
    expect(canonicalSourceCorporaEqualV2(corpus, corpus)).toBe(true);
  }, 120_000);
});
