import { describe, expect, it } from "vitest";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import { findSelfServiceObservationTemplate } from "@/lib/trader/account-observation/self-service-template";
import type { ObservationConfig } from "@/lib/trader/account-observation/types";

function template(extra: Partial<Omit<ObservationConfig, "revision">> = {}) {
  return { config: createObservationConfiguration({
    symbols: ["BTCUSDT"], pollIntervalMs: 1000, maxBackoffMs: 8000,
    readTimeoutMs: 100, leaseTtlMs: 300000, ...extra,
  }) };
}

describe("self-service template selection", () => {
  it.each([
    { existingKeyReadConsentId: "00000000-0000-4000-8000-000000000008" },
    { htxDerivativesFamilies: ["usdt_cross_shared"] },
    { htxV5: { enabled: true, expectedHtxUid: "456" } },
    { htxV5: { enabled: true, expectedHtxUid: "456", financialHistory: {
      enabled: true, scopeId: "00000000-0000-4000-8000-000000000009",
      windowStartMs: 1, windowEndMs: 2, validFromMs: 2, validUntilMs: 3,
    } } },
  ] satisfies Partial<Omit<ObservationConfig, "revision">>[])(
    "keeps fixed authority out of dynamic inheritance: %j", (extra) => {
      const fixed = template(extra);
      const spot = template();
      expect(findSelfServiceObservationTemplate([fixed])).toBeUndefined();
      expect(findSelfServiceObservationTemplate([fixed, spot])).toBe(spot);
      expect(findSelfServiceObservationTemplate([spot, fixed])).toBe(spot);
      expect(findSelfServiceObservationTemplate([fixed, spot], fixed.config.revision)).toBeUndefined();
    },
  );

  it("selects the exact enrolled revision rather than the first eligible configuration", () => {
    const first = template();
    const enrolled = template({ pollIntervalMs: 2000 });
    expect(findSelfServiceObservationTemplate([first, enrolled], enrolled.config.revision)).toBe(enrolled);
    expect(findSelfServiceObservationTemplate([enrolled, first], first.config.revision)).toBe(first);
    expect(findSelfServiceObservationTemplate([first, enrolled], "sha256:" + "f".repeat(64))).toBeUndefined();
  });
});
