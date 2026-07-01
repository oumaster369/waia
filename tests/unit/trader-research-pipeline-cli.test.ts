import { describe, expect, it } from "vitest";

import { parseOosBarCount } from "../../scripts/trader/research-pipeline-cli";

describe("research-pipeline-cli (RI-P7)", () => {
  it("defaults oos-bar-count to 20", () => {
    expect(parseOosBarCount(new Map())).toBe(20);
  });

  it("parses explicit oos-bar-count", () => {
    const flags = new Map([["oos-bar-count", "30"]]);
    expect(parseOosBarCount(flags)).toBe(30);
  });
});
