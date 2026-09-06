// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  buildPoolSemanticDigestStream,
  computePoolSemanticDigest,
  type PoolSemanticDigestInput,
} from "@/lib/trader/intelligence/forecast-v2/pool-semantic-digest-v1";
import { quantizeScale8HalfUp } from
  "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { assertAsciiLine, assertCanonicalIntegerLine, assertDigestHex64 } from
  "@/lib/trader/intelligence/forecast-v2/scientific-identity-validators-v1";
import { FEATURE_VERSION, OUTCOME_VERSION, POOL_SEM_VERSION, STATE_ASSIGNMENT_VERSION } from
  "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

const line = (value: string) => Buffer.from(`${value}\n`, "utf8");

// Frozen pre-DEE-940 serialization algorithm: independent of the shared production emitter.
function legacyStream(input: PoolSemanticDigestInput): Buffer {
  assertAsciiLine(input.organizationId, "organizationId");
  assertAsciiLine(input.venue, "venue");
  assertAsciiLine(input.market, "market");
  assertAsciiLine(input.symbol, "symbol");
  assertDigestHex64(input.developmentDatasetDigestHex, "developmentDatasetDigestHex");
  const chunks = [
    line(POOL_SEM_VERSION), line(input.organizationId), line(input.venue),
    line(input.market), line(input.symbol),
    line(assertCanonicalIntegerLine(input.primaryHorizonMinutes, "primaryHorizonMinutes")),
    line(assertCanonicalIntegerLine(input.replicaOrdinal, "replicaOrdinal")),
    line(input.stateId), line(FEATURE_VERSION), line(OUTCOME_VERSION),
    line(STATE_ASSIGNMENT_VERSION), Buffer.from(input.developmentDatasetDigestHex, "hex"),
    line(assertCanonicalIntegerLine(input.observations.length, "n_pool")),
  ];
  const ordered = [...input.observations].sort(
    (a, b) => a.resamplePositionOrdinal - b.resamplePositionOrdinal,
  );
  for (const obs of ordered) {
    chunks.push(line(assertCanonicalIntegerLine(obs.resamplePositionOrdinal, "resamplePositionOrdinal")));
    chunks.push(line(assertCanonicalIntegerLine(obs.anchor.closedBarEpochMs, "closedBarEpochMs")));
    chunks.push(line(obs.anchor.venue), line(obs.anchor.market), line(obs.anchor.symbol));
    if (obs.anchor.outcome13d.length !== 13) {
      throw new Error("[forecast-v2/pool-sem] outcome13d must have 13 components");
    }
    for (const component of obs.anchor.outcome13d) {
      chunks.push(line(quantizeScale8HalfUp(component)));
    }
  }
  return Buffer.concat(chunks);
}

function input(count = 12): PoolSemanticDigestInput {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    venue: "htx", market: "spot", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    replicaOrdinal: 0, stateId: "S0", developmentDatasetDigestHex: "a".repeat(64),
    observations: Array.from({ length: count }, (_, index) => ({
      resamplePositionOrdinal: index,
      anchor: {
        venue: "htx", market: "spot", symbol: "BTCUSDT",
        closedBarEpochMs: 1_577_836_860_000 + index * 60_000,
        barContentDigest: "b".repeat(64), realizedVol20m_1m: 0.02,
        outcome13d: [0, -0, 0.000000005, -0.000000005, 0.123456789,
          -0.123456789, Number.MIN_VALUE, 1, 2.5, 3, 4, 5, 6 + index],
      },
    })),
  };
}

function errorOf(run: () => unknown) {
  try { run(); } catch (error) {
    const failure = error as Error & { code?: string };
    return { constructor: failure.constructor, name: failure.name,
      message: failure.message, code: failure.code };
  }
  throw new Error("Expected invalid input to fail");
}

describe("incremental pool semantic hashing", () => {
  for (const horizon of [30, 60]) {
    for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
      for (const stateId of ["S0", "S1", "S2"] as const) {
        it(`preserves bytes for ${symbol}/${horizon}/${stateId}, empty and shuffled pools`, () => {
          for (const count of [0, 1, 12]) {
            const candidate = { ...input(count), symbol, primaryHorizonMinutes: horizon, stateId };
            candidate.observations = candidate.observations.map((obs) =>
              ({ ...obs, anchor: { ...obs.anchor, symbol } })).reverse();
            const originalOrder = [...candidate.observations];
            const canonical = legacyStream(candidate);
            expect(buildPoolSemanticDigestStream(candidate)).toEqual(canonical);
            expect(computePoolSemanticDigest(candidate)).toEqual(createHash("sha256").update(canonical).digest());
            expect(candidate.observations).toEqual(originalOrder);
          }
        });
      }
    }
  }

  it("retains stable ordering of duplicate ordinals rather than adding a new rejection", () => {
    const candidate = input(4);
    candidate.observations = [candidate.observations[3]!, candidate.observations[0]!,
      candidate.observations[2]!, candidate.observations[1]!]
      .map((obs) => ({ ...obs, resamplePositionOrdinal: 7 }));
    const canonical = legacyStream(candidate);
    expect(buildPoolSemanticDigestStream(candidate)).toEqual(canonical);
    expect(computePoolSemanticDigest(candidate)).toEqual(createHash("sha256").update(canonical).digest());
    expect(computePoolSemanticDigest({ ...candidate, observations: [...candidate.observations].reverse() }))
      .not.toEqual(computePoolSemanticDigest(candidate));
  });

  it("preserves validation failure type, code, message and first-error ordering", () => {
    const cases: PoolSemanticDigestInput[] = [
      { ...input(), organizationId: "bad\norg", developmentDatasetDigestHex: "invalid" },
      { ...input(), venue: "hτx" }, { ...input(), market: "spot\n" },
      { ...input(), symbol: "BTC\nUSDT" }, { ...input(), developmentDatasetDigestHex: "invalid" },
      { ...input(), primaryHorizonMinutes: 0.5, replicaOrdinal: Number.NaN },
      { ...input(), replicaOrdinal: Number.NaN },
    ];
    for (const change of ["ordinal", "epoch", "dimension", "nonfinite"] as const) {
      const candidate = input();
      const obs = candidate.observations[0]!;
      if (change === "ordinal") obs.resamplePositionOrdinal = 0.5;
      if (change === "epoch") obs.anchor.closedBarEpochMs = Number.NaN;
      if (change === "dimension") obs.anchor.outcome13d = [1, 2];
      if (change === "nonfinite") obs.anchor.outcome13d = [Number.POSITIVE_INFINITY, ...Array(12).fill(0)];
      cases.push(candidate);
    }
    for (const candidate of cases) {
      const expected = errorOf(() => legacyStream(candidate));
      expect(errorOf(() => buildPoolSemanticDigestStream(candidate))).toEqual(expected);
      expect(errorOf(() => computePoolSemanticDigest(candidate))).toEqual(expected);
    }
  });

  it("hashes a bounded 10k-observation pool without accumulating a concatenation array", () => {
    const candidate = input(10_000);
    const canonical = legacyStream(candidate);
    const expected = createHash("sha256").update(canonical).digest();
    const concat = vi.spyOn(Buffer, "concat");
    try {
      expect(computePoolSemanticDigest(candidate)).toEqual(expected);
      expect(concat).not.toHaveBeenCalled();
      buildPoolSemanticDigestStream(candidate);
      expect(concat).toHaveBeenCalledTimes(1);
      // The compatibility API still materializes the exact legacy stream. The digest API must not.
      expect(concat.mock.calls[0]![0]).toHaveLength(13 + 18 * candidate.observations.length);
    } finally { concat.mockRestore(); }
  });
});
