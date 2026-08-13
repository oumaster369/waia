import { describe, expect, it } from "vitest";

import {
  schemaVersionInt2ToText,
  schemaVersionTextToInt2,
} from "@/lib/trader/intelligence/forecast-v2/schema-version-storage-v1";

describe("schema_version storage map", () => {
  it("round-trips the closed Forecast V2 set", () => {
    for (const text of [
      "forecast-bundle/v2",
      "forecast/v2",
      "forecast-scenario/v2",
      "forecast-outcome/v2",
      "forecast-calibration/v2",
    ] as const) {
      expect(schemaVersionInt2ToText(schemaVersionTextToInt2(text))).toBe(text);
    }
  });

  it("fails closed on unknown values", () => {
    expect(() => schemaVersionTextToInt2("forecast/v3")).toThrow(/unknown/);
    expect(() => schemaVersionInt2ToText(99)).toThrow(/unknown/);
  });
});
