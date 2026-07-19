import { describe, expect, it } from "vitest";

import { runGuardianCostCausalScenarioComparison } from "@/lib/trader/research/wp21-g2-guardian-cost-causal-harness";
import {
  assertExpectedParentSealDigests,
  generateWp21G2ParentSeal,
} from "@/lib/trader/research/wp21-g2-parent-seal-orchestrator";
import { runWp21G2CostVectorComparison } from "@/lib/trader/research/wp21-g2-cost-vector-comparison";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("trader g2 wp21 integrated qualification", () => {
  it("integrated qualification binds guardian causal scenarios", () => {
    const result = runGuardianCostCausalScenarioComparison("B5-GU-04");
    expect(result.expectedCausalOutcome).toBe("CAUSAL_CROSSING");
    expect(result.observedCausalOutcome).toBe("CAUSAL_CROSSING");
  });

  it("integrated qualification binds dual cost sequences only difference", () => {
    const seal = generateWp21G2ParentSeal();
    assertExpectedParentSealDigests(seal);
    const fixture = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "tests/fixtures/trader/wp21-g2-cost-vectors-v1.json"),
        "utf8",
      ),
    ) as {
      vectors: Array<{
        vectorId: string;
        side: "buy" | "sell";
        grossFillPrice: string;
        quantity: string;
      }>;
    };
    const comparison = runWp21G2CostVectorComparison({ vectors: fixture.vectors });
    expect(comparison.doubleCostApplication).toBe(0);
    expect(comparison.missingCostApplication).toBe(0);
  }, 240_000);
});
