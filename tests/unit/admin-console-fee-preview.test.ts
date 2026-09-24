import { describe, expect, it } from "vitest";

import { previewClosedPeriodFee } from "@/lib/trader/admin-console/billing/fee-preview";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const base = {
  periodId: "period-1",
  organizationId: "org-1",
  exchangeAccountId: "acc-1",
  periodRealizedStrategyProfit: "100",
};

describe("admin console fee preview", () => {
  it("prices profit from 1000 to 1100 at the 30 percent rate and does not call it an invoice", () => {
    const preview = previewClosedPeriodFee({
      ...base,
      cumulativeRealizedStrategyProfit: "1100",
      previousHighWaterMark: "1000",
    });
    expect(compareDecimal(preview.artifact.performanceFee, "30")).toBe(0);
    expect(preview.artifact.billable).toBe(true);
    expect(preview.label).toContain("предварительный расчёт, не счёт");
  });

  it("says the invoice was not created when the fee is under the threshold", () => {
    const preview = previewClosedPeriodFee({
      ...base,
      periodRealizedStrategyProfit: "5",
      cumulativeRealizedStrategyProfit: "1005",
      previousHighWaterMark: "1000",
    });
    expect(preview.artifact.billable).toBe(false);
    expect(preview.label).toContain("ниже порога");
  });
});
