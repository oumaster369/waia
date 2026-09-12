import { describe, expect, it } from "vitest";
import { inspectBrierRecoveryCostPreflightV1 } from "../../scripts/trader/brier-recovery-cost-preflight-v1";
import type { ResearchHarnessAdmissionInputV1 } from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";
import { runResearchHarnessAdmissionV1, runResearchHarnessAdmissionAsyncV1 } from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";

function fixture(): ResearchHarnessAdmissionInputV1 {
  return {
    venue: "htx", market: "spot", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    challengerPackageContentDigestHex: "a".repeat(64), comparisonFamilyId: "synthetic-cost-only",
    evaluationPartitionReceiptDigestHex: "b".repeat(64), purgeDurationMinutes: 30, embargoDurationMinutes: 30,
    developmentReturns: Array.from({length: 400}, (_, i) => (i - 200) / 10000),
    historyReturns: Array(2000).fill(0),
    historyReturnMinuteOpenTimesMs: Array.from({length: 2000}, (_, i) => 1700000000000 + i * 60000),
    anchors: [{anchorId: "synthetic-a", observedReturn: 1, challengerProbabilities: [0,0,0,0,0,0,1]}],
  };
}
describe("DEE-991 bounded recovery cost preflight, synthetic data only", () => {
  it.each(["sparse", "getter", "nonfinite", "empty"])("rejects malformed DEVELOPMENT %s in diagnostic and both full harness paths", async kind => {
    const input = fixture(); let calls = 0;
    const values = [...input.developmentReturns];
    if (kind === "sparse") delete values[0];
    if (kind === "getter") Object.defineProperty(values,"0",{get:()=>{calls++;return 0;},enumerable:true});
    if (kind === "nonfinite") values[0] = NaN;
    input.developmentReturns = kind === "empty" ? [] : values;
    expect(() => inspectBrierRecoveryCostPreflightV1(input)).toThrow("TERMINAL_SCORE_INVALID_DEVELOPMENT");
    expect(() => runResearchHarnessAdmissionV1(input)).toThrow("TERMINAL_SCORE_INVALID_DEVELOPMENT");
    await expect(runResearchHarnessAdmissionAsyncV1(input)).rejects.toThrow("TERMINAL_SCORE_INVALID_DEVELOPMENT");
    expect(calls).toBe(0);
  });
  it("reports a necessary condition, never statistical admission or an ETA", () => {
    const input = fixture(), before = structuredClone(input);
    const result = inspectBrierRecoveryCostPreflightV1(input);
    expect(result.necessaryCondition).toBe("SATISFIED_NOT_QUALIFIED");
    expect(result.comparisons).toHaveLength(5);
    expect(result.fullFiveBaselineBootstrapVisits).toBe("50000");
    expect(result.qualification).toBe("NOT_RUN");
    expect(result.bootstrap).toBe("NOT_RUN");
    expect(result.authorityGranted).toBe(false);
    expect(result.executionPermitted).toBe(false);
    expect(result.estimatedCompletionTime).toBeNull();
    expect(input).toEqual(before);
  });
  it("identifies a losing candidate before any resampling", () => {
    const input = fixture(); input.anchors[0]!.challengerProbabilities = [1,0,0,0,0,0,0];
    const result = inspectBrierRecoveryCostPreflightV1(input);
    expect(result.necessaryCondition).toBe("UNSATISFIED_NO_ADMISSION");
    expect(result.comparisons.some(c => c.status === "NON_POSITIVE_MEAN")).toBe(true);
  });
  it("does not drop unavailable baselines", () => {
    const input = fixture(); input.historyReturns = []; input.historyReturnMinuteOpenTimesMs = [];
    const result = inspectBrierRecoveryCostPreflightV1(input);
    expect(result.comparisons).toHaveLength(5);
    expect(result.comparisons.filter(c => c.status === "UNAVAILABLE")).toHaveLength(2);
    expect(result.necessaryCondition).toBe("UNSATISFIED_NO_ADMISSION");
  });
  it("refuses empty/duplicate anchors", () => {
    const input = fixture(); input.anchors = [...input.anchors, ...input.anchors];
    expect(() => inspectBrierRecoveryCostPreflightV1(input)).toThrow("DUPLICATE_ANCHORS");
    input.anchors = []; expect(() => inspectBrierRecoveryCostPreflightV1(input)).toThrow("EMPTY_ANCHORS");
  });
  it("refuses malformed probabilities rather than renormalizing", () => {
    const input = fixture(); input.anchors[0]!.challengerProbabilities = [0.9,0,0,0,0,0,0];
    expect(() => inspectBrierRecoveryCostPreflightV1(input)).toThrow("TERMINAL_SCORE_INVALID_PROBABILITIES");
  });
  it.each([true, false])("matches full harness mean arithmetic on tiny synthetic fixture, winning=%s", winning => {
    const input = fixture();
    input.anchors = [
      {...input.anchors[0]!, anchorId: "z", challengerProbabilities: winning ? [0,0,0,0,0,0,1] : [1,0,0,0,0,0,0]},
      {...input.anchors[0]!, anchorId: "a", challengerProbabilities: [0,0,0,0,0,0.25,0.75]},
    ];
    const preview = inspectBrierRecoveryCostPreflightV1(input);
    const full = runResearchHarnessAdmissionV1(input);
    for (const c of preview.comparisons)
      expect(c.meanImprovement).toBe(full.meanImprovementByBaseline[c.baselineId]);
  });
});
