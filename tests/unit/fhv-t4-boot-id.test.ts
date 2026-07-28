import { describe, expect, it } from "vitest";

import {
  assertFhvT4BootIdEqual,
  FhvT4BootIdError,
  normalizeFhvT4BootId,
} from "@/lib/trader/observability/fhv-t4-boot-id";

const CANONICAL = "f4707dfd-dea7-421f-a27f-a5e1c54015c5";
const HEX32 = "f4707dfddea7421fa27fa5e1c54015c5";

describe("fhv-t4 boot id canonical utility (DEE-436)", () => {
  it("normalizes hyphenated lowercase Linux UUID", () => {
    expect(normalizeFhvT4BootId(CANONICAL)).toBe(CANONICAL);
  });

  it("normalizes 32-char lowercase hex to canonical hyphenated UUID", () => {
    expect(normalizeFhvT4BootId(HEX32)).toBe(CANONICAL);
  });

  it("normalizes uppercase UUID to lowercase canonical form", () => {
    expect(normalizeFhvT4BootId(CANONICAL.toUpperCase())).toBe(CANONICAL);
  });

  it("trims surrounding whitespace before normalization", () => {
    expect(normalizeFhvT4BootId(`  ${CANONICAL}  `)).toBe(CANONICAL);
  });

  it("rejects malformed boot IDs", () => {
    expect(() => normalizeFhvT4BootId("not-a-boot-id")).toThrow(FhvT4BootIdError);
    expect(() => normalizeFhvT4BootId("")).toThrow(FhvT4BootIdError);
    expect(() => normalizeFhvT4BootId("   ")).toThrow(FhvT4BootIdError);
  });

  it("assertFhvT4BootIdEqual treats mixed representations as equal", () => {
    expect(() => assertFhvT4BootIdEqual(HEX32, CANONICAL)).not.toThrow();
  });

  it("assertFhvT4BootIdEqual rejects genuinely different boot IDs", () => {
    try {
      assertFhvT4BootIdEqual(CANONICAL, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      expect.unreachable("different boot IDs should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4BootIdError);
      expect((error as FhvT4BootIdError).code).toBe("FHV_T4_BOOT_ID_MISMATCH");
    }
  });
});
