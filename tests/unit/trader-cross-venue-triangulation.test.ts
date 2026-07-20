import { describe, expect, it } from "vitest";

import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
} from "@/lib/trader/market-data/normalization/normalize-observation";

const evaluatedAt = "2026-01-01T14:00:00.000Z";

function makeObservation(confirmLast: string, venue: "binance" | "bybit") {
  return normalizeCrossExchangeConfirmation({
    symbol: "BTC/USDT",
    primaryLast: "64000",
    confirmLast,
    confirmVenue: venue,
    provenance: buildProvenanceRef({
      providerId: venue === "binance" ? "binance_public" : "bybit_public",
      venue,
      feedKind: "cross_exchange_confirmation",
      symbol: "BTC/USDT",
      eventTimeUtc: evaluatedAt,
    }),
    latencyMs: 5,
    evaluatedAt,
  });
}

describe("PR2.6 cross-venue triangulation", () => {
  it("returns UNAVAILABLE when both venues missing", () => {
    const result = buildCrossVenueTriangulation({});
    expect(result.agreement).toBe("UNAVAILABLE");
    expect(result.binanceDeltaBps).toBeNull();
    expect(result.bybitDeltaBps).toBeNull();
  });

  it("returns AGREE when both venues within threshold", () => {
    const result = buildCrossVenueTriangulation({
      binance: makeObservation("64005", "binance"),
      bybit: makeObservation("64006", "bybit"),
    });
    expect(result.agreement).toBe("AGREE");
    expect(result.binanceDeltaBps).not.toBeNull();
    expect(result.bybitDeltaBps).not.toBeNull();
  });

  it("returns DISAGREE when dislocation exceeds threshold", () => {
    const result = buildCrossVenueTriangulation({
      binance: makeObservation("65000", "binance"),
      bybit: makeObservation("64000", "bybit"),
    });
    expect(result.agreement).toBe("DISAGREE");
    expect(result.reasonCodes).toContain("CROSS_VENUE_DISAGREE");
  });

  it("returns PARTIAL when only one venue present with moderate dislocation", () => {
    const result = buildCrossVenueTriangulation({
      binance: makeObservation("64200", "binance"),
    });
    expect(result.agreement).toBe("PARTIAL");
    expect(result.bybitDeltaBps).toBeNull();
  });
});
