import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const INVENTORY = join(ROOT, "docs/ai-trader/reality-v2-source-consumer-inventory.json");
const VALIDATOR = join(ROOT, "scripts/trader/validate-reality-v2-consumer-graph.ts");

describe("Reality V2 whole-repository source/consumer closure (DEE-679)", () => {
  it("passes the pinned repository graph validator", () => {
    const output = execFileSync(process.execPath, ["--import", "tsx", VALIDATOR], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual(expect.objectContaining({
      status: "PASS",
      sources: 69,
      consumers: 109,
    }));
  });

  it("keeps DEE-620 and DEE-634 explicit and separate", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as {
      separateIssues: Record<string, string>;
      canonicalSourceKinds: string[];
    };
    expect(Object.keys(inventory.separateIssues).sort()).toEqual(["DEE-620", "DEE-634"]);
    expect(inventory.canonicalSourceKinds).toEqual([
      "EXECUTION_REPORT_V2",
      "HTX_SPOT_ORDER_REST",
      "HTX_SPOT_FILL_REST",
      "HTX_SPOT_BALANCE_REST",
      "HTX_SPOT_ACCOUNT_REST",
    ]);
  });
});
