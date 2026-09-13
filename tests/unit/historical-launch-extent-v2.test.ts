import { describe, expect, it } from "vitest";
import { assertLaunchPlanWithinQualifiedEconomicPartition,
  type HistoricalTechnicalLaunchPlanV2 } from
  "@/lib/trader/historical-simulation-v2/ratification-split-v2";
import type { HistoricalFourSurfaceTechnicalCandidateV2 } from
  "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";

const candidate = { firstEconomicRecordIndex: 525600, economicRecordCount: 1000 } as
  HistoricalFourSurfaceTechnicalCandidateV2;
const plan: HistoricalTechnicalLaunchPlanV2 = {
  accountId: "account-a", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
  startingCashUsdt: "1000", defaultQuantity: "0.001",
  initialRecordIndex: 525600, cycleCount: 35,
};

describe("Historical proposal extent agrees with the first-cycle bootstrap", () => {
  it("accepts only the receipt-derived first economic boundary", () => {
    expect(() => assertLaunchPlanWithinQualifiedEconomicPartition(plan, candidate))
      .not.toThrow();
    // The boundary is receipt-derived, not a hardcoded production index.
    expect(() => assertLaunchPlanWithinQualifiedEconomicPartition(
      { ...plan, initialRecordIndex: 1000 },
      { ...candidate, firstEconomicRecordIndex: 1000 },
    )).not.toThrow();
  });

  it.each([525599, 525601, 526599, 526600])(
    "rejects unsupported initial offset %s before proposal persistence", (initialRecordIndex) => {
      expect(() => assertLaunchPlanWithinQualifiedEconomicPartition(
        { ...plan, initialRecordIndex }, candidate,
      )).toThrow("LAUNCH_PLAN_OUTSIDE_QUALIFIED_ECONOMIC_PARTITION");
    },
  );

  it("rejects non-integer extent fields", () => {
    expect(() => assertLaunchPlanWithinQualifiedEconomicPartition(
      { ...plan, initialRecordIndex: NaN }, candidate,
    )).toThrow("LAUNCH_PLAN");
  });

  it("keeps the full requested extent within the qualified partition", () => {
    expect(() => assertLaunchPlanWithinQualifiedEconomicPartition(
      { ...plan, cycleCount: 1000 }, candidate,
    )).not.toThrow();
    expect(() => assertLaunchPlanWithinQualifiedEconomicPartition(
      { ...plan, cycleCount: 1001 }, candidate,
    )).toThrow("LAUNCH_PLAN_OUTSIDE_QUALIFIED_ECONOMIC_PARTITION");
  });
});
