import { describe, expect, it } from "vitest";

import {
  scale8Int8ToText,
  scale8TextToInt8,
} from "@/lib/trader/intelligence/forecast-v2/scale8-storage-codec-v1";

describe("scale8 storage codec", () => {
  it("round-trips positive, negative, and zero boundaries", () => {
    for (const text of ["0.00000000", "0.14285714", "-0.00160000", "1.00000000"]) {
      const scaled = scale8TextToInt8(text);
      expect(scale8Int8ToText(scaled)).toBe(text);
    }
    // int64 minimum scaled integer is exactly representable
    expect(scale8TextToInt8("-92233720368.54775808")).toBe(-9223372036854775808n);
    // one ulp beyond int64 minimum — fail closed
    expect(() => scale8TextToInt8("-92233720368.54775809")).toThrow(/outside int64/);
  });

  it("rejects non-canonical scale8 text", () => {
    expect(() => scale8TextToInt8("0.1")).toThrow();
    expect(() => scale8TextToInt8("0.142857140")).toThrow();
  });
});
