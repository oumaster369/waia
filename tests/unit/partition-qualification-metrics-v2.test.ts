import { describe, expect, it } from "vitest";

import {
  deriveQualificationEvaluationFromPartitionWindowsV2,
  type PartitionWindowMetricV2,
} from "@/lib/trader/research-v2/partition-qualification-metrics-v2";
import { StrategyEvolutionResearchError } from "@/lib/trader/research-v2/research-v2-guards";

const DIGEST = "ab".repeat(32);

function window(
  overrides: Partial<PartitionWindowMetricV2> & Pick<PartitionWindowMetricV2, "windowId">,
): PartitionWindowMetricV2 {
  return {
    partition: "DEVELOPMENT",
    netEconomicResult: "2.5",
    maxDrawdown: "-1",
    tailEventCount: 1,
    closedTradeCount: 30,
    distinctDayCount: 10,
    positiveTradeCount: 26,
    nonZeroTradeCount: 30,
    incumbentComparisonDigestHex: DIGEST,
    ...overrides,
  };
}

describe("partition qualification metrics", () => {
  it("copies one recorded window", () => {
    expect(
      deriveQualificationEvaluationFromPartitionWindowsV2([window({ windowId: "dev-1" })]),
    ).toEqual({
      netEconomicResult: "2.5",
      maxDrawdown: "-1",
      tailEventCount: 1,
      sampleSize: 30,
      distinctDayCount: 10,
      positiveTradeCount: 26,
      nonZeroTradeCount: 30,
      incumbentComparisonDigestHex: DIGEST,
    });
  });

  it("sums two windows and keeps the worst drawdown", () => {
    const evaluation = deriveQualificationEvaluationFromPartitionWindowsV2([
      window({
        windowId: "wf-1",
        partition: "WALK_FORWARD",
        netEconomicResult: "1",
        maxDrawdown: "-0.5",
        tailEventCount: 1,
        closedTradeCount: 16,
        distinctDayCount: 5,
        positiveTradeCount: 14,
        nonZeroTradeCount: 16,
      }),
      window({
        windowId: "wf-2",
        partition: "WALK_FORWARD",
        netEconomicResult: "0.25",
        maxDrawdown: "-1.5",
        tailEventCount: 1,
        closedTradeCount: 16,
        distinctDayCount: 5,
        positiveTradeCount: 12,
        nonZeroTradeCount: 16,
      }),
    ]);
    expect(evaluation).toEqual({
      netEconomicResult: "1.25",
      maxDrawdown: "-1.5",
      tailEventCount: 2,
      sampleSize: 32,
      distinctDayCount: 10,
      positiveTradeCount: 26,
      nonZeroTradeCount: 32,
      incumbentComparisonDigestHex: DIGEST,
    });
  });

  it("returns a below-floor aggregate for admission to mark insufficient_data", () => {
    expect(
      deriveQualificationEvaluationFromPartitionWindowsV2([
        window({
          windowId: "small",
          closedTradeCount: 12,
          distinctDayCount: 4,
          positiveTradeCount: 8,
          nonZeroTradeCount: 12,
        }),
      ]).sampleSize,
    ).toBe(12);
  });

  it("refuses a holdout partition, a zero sample, and a duplicate window", () => {
    expect(() =>
      deriveQualificationEvaluationFromPartitionWindowsV2([
        window({ windowId: "blind", partition: "BLIND_HOLDOUT" }),
      ]),
    ).toThrow(StrategyEvolutionResearchError);
    expect(
      deriveQualificationEvaluationFromPartitionWindowsV2([
        window({
          windowId: "empty",
          closedTradeCount: 0,
          distinctDayCount: 0,
          positiveTradeCount: 0,
          nonZeroTradeCount: 0,
          tailEventCount: 0,
          netEconomicResult: "0",
        }),
      ]),
    ).toMatchObject({ sampleSize: 0, distinctDayCount: 0 });
    expect(() =>
      deriveQualificationEvaluationFromPartitionWindowsV2([
        window({ windowId: "same" }),
        window({ windowId: "same", netEconomicResult: "1" }),
      ]),
    ).toThrow(/QUALIFICATION_PARTITION_WINDOWS_INVALID/);
  });
});
