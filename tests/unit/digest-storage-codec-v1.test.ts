import { describe, expect, it } from "vitest";

import {
  digestByteaToHex,
  digestHexToBytea,
} from "@/lib/trader/intelligence/forecast-v2/digest-storage-codec-v1";

describe("digest storage codec (hex ↔ bytea)", () => {
  it("round-trips known hex through binary DB representation", () => {
    const hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const bytes = digestHexToBytea(hex);
    expect(bytes.length).toBe(32);
    expect(bytes[0]).toBe(0x01);
    expect(bytes[31]).toBe(0xef);
    expect(digestByteaToHex(bytes)).toBe(hex);
  });

  it("accepts postgres \\x hex literal form on read", () => {
    const hex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(digestByteaToHex(`\\x${hex}`)).toBe(hex);
  });

  it("rejects non-canonical / wrong-length digests", () => {
    expect(() => digestHexToBytea("AA".repeat(32))).toThrow();
    expect(() => digestHexToBytea("a".repeat(63))).toThrow();
    expect(() => digestByteaToHex(Buffer.alloc(31))).toThrow();
  });
});
