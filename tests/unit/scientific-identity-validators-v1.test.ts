import { describe, expect, it } from "vitest";

import {
  assertAsciiLine,
  assertCanonicalIntegerLine,
  assertCodeReleaseSha,
  assertDigestHex64,
  assertScale8Canonical,
  assertUuidRfc4122,
  ScientificIdentityValidationError,
} from "@/lib/trader/intelligence/forecast-v2/scientific-identity-validators-v1";

describe("scientific identity validators E1", () => {
  it("accepts canonical digest/uuid/git sha", () => {
    expect(() => assertDigestHex64("a".repeat(64), "d")).not.toThrow();
    expect(() => assertUuidRfc4122("00000000-0000-4000-8000-000000000001", "u")).not.toThrow();
    expect(() => assertCodeReleaseSha("a".repeat(40), "s")).not.toThrow();
    expect(() => assertScale8Canonical("0.10000000", "q")).not.toThrow();
    expect(assertCanonicalIntegerLine(30, "h")).toBe("30");
  });

  it("rejects uppercase digest and bad uuid", () => {
    expect(() => assertDigestHex64("A".repeat(64), "d")).toThrow(ScientificIdentityValidationError);
    expect(() => assertUuidRfc4122("not-a-uuid", "u")).toThrow(ScientificIdentityValidationError);
  });

  it("rejects newline injection and noncanonical integer", () => {
    expect(() => assertAsciiLine("bad\nline", "s")).toThrow(ScientificIdentityValidationError);
    expect(assertCanonicalIntegerLine(12, "n", { allowZero: false })).toBe("12");
    expect(() => assertCanonicalIntegerLine(0, "z", { allowZero: false })).toThrow(
      ScientificIdentityValidationError,
    );
  });
});
