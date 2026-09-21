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
    closedTradeCount: 12,
    incumbentComparisonDigestHex: DIGEST,
    ...overrides,
  };
}

describe("partition qualification metrics", () => {
  it("matches one recorded window without reading closed-trade outcomes", () => {
    expect(
      deriveQualificationEvaluationFromPartitionWindowsV2([window({ windowId: "dev-1" })]),
    ).toEqual({
      netEconomicResult: "2.5",
      maxDrawdown: "-1",
      tailEventCount: 1,
      sampleSize: 12,
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
        closedTradeCount: 3,
      }),
      window({
        windowId: "wf-2",
        partition: "WALK_FORWARD",
        netEconomicResult: "0.25",
        maxDrawdown: "-1.5",
        tailEventCount: 1,
        closedTradeCount: 5,
      }),
    ]);
    expect(evaluation).toEqual({
      netEconomicResult: "1.25",
      maxDrawdown: "-1.5",
      tailEventCount: 2,
      sampleSize: 8,
      incumbentComparisonDigestHex: DIGEST,
    });
  });

  it("refuses a holdout partition, a zero sample, and a duplicate window", () => {
    expect(() =>
      deriveQualificationEvaluationFromPartitionWindowsV2([
        window({ windowId: "blind", partition: "BLIND_HOLDOUT" }),
      ]),
    ).toThrow(StrategyEvolutionResearchError);
    expect(() =>
      deriveQualificationEvaluationFromPartitionWindowsV2([
        window({
          windowId: "empty",
          closedTradeCount: 0,
          tailEventCount: 0,
          netEconomicResult: "0",
        }),
      ]),
    ).toThrow(/QUALIFICATION_PARTITION_WINDOWS_INVALID/);
    expect(() =>
      deriveQualificationEvaluationFromPartitionWindowsV2([
        window({ windowId: "same" }),
        window({ windowId: "same", netEconomicResult: "1" }),
      ]),
    ).toThrow(/QUALIFICATION_PARTITION_WINDOWS_INVALID/);
  });
});
