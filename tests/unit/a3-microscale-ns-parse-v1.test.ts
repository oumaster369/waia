import { describe, expect, it } from "vitest";

import { parseA3MicroscaleNs } from "@/lib/trader/intelligence/forecast-v2/a3-microscale-ns-parse-v1";

describe("parseA3MicroscaleNs", () => {
  it("defaults to multi-N trend list", () => {
    expect(parseA3MicroscaleNs(undefined)).toEqual([1000, 5000, 10000, 25000, 50000]);
  });

  it("accepts a single explicit N", () => {
    expect(parseA3MicroscaleNs("50000")).toEqual([50000]);
  });

  it("accepts an explicit multi-N subset", () => {
    expect(parseA3MicroscaleNs("10000,25000,50000")).toEqual([10000, 25000, 50000]);
  });

  it("rejects duplicates", () => {
    expect(() => parseA3MicroscaleNs("10000,10000")).toThrow(/duplicates/);
  });

  it("rejects zero and negatives and malformed tokens", () => {
    expect(() => parseA3MicroscaleNs("0")).toThrow(/positive/);
    expect(() => parseA3MicroscaleNs("-1")).toThrow(/malformed/);
    expect(() => parseA3MicroscaleNs("10k")).toThrow(/malformed/);
    expect(() => parseA3MicroscaleNs("10000,")).toThrow(/empty token/);
  });

  it("rejects values above 50000", () => {
    expect(() => parseA3MicroscaleNs("50001")).toThrow(/50000/);
  });
});
