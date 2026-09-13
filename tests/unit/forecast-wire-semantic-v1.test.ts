import { describe, expect, it } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeForecastWireSemanticDigestV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-wire-semantic-v1";

describe("DEE-946 streaming forecast wire semantic digest", () => {
  it.each([
    null,
    true,
    "русский\n\u0000\ud800",
    -0,
    1.0000000000000002,
    { z: [1, -0, null], a: { "💡": 1, ä: 2, Z: 3 } },
    { "4294967295": 1, "11": 2, "2": 3, "01": 4, a: 5 },
    Buffer.from([0, 127, 255]),
    { type: "Buffer", data: [0, 127, 255] },
    new Date("2026-01-01T00:00:00Z"),
    Array(3),
    Object.assign(Array(3), { 1: 7 }),
  ])("preserves canonical bytes for %j", (value) => {
    expect(computeForecastWireSemanticDigestV1(value)).toBe(computeSemanticSha256Hex(value));
  });
  it("allows repeated references without treating them as cycles", () => {
    const x = { n: 1 };
    expect(computeForecastWireSemanticDigestV1([x, x])).toBe(computeSemanticSha256Hex([x, x]));
  });
  it.each([NaN, Infinity, -Infinity, undefined, 1n, () => 1, { a: undefined }])(
    "refuses unsupported values",
    (value) => {
      expect(() => computeSemanticSha256Hex(value)).toThrow();
      expect(() => computeForecastWireSemanticDigestV1(value)).toThrow();
    },
  );
  it("refuses cycles before recursion exhaustion", () => {
    const x: unknown[] = [];
    x.push(x);
    expect(() => computeForecastWireSemanticDigestV1(x)).toThrow("CYCLE");
  });
  it("rejects prototype-mutating keys instead of interpreting legacy setter behavior", () => {
    expect(() => computeForecastWireSemanticDigestV1(JSON.parse('{"__proto__":{"x":1}}'))).toThrow(
      "PROTOTYPE_KEY",
    );
  });
});
