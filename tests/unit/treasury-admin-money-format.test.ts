import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  formatOptionalUsdFromMicros,
  formatUsdFromMicros,
  parseCanonicalIntegerString,
} from "@/lib/treasury-admin/money-format";

describe("treasury-admin exact money", () => {
  it("does not use Number or parseFloat in the formatter source", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/treasury-admin/money-format.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bNumber\(/);
    expect(source).not.toMatch(/\bparseFloat\(/);
  });

  it("formats USD from micros with BigInt only", () => {
    expect(formatUsdFromMicros("0")).toBe("$0.00");
    expect(formatUsdFromMicros("1000000")).toBe("$1.00");
    expect(formatUsdFromMicros("1234567")).toBe("$1.234567");
  });

  it("keeps signed remaining negative and visible", () => {
    expect(formatUsdFromMicros("-2500000")).toBe("-$2.50");
    expect(formatOptionalUsdFromMicros(null)).toBeNull();
    expect(parseCanonicalIntegerString("-1") < 0n).toBe(true);
  });

  it("rejects JSON-number-like floats", () => {
    expect(() => parseCanonicalIntegerString("1.5")).toThrow(/integer/);
    expect(() => parseCanonicalIntegerString("1e6")).toThrow(/integer/);
  });
});
