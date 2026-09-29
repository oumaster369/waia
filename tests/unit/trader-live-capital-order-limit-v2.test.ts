import { describe, expect, it } from "vitest";

import { liveCapitalOrderLimitV2 } from "@/lib/trader/risk/v2/live-capital-order-limit-v2";

const bound = {
  basisBound: true,
  windowOpen: true,
  identityMatches: true,
};

describe("live capital order limit (DEE-1151 P0-2)", () => {
  it("caps the order at the loss limit when capital equals exposure", () => {
    expect(
      liveCapitalOrderLimitV2({
        ...bound,
        exposureLimitNotional: "100",
        capitalNotional: "100",
        lossLimitNotional: "25",
      }),
    ).toEqual({ ok: true, effectiveLimitNotional: "25" });
  });

  it("refuses when the envelope is missing", () => {
    expect(
      liveCapitalOrderLimitV2({
        ...bound,
        basisBound: false,
        exposureLimitNotional: "100",
        capitalNotional: "100",
        lossLimitNotional: "100",
      }).ok,
    ).toBe(false);
  });

  it("refuses a stale window", () => {
    expect(
      liveCapitalOrderLimitV2({
        ...bound,
        windowOpen: false,
        exposureLimitNotional: "100",
        capitalNotional: "100",
        lossLimitNotional: "100",
      }),
    ).toMatchObject({ ok: false, reason: "LIVE_CAPITAL_ENVELOPE_STALE" });
  });

  it("refuses a changed identity", () => {
    expect(
      liveCapitalOrderLimitV2({
        ...bound,
        identityMatches: false,
        exposureLimitNotional: "100",
        capitalNotional: "100",
        lossLimitNotional: "100",
      }),
    ).toMatchObject({ ok: false, reason: "LIVE_CAPITAL_IDENTITY_CHANGED" });
  });

  it("refuses when capital does not equal the exposure limit", () => {
    expect(
      liveCapitalOrderLimitV2({
        ...bound,
        exposureLimitNotional: "100",
        capitalNotional: "10",
        lossLimitNotional: "10",
      }),
    ).toMatchObject({ ok: false, reason: "LIVE_CAPITAL_LIMIT_MISMATCH" });
  });

  it("refuses a zero capital or loss amount", () => {
    expect(
      liveCapitalOrderLimitV2({
        ...bound,
        exposureLimitNotional: "0",
        capitalNotional: "0",
        lossLimitNotional: "0",
      }),
    ).toMatchObject({ ok: false, reason: "LIVE_CAPITAL_NOT_POSITIVE" });
    expect(
      liveCapitalOrderLimitV2({
        ...bound,
        exposureLimitNotional: "100",
        capitalNotional: "100",
        lossLimitNotional: "0",
      }),
    ).toMatchObject({ ok: false, reason: "LIVE_CAPITAL_NOT_POSITIVE" });
  });
});
