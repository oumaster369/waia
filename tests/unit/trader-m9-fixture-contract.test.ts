import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FIXTURE_PATH = join(
  process.cwd(),
  "tests/fixtures/trader/m9-v0.1.6-partial-inventory-mismatch.json",
);

type M9DualPurposeFixture = {
  fixtureId: string;
  symbol: string;
  canonicalOpenQty: string;
  lots: { id: string; remainingQty: string; openedAt: string }[];
  expectedTotalExitQty: string;
  expectedPartialLotId: string;
  expectedPartialQty: string;
  partialLotQty: string;
  expectedReconciliation: string;
};

function loadFixture(): M9DualPurposeFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as M9DualPurposeFixture;
}

describe("m9-v0.1.6 dual-purpose fixture contract", () => {
  it("retains lifecycle open-quantity parity fields", () => {
    const fixture = loadFixture();
    expect(fixture.lots).toHaveLength(2);
    expect(fixture.expectedPartialQty).toBe("0.00231991");
    expect(fixture.expectedTotalExitQty).toBe("0.00731991");
    expect(fixture.expectedPartialLotId).toBe("lot-2");
    expect(fixture.canonicalOpenQty).toBe("0.00731991");
  });

  it("retains WP19 accounting reconciliation fields", () => {
    const fixture = loadFixture();
    expect(fixture.fixtureId).toBe("m9-v0.1.6-partial-inventory-mismatch");
    expect(fixture.symbol).toBe("BTCUSDT");
    expect(fixture.partialLotQty).toBe("0.00231991");
    expect(fixture.expectedReconciliation).toBe("PASS_AFTER_WP18_ENGINE");
    expect(fixture.partialLotQty).toBe(fixture.expectedPartialQty);
  });

  it("is consumed by lifecycle and WP19 regression tests from one path", () => {
    const lifecycleSource = readFileSync(
      join(process.cwd(), "tests/unit/trader-lifecycle-open-qty-parity.test.ts"),
      "utf8",
    );
    const wp19Source = readFileSync(
      join(process.cwd(), "tests/unit/trader-htr-m9-partial-inventory-regression.test.ts"),
      "utf8",
    );
    expect(lifecycleSource).toContain("m9-v0.1.6-partial-inventory-mismatch.json");
    expect(wp19Source).toContain("m9-v0.1.6-partial-inventory-mismatch.json");
    expect(lifecycleSource).toContain("fixture.lots");
    expect(lifecycleSource).toContain("expectedPartialQty");
    expect(wp19Source).toContain("partialLotQty");
    expect(wp19Source).toContain("canonicalOpenQty");
  });
});
