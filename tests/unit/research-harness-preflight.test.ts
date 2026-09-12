import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
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
  it("refuses invalid fourth baseline before any async resampling", async () => {
    const progress: unknown[] = [];
    await expect(runResearchHarnessAdmissionAsyncV1(input(), {
      onProgress: event => progress.push(event),
    })).rejects.toThrow("non-finite differential");
    expect(progress.length).toBe(0);
  }, 30_000);

  it("reports deterministic baseline and hashed anchor without raw caller text", () => {
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
    const fixture = input();
    fixture.historyReturns = [...fixture.developmentReturns, ...Array(1600).fill(0.00001)];
    fixture.anchors[0]!.observedReturn = 0.01;
    let progress = 0;
    await expect(runResearchHarnessAdmissionAsyncV1(fixture, {
      onProgress: () => { progress++; },
    })).rejects.toThrow("baseline=ewma-lambda094/v2");
    expect(progress).toBe(0);
  });

  it("refuses zero challenger support without resampling or modifying probabilities", async () => {
    const fixture = input();
    fixture.anchors[0]!.challengerProbabilities = [1, 0, 0, 0, 0, 0, 0];
    const before = structuredClone(fixture);
    let progress = 0;
    await expect(runResearchHarnessAdmissionAsyncV1(fixture, {
      onProgress: () => { progress++; },
    })).rejects.toThrow("baseline=climatology/v1");
    expect(progress).toBe(0);
    expect(fixture).toEqual(before);
  });

  it.each([NaN, Infinity, -Infinity])("refuses non-finite kernel differential %s", value => {
    expect(() => preflightValidationBootstrapV1({ differentials: [value],
      trialIdentityDigest32: Buffer.alloc(32) })).toThrow("non-finite differential");
  });

  it("uses existing kernel checks for finite-input cumulative overflow", () => {
    expect(() => preflightValidationBootstrapV1({ differentials: [Number.MAX_VALUE, Number.MAX_VALUE],
      trialIdentityDigest32: Buffer.alloc(32) })).toThrow("non-finite differential sum");
  });

  it("preserves complete finite-result bytes captured at unmodified main6ab1b156", async () => {
    const fixture = input();
    fixture.historyReturns = Array.from({ length: 2000 }, (_, i) => fixture.developmentReturns[i % 400]!);
    const before = structuredClone(fixture);
    const sync = runResearchHarnessAdmissionV1(fixture);
    const asyncResult = await runResearchHarnessAdmissionAsyncV1(fixture);
    expect(asyncResult).toEqual(sync);
    expect(createHash("sha256").update(JSON.stringify(sync)).digest("hex"))
      .toBe("78e503bf43cfcb12137c974f58304bd2cee8c232e5c498c0ef4c089454b29486");
    expect(fixture).toEqual(before);
  });

  it("keeps unavailable baselines unavailable and the empty-input outcome unchanged", async () => {
    const fixture = input();
    fixture.historyReturns = [];
    fixture.historyReturnMinuteOpenTimesMs = [];
    const result = await runResearchHarnessAdmissionAsyncV1(fixture);
    expect(result.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
    expect(result.baselineAvailability["rolling-w2000/v1"]).toBe("UNAVAILABLE");
    expect(result.baselineAvailability["ewma-lambda094/v2"]).toBe("UNAVAILABLE");
    fixture.anchors = [];
    expect(runResearchHarnessAdmissionV1(fixture).reasonCodes).toEqual(["COMMON_ANCHOR_SET_EMPTY"]);
  });
});
