/**
 * HTR-WP12 — ingress bar-integrity gate (all 9 failure codes).
 */
import { describe, expect, it } from "vitest";

import {
  assertIngestBarsIntegrity,
  INGRESS_INTEGRITY_REASON_CODES,
} from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import {
  makeSyntheticBars,
  SYNTHETIC_SOURCE_PROVENANCE,
} from "@/tests/unit/helpers/wp11-wp12-fixture";

function gateInput(bars: ReturnType<typeof makeSyntheticBars>) {
  return {
    bars,
    expectedSymbol: "BTC/USDT",
    expectedInterval: "1m" as const,
  };
}

function expectGateFailure(
  result: ReturnType<typeof assertIngestBarsIntegrity>,
  reason: (typeof INGRESS_INTEGRITY_REASON_CODES)[number],
) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe(reason);
  }
}

describe("HTR-WP12 ingress bar-integrity gate", () => {
  it("pins all nine integrity reason codes", () => {
    expect(INGRESS_INTEGRITY_REASON_CODES).toEqual([
      "HTR_WP12_INGRESS_IDENTITY_MISMATCH",
      "HTR_WP12_INGRESS_NON_MONOTONIC",
      "HTR_WP12_INGRESS_DUPLICATE",
      "HTR_WP12_INGRESS_INTERVAL_MISALIGNED",
      "HTR_WP12_INGRESS_NON_FINITE_OHLCV",
      "HTR_WP12_INGRESS_NEGATIVE_VOLUME",
      "HTR_WP12_INGRESS_INVALID_OHLC_RELATION",
      "HTR_WP12_INGRESS_MALFORMED_PROVENANCE",
      "HTR_WP12_INGRESS_DIGEST_MISMATCH",
    ]);
  });

  it("passes clean synthetic bars and records zero gaps", () => {
    const bars = makeSyntheticBars(25);
    const result = assertIngestBarsIntegrity(gateInput(bars));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gaps).toHaveLength(0);
      expect(result.barSetDigest).toBeTruthy();
      expect(result.normalizedContentDigest).toBeTruthy();
    }
  });

  it("HTR_WP12_INGRESS_IDENTITY_MISMATCH on empty or wrong symbol", () => {
    expectGateFailure(
      assertIngestBarsIntegrity({ ...gateInput([]) }),
      "HTR_WP12_INGRESS_IDENTITY_MISMATCH",
    );

    const bars = makeSyntheticBars(25);
    bars[0] = { ...bars[0]!, symbol: "ETH/USDT" };
    expectGateFailure(
      assertIngestBarsIntegrity(gateInput(bars)),
      "HTR_WP12_INGRESS_IDENTITY_MISMATCH",
    );
  });

  it("HTR_WP12_INGRESS_NON_MONOTONIC on out-of-order bars", () => {
    const bars = makeSyntheticBars(25);
    [bars[10], bars[11]] = [bars[11]!, bars[10]!];
    expectGateFailure(assertIngestBarsIntegrity(gateInput(bars)), "HTR_WP12_INGRESS_NON_MONOTONIC");
  });

  it("HTR_WP12_INGRESS_DUPLICATE on repeated barOpenTime", () => {
    const bars = makeSyntheticBars(25);
    bars[11] = { ...bars[10]! };
    expectGateFailure(assertIngestBarsIntegrity(gateInput(bars)), "HTR_WP12_INGRESS_DUPLICATE");
  });

  it("HTR_WP12_INGRESS_INTERVAL_MISALIGNED on invalid bar duration", () => {
    const bars = makeSyntheticBars(25);
    bars[5] = {
      ...bars[5]!,
      barCloseTime: new Date(Date.parse(bars[5]!.barOpenTime) + 120_000).toISOString(),
    };
    expectGateFailure(
      assertIngestBarsIntegrity(gateInput(bars)),
      "HTR_WP12_INGRESS_INTERVAL_MISALIGNED",
    );
  });

  it("HTR_WP12_INGRESS_NON_FINITE_OHLCV on invalid timestamps or NaN fields", () => {
    const invalidTimestamp = makeSyntheticBars(25);
    invalidTimestamp[3] = { ...invalidTimestamp[3]!, barOpenTime: "not-a-date" };
    expectGateFailure(
      assertIngestBarsIntegrity(gateInput(invalidTimestamp)),
      "HTR_WP12_INGRESS_NON_FINITE_OHLCV",
    );

    const nonFinite = makeSyntheticBars(25);
    nonFinite[3] = { ...nonFinite[3]!, close: "NaN" };
    expectGateFailure(
      assertIngestBarsIntegrity(gateInput(nonFinite)),
      "HTR_WP12_INGRESS_NON_FINITE_OHLCV",
    );
  });

  it("HTR_WP12_INGRESS_NEGATIVE_VOLUME rejects negative volume", () => {
    const bars = makeSyntheticBars(25);
    bars[4] = { ...bars[4]!, volume: "-1" };
    expectGateFailure(
      assertIngestBarsIntegrity(gateInput(bars)),
      "HTR_WP12_INGRESS_NEGATIVE_VOLUME",
    );
  });

  it("HTR_WP12_INGRESS_INVALID_OHLC_RELATION rejects impossible OHLC", () => {
    const bars = makeSyntheticBars(25);
    bars[4] = { ...bars[4]!, high: "1", low: "99999" };
    expectGateFailure(
      assertIngestBarsIntegrity(gateInput(bars)),
      "HTR_WP12_INGRESS_INVALID_OHLC_RELATION",
    );
  });

  it("HTR_WP12_INGRESS_MALFORMED_PROVENANCE rejects bad provenance", () => {
    const bars = makeSyntheticBars(25);
    expectGateFailure(
      assertIngestBarsIntegrity({
        ...gateInput(bars),
        requireProvenance: true,
      }),
      "HTR_WP12_INGRESS_MALFORMED_PROVENANCE",
    );

    expectGateFailure(
      assertIngestBarsIntegrity({
        ...gateInput(bars),
        sourceProvenance: [
          {
            ...SYNTHETIC_SOURCE_PROVENANCE[0]!,
            sourceChecksumSha256: "not-a-sha256",
          },
        ],
      }),
      "HTR_WP12_INGRESS_MALFORMED_PROVENANCE",
    );
  });

  it("HTR_WP12_INGRESS_DIGEST_MISMATCH rejects expected digest drift", () => {
    const bars = makeSyntheticBars(25);
    expectGateFailure(
      assertIngestBarsIntegrity({
        ...gateInput(bars),
        expectedBarSetDigest: "0".repeat(64),
      }),
      "HTR_WP12_INGRESS_DIGEST_MISMATCH",
    );

    const normalizedContentDigest = computeStableJsonDigest({
      barDigests: bars.map((bar) => computeBarContentDigest(bar)),
    });
    expectGateFailure(
      assertIngestBarsIntegrity({
        ...gateInput(bars),
        expectedBarSetDigest: computeBarSetDigest(bars),
        expectedNormalizedContentDigest: `${normalizedContentDigest.slice(0, -1)}0`,
      }),
      "HTR_WP12_INGRESS_DIGEST_MISMATCH",
    );
  });
});
