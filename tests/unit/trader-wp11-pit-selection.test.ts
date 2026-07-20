/**
 * HTR-WP11 — point-in-time provider timeline selection.
 */
import { describe, expect, it } from "vitest";

import {
  dedupePitTimelineEntries,
  isPitEligible,
  PIT_TIE_BREAK_ORDER,
  resolvePitLane,
  selectEligibleEntry,
  type PitTimelineEntry,
} from "@/lib/trader/market-data/replay/replay-pit-selector";

function entry(
  overrides: Partial<PitTimelineEntry> & Pick<PitTimelineEntry, "sourceDigest">,
): PitTimelineEntry {
  return {
    eventTimeUtc: "2026-01-01T00:20:00.000Z",
    ingestTimeUtc: "2026-01-01T00:21:00.000Z",
    providerId: "alternative_me",
    feedKind: "fear_greed_index",
    payload: { value: 50 },
    ...overrides,
  };
}

describe("HTR-WP11 PIT selection", () => {
  it("exposes stable tie-break order contract", () => {
    expect(PIT_TIE_BREAK_ORDER).toEqual([
      "availableAtUtc_or_ingestTimeUtc_desc",
      "eventTimeUtc_desc",
      "providerId_feedKind_asc",
      "sourceDigest_asc",
    ]);
  });

  it("isPitEligible rejects event, ingest, and availability after evaluatedAt", () => {
    const evaluatedAt = "2026-01-01T00:25:00.000Z";

    expect(isPitEligible(entry({ sourceDigest: "a" }), evaluatedAt)).toEqual({ eligible: true });

    expect(
      isPitEligible(
        entry({ sourceDigest: "b", eventTimeUtc: "2026-01-01T00:26:00.000Z" }),
        evaluatedAt,
      ).eligible,
    ).toBe(false);

    expect(
      isPitEligible(
        entry({ sourceDigest: "c", ingestTimeUtc: "2026-01-01T00:26:00.000Z" }),
        evaluatedAt,
      ),
    ).toMatchObject({ eligible: false, reason: "ingest_after_evaluated" });

    expect(
      isPitEligible(
        entry({
          sourceDigest: "d",
          availableAtUtc: "2026-01-01T00:26:00.000Z",
        }),
        evaluatedAt,
      ),
    ).toMatchObject({ eligible: false, reason: "available_after_evaluated" });
  });

  it("selectEligibleEntry prefers later availability then later event time", () => {
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    const laterAvailability = entry({
      sourceDigest: "later-availability",
      availableAtUtc: "2026-01-01T00:24:00.000Z",
      eventTimeUtc: "2026-01-01T00:18:00.000Z",
    });
    const laterEvent = entry({
      sourceDigest: "later-event",
      availableAtUtc: "2026-01-01T00:23:00.000Z",
      eventTimeUtc: "2026-01-01T00:22:00.000Z",
    });

    expect(selectEligibleEntry([laterEvent, laterAvailability], evaluatedAt)?.sourceDigest).toBe(
      "later-availability",
    );
  });

  it("selectEligibleEntry breaks provider ties deterministically", () => {
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    const binance = entry({
      sourceDigest: "binance",
      providerId: "binance_public",
      feedKind: "cross_exchange_confirmation",
    });
    const bybit = entry({
      sourceDigest: "bybit",
      providerId: "bybit_public",
      feedKind: "cross_exchange_confirmation",
    });

    expect(selectEligibleEntry([bybit, binance], evaluatedAt)?.providerId).toBe("binance_public");
  });

  it("dedupePitTimelineEntries keeps first entry per event/provider/digest key", () => {
    const first = entry({ sourceDigest: "dup", payload: { value: 1 } });
    const second = entry({ sourceDigest: "dup", payload: { value: 2 } });
    expect(dedupePitTimelineEntries([first, second])).toHaveLength(1);
  });

  it("resolvePitLane returns undefined when no eligible entries exist", () => {
    expect(
      resolvePitLane(
        [entry({ sourceDigest: "future", eventTimeUtc: "2026-01-01T01:00:00.000Z" })],
        "2026-01-01T00:25:00.000Z",
      ),
    ).toBeUndefined();
  });
});
