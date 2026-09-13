import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as baselines from "@/lib/trader/research/benchmark/baseline-models-v1";
import { runResearchHarnessAdmissionAsyncV1, runResearchHarnessAdmissionV1,
  type ResearchHarnessAdmissionInputV1 } from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";
import { preflightValidationBootstrapV1 } from "@/lib/trader/research/benchmark/validation-bootstrap-v1";

function input(): ResearchHarnessAdmissionInputV1 {
  return {
    venue: "htx", market: "spot", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    challengerPackageContentDigestHex: "a".repeat(64), comparisonFamilyId: "preflight-regression",
    evaluationPartitionReceiptDigestHex: "b".repeat(64), purgeDurationMinutes: 30,
    embargoDurationMinutes: 30,
    developmentReturns: Array.from({ length: 400 }, (_, i) => (i - 200) / 10_000),
    historyReturns: Array(2000).fill(0),
    historyReturnMinuteOpenTimesMs: Array.from({ length: 2000 }, (_, i) => 1_700_000_000_000 + i * 60_000),
    anchors: [{ anchorId: "private-anchor\nnot-for-logs", observedReturn: 0.019,
      challengerProbabilities: Array(7).fill(1 / 7) }],
  };
}

describe("DEE-989 all-baseline input preflight", () => {
  afterEach(() => vi.restoreAllMocks());
  // Inject a genuinely invalid vector, not a legitimate zero-support forecast.
  function invalidBaseline(id: (typeof baselines.MANDATORY_BASELINE_IDS)[number]) {
    const original = baselines.evaluateMandatoryBaselineV1;
    vi.spyOn(baselines, "evaluateMandatoryBaselineV1").mockImplementation((baselineId, context) => {
      const result = original(baselineId, context);
      return baselineId === id && result.status === "AVAILABLE"
        ? { ...result, probabilities: [1.1, -0.1, 0, 0, 0, 0, 0] } : result;
    });
  }

  it("refuses invalid fourth baseline before any async resampling", async () => {
    invalidBaseline("rolling-w2000/v1");
    const progress: unknown[] = [];
    await expect(runResearchHarnessAdmissionAsyncV1(input(), {
      onProgress: event => progress.push(event),
    })).rejects.toThrow("TERMINAL_SCORE_INVALID_PROBABILITIES");
    expect(progress.length).toBe(0);
  }, 30_000);

  it("reports deterministic baseline and hashed anchor without raw caller text", () => {
    invalidBaseline("rolling-w2000/v1");
    const fixture = input();
    const digest = createHash("sha256").update(fixture.anchors[0]!.anchorId).digest("hex");
    let error: unknown;
    try { runResearchHarnessAdmissionV1(fixture); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("baseline=rolling-w2000/v1");
    expect((error as Error).message).toContain(`anchorDigest=${digest}`);
    expect((error as Error).message).not.toContain(fixture.anchors[0]!.anchorId);
  }, 30_000);

  it("also preflights the fifth baseline before spending resamples on the first four", async () => {
    invalidBaseline("ewma-lambda094/v3");
    const fixture = input();
    fixture.historyReturns = [...fixture.developmentReturns, ...Array(1600).fill(0.00001)];
    fixture.anchors[0]!.observedReturn = 0.01;
    let progress = 0;
    await expect(runResearchHarnessAdmissionAsyncV1(fixture, {
      onProgress: () => { progress++; },
    })).rejects.toThrow("baseline=ewma-lambda094/v3");
    expect(progress).toBe(0);
  });

  it("refuses invalid challenger mass without resampling or modifying probabilities", async () => {
    const fixture = input();
    fixture.anchors[0]!.challengerProbabilities = [0.9, 0, 0, 0, 0, 0, 0];
    const before = structuredClone(fixture);
    let progress = 0;
    await expect(runResearchHarnessAdmissionAsyncV1(fixture, {
      onProgress: () => { progress++; },
    })).rejects.toThrow("TERMINAL_SCORE_INVALID_PROBABILITIES");
    expect(progress).toBe(0);
    expect(fixture).toEqual(before);
  });

  it("rejects probability accessors before async cloning without invoking them", async () => {
    const fixture = input();
    const probabilities = [1, 0, 0, 0, 0, 0, 0];
    const getter = vi.fn(() => 1);
    Object.defineProperty(probabilities, "0", { enumerable: true, get: getter });
    fixture.anchors[0]!.challengerProbabilities = probabilities;
    const progress = vi.fn();
    expect(() => runResearchHarnessAdmissionV1(fixture)).toThrow("TERMINAL_SCORE_INVALID_PROBABILITIES");
    await expect(runResearchHarnessAdmissionAsyncV1(fixture, { onProgress: progress }))
      .rejects.toThrow("TERMINAL_SCORE_INVALID_PROBABILITIES");
    expect(getter).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it("keeps all anchors when both forecasts have zero observed support and records NaN only as diagnostic", () => {
    const fixture = input();
    fixture.anchors[0]!.challengerProbabilities = [1, 0, 0, 0, 0, 0, 0];
    const before = structuredClone(fixture);
    const result = runResearchHarnessAdmissionV1(fixture);
    expect(result.holmComparisons).toHaveLength(5);
    expect(result.holmComparisons.every(c => Number.isFinite(c.pValue))).toBe(true);
    expect(result.logScoreDiagnostics["rolling-w2000/v1"]).toEqual({
      challengerZeroCount: 1, baselineZeroCount: 1, nonFiniteDifferentialCount: 1,
      positiveInfinityCount: 0, negativeInfinityCount: 0, nanCount: 1,
    });
    expect(fixture).toEqual(before);
    expect(result.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
  });

  it.each([NaN, Infinity, -Infinity])("refuses non-finite kernel differential %s", value => {
    expect(() => preflightValidationBootstrapV1({ differentials: [value],
      trialIdentityDigest32: Buffer.alloc(32) })).toThrow("non-finite differential");
  });

  it("uses existing kernel checks for finite-input cumulative overflow", () => {
    expect(() => preflightValidationBootstrapV1({ differentials: [Number.MAX_VALUE, Number.MAX_VALUE],
      trialIdentityDigest32: Buffer.alloc(32) })).toThrow("non-finite differential sum");
  });

  it("keeps deterministic complete results, explicitly invalidating the old log-score bytes", async () => {
    const fixture = input();
    fixture.historyReturns = Array.from({ length: 2000 }, (_, i) => fixture.developmentReturns[i % 400]!);
    const before = structuredClone(fixture);
    const sync = runResearchHarnessAdmissionV1(fixture);
    const asyncResult = await runResearchHarnessAdmissionAsyncV1(fixture);
    expect(asyncResult).toEqual(sync);
    expect(createHash("sha256").update(JSON.stringify(sync)).digest("hex"))
      .not.toBe("78e503bf43cfcb12137c974f58304bd2cee8c232e5c498c0ef4c089454b29486");
    expect(sync.schemaVersion).toBe("research-harness-admission/v5");
    expect(sync.holmComparisons).toHaveLength(5);
    expect(fixture).toEqual(before);
  });

  it("keeps unavailable baselines unavailable and the empty-input outcome unchanged", async () => {
    const fixture = input();
    fixture.historyReturns = [];
    fixture.historyReturnMinuteOpenTimesMs = [];
    const result = await runResearchHarnessAdmissionAsyncV1(fixture);
    expect(result.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
    expect(result.baselineAvailability["rolling-w2000/v1"]).toBe("UNAVAILABLE");
    expect(result.baselineAvailability["ewma-lambda094/v3"]).toBe("UNAVAILABLE");
    fixture.anchors = [];
    expect(runResearchHarnessAdmissionV1(fixture).reasonCodes).toEqual(["COMMON_ANCHOR_SET_EMPTY"]);
  });
});
