import { describe, expect, it } from "vitest";

import {
  assertStreamingBarSetDigestParity,
  finalizeBarSetDigestStreaming,
} from "@/lib/trader/market-data/fhv-streaming-bar-set-digest";
import { finalizeBarSetDigestFromBarDigests } from "@/lib/trader/market-data/research-dataset";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import type { Bar } from "@/lib/trader/intelligence/types";
import { assertHtxOfficialSourceCapabilityProven } from "@/lib/trader/market-data/fhv-htx-source-capability";

describe("fhv streaming infrastructure", () => {
  it("FHV_STREAMING_BAR_SET_DIGEST_BYTE_PARITY_PASS on empty, one bar, equal timestamp, fixture-sized", () => {
    assertStreamingBarSetDigestParity([]);
    const bar: Bar = {
      symbol: "BTC/USDT",
      interval: "1m",
      open: "1",
      high: "2",
      low: "0.5",
      close: "1.5",
      volume: "10",
      barOpenTime: "2020-01-01T00:00:00.000Z",
      barCloseTime: "2020-01-01T00:01:00.000Z",
    };
    const digests = [computeBarContentDigest(bar)];
    assertStreamingBarSetDigestParity(digests);
    const btc = computeBarContentDigest(bar);
    const ethBar: Bar = { ...bar, symbol: "ETH/USDT" };
    const eth = computeBarContentDigest(ethBar);
    assertStreamingBarSetDigestParity([btc, eth]);
    const large = Array.from({ length: 500 }, (_, index) =>
      computeBarContentDigest({
        ...bar,
        barOpenTime: new Date(
          Date.parse("2020-01-01T00:00:00.000Z") + index * 60_000,
        ).toISOString(),
        barCloseTime: new Date(
          Date.parse("2020-01-01T00:00:00.000Z") + (index + 1) * 60_000,
        ).toISOString(),
      }),
    );
    assertStreamingBarSetDigestParity(large);
    expect(finalizeBarSetDigestStreaming(large)).toBe(finalizeBarSetDigestFromBarDigests(large));
  });

  it("HTX_OFFICIAL_2020_2025_SOURCE_CAPABILITY_PROVEN artifact validates", () => {
    const artifact = assertHtxOfficialSourceCapabilityProven();
    expect(artifact.classification).toBe("FHV_HTX_HISTORICAL_SOURCE_CAPABILITY_PROVEN");
    expect(artifact.earliestProvenTimestamp).toBe("2020-01-01T00:00:00.000Z");
    expect(artifact.latestProvenTimestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});
