import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const KERNEL_PATH = path.join(
  process.cwd(),
  "lib/trader/intelligence/reconstruction/reconstruction-kernel.ts",
);

const FORBIDDEN = [
  "bar-utils",
  "atr-estimator",
  "build-reconstruction-snapshot",
  "reconstruction-assembly",
  "incremental-reconstruction",
  "market-data/canvas",
];

describe("trader reconstruction kernel acyclic imports", () => {
  it("imports only numeric and intelligence types leaves", () => {
    const source = readFileSync(KERNEL_PATH, "utf8");
    const importLines = source
      .split("\n")
      .filter((line) => line.includes("from ") && line.trim().startsWith("import"));
    for (const line of importLines) {
      for (const forbidden of FORBIDDEN) {
        expect(line.includes(forbidden)).toBe(false);
      }
      expect(
        line.includes("@/lib/trader/risk/numeric") ||
          line.includes("@/lib/trader/intelligence/types"),
      ).toBe(true);
    }
  });
});
