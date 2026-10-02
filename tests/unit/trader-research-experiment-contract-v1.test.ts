import { describe, expect, it } from "vitest";

import { createHtrHistoricalCostModelAuthorityV1 } from "@/lib/trader/execution/cost-model";
import {
  parseResearchExperimentSpecV1,
  researchExperimentIdentityV1,
  RESEARCH_EXECUTABLE_ID_V1,
  RESEARCH_EXPERIMENT_SCHEMA_V1,
} from "@/lib/trader/research/research-experiment-contract-v1";

const digest = (character: string) => character.repeat(64);
const partition = (contentSha256: string, firstOpenMs: number, lastCloseMs: number) => ({
  contentSha256,
  firstOpenMs,
  lastCloseMs,
  barCount: 10,
});

function validProposal() {
  const authority = createHtrHistoricalCostModelAuthorityV1();
  return {
    schemaVersion: RESEARCH_EXPERIMENT_SCHEMA_V1,
    organizationId: "f6305dfb-0fec-43cb-ac8a-d6086e17a11f",
    hypothesis: {
      observationEvidenceSha256: [digest("a"), digest("b")],
      observationCutoffMs: 99,
      mechanism: "A falsifiable mechanism statement.",
      falsificationRule: "Reject if the preregistered condition is absent.",
    },
    executable: {
      id: RESEARCH_EXECUTABLE_ID_V1,
      sourceSha256: digest("c"),
      featureSemantics: "closed-prefix-sma-population-zscore/v1",
      replaySemantics: "htr-next-eligible-closed-bar-close-with-retained-evaluation-prefix/v1",
    },
    orderedTrials: [
      { lookbackBars: 8, buyZscore: "-1.5", sellZscore: "0" },
      { lookbackBars: 16, buyZscore: "-1.5", sellZscore: "0" },
      { lookbackBars: 32, buyZscore: "-1.5", sellZscore: "0" },
    ],
    universe: {
      venue: "HTX",
      market: "SPOT",
      symbol: "BTCUSDT",
      interval: "1m",
      pointInTimeEvidenceSha256: digest("d"),
      knownAtMs: 100,
      datasetSourceSha256: digest("e"),
      sidecarContentSha256: null,
    },
    partitions: {
      train: partition(digest("1"), 100, 200),
      validation: partition(digest("2"), 200, 300),
      blind: partition(digest("3"), 300, 400),
      walkForward: [partition(digest("4"), 210, 240), partition(digest("5"), 250, 280)],
    },
    costs: {
      modelId: authority.modelId,
      schemaVersion: authority.schemaVersion,
      feeBps: authority.feeBps,
      halfSpreadBps: authority.halfSpreadBps,
      marketImpactBps: authority.marketImpactBps,
      slippageModel: authority.slippageModel,
      takerFeeBps: authority.takerFeeBps,
      makerFeeBps: authority.makerFeeBps,
      submitLatencyMs: authority.submitLatencyMs,
      cancelLatencyMs: authority.cancelLatencyMs,
      partialFillModel: authority.partialFillModel,
      costModelDigest: authority.costModelDigest,
    },
    replay: {
      executionMode: "mock",
      submitResearchMockOrders: true,
      enableReplayFusedContext: false,
      retentionMode: "FULL",
      partialRunEvidence: "ineligible",
      metricsSchemaVersion: "2.0.0",
      defaultQuantity: "0.01",
      accountKey: "proposal-only-account",
      portfolio: {
        startingBalanceUsdt: "10000",
        maxRiskPerTradePct: "1",
        maxPortfolioRiskPct: "3",
        maxConcurrentPositions: 1,
        maxNotional: "10000",
        defaultStopDistancePct: null,
      },
      guardian: {
        enabled: false,
        maxHoldBars: 0,
        barIntervalMs: 60_000,
        enableExitEngine: false,
        htrAuthoritative: true,
        resolvedPolicySha256: digest("8"),
      },
      historicalExecutionModelSha256: digest("6"),
      intelligenceProfileSha256: null,
      volumeQualificationSha256: digest("7"),
    },
    selection: {
      objective: "train-after-cost-realized-pnl",
      tieBreak: "first-in-declared-family",
      validationSelection: "forbidden",
      blindSelection: "forbidden",
    },
  };
}

const clone = <T>(value: T): T => structuredClone(value);

function rejects(proposal: unknown, message: RegExp) {
  expect(() => parseResearchExperimentSpecV1(proposal)).toThrow(message);
}

describe("research experiment proposal contract v1", () => {
  it("refuses next-open attribution for the existing closed-bar-price historical simulator", () => {
    const proposal = validProposal();
    proposal.executable.replaySemantics = "htr-next-open-with-retained-evaluation-prefix/v1";
    rejects(proposal, /replaySemantics/);
  });

  it("refuses an unsupported instrument or non-1m replay in this closed research version", () => {
    const instrument = validProposal();
    instrument.universe.symbol = "SOLUSDT";
    rejects(instrument, /symbol/);
    const interval = validProposal();
    interval.universe.interval = "1h";
    rejects(interval, /interval/);
  });

  it("requires a requested resolved Guardian policy identity without granting its authenticity", () => {
    const missing = validProposal();
    delete (missing.replay.guardian as Record<string, unknown>).resolvedPolicySha256;
    rejects(missing, /resolvedPolicySha256/);
    const malformed = validProposal();
    malformed.replay.guardian.resolvedPolicySha256 = "unverified";
    rejects(malformed, /resolvedPolicySha256/);
  });

  it("refuses quantities the shared eight-decimal execution arithmetic cannot represent", () => {
    const input = validProposal();
    input.replay.defaultQuantity = "0.000000001";
    rejects(input, /defaultQuantity/);
  });

  it("retains the full ordered trial family, exact partitions and canonical cost authority", () => {
    const input = validProposal();
    const parsed = parseResearchExperimentSpecV1(input);
    expect(parsed.orderedTrials.map(trial => trial.lookbackBars)).toEqual([8, 16, 32]);
    expect(parsed.universe).toEqual(input.universe);
    expect(parsed.partitions).toEqual(input.partitions);
    expect(parsed.costs).toEqual(input.costs);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.orderedTrials)).toBe(true);
    expect(Object.isFrozen(parsed.orderedTrials[0])).toBe(true);
    expect(Object.isFrozen(parsed.partitions.walkForward[0])).toBe(true);
  });

  it("changes proposal identity when a declared parameter changes", () => {
    const original = validProposal();
    const changed = clone(original);
    changed.orderedTrials[1]!.lookbackBars = 24;
    expect(researchExperimentIdentityV1(original).specSha256)
      .not.toBe(researchExperimentIdentityV1(changed).specSha256);
  });

  it("normalizes organization UUID casing before deriving the proposal identity", () => {
    const lower = validProposal();
    const upper = structuredClone(lower);
    upper.organizationId = lower.organizationId.toUpperCase();

    expect(researchExperimentIdentityV1(upper).spec.organizationId).toBe(lower.organizationId);
    expect(researchExperimentIdentityV1(upper).specSha256)
      .toBe(researchExperimentIdentityV1(lower).specSha256);
  });

  it("binds every replay control into proposal identity", () => {
    const baseline = validProposal();
    const baselineDigest = researchExperimentIdentityV1(baseline).specSha256;
    const fusedContext = clone(baseline);
    fusedContext.replay.enableReplayFusedContext = true;
    expect(researchExperimentIdentityV1(fusedContext).specSha256).not.toBe(baselineDigest);

    const streaming = clone(baseline);
    streaming.replay.retentionMode = "STREAM_ONLY";
    expect(researchExperimentIdentityV1(streaming).specSha256).not.toBe(baselineDigest);

    // The remaining controls are fixed literals: their accepted values are part of
    // the baseline digest, while attempts to alter them are rejected below.
    expect(parseResearchExperimentSpecV1(baseline).replay.submitResearchMockOrders).toBe(true);
    expect(parseResearchExperimentSpecV1(baseline).replay.partialRunEvidence).toBe("ineligible");
  });

  it("requires the replay safety controls and rejects unsupported alternatives", () => {
    const controls: Array<[string, (proposal: ReturnType<typeof validProposal>) => void, RegExp]> = [
      ["submitResearchMockOrders", proposal => { delete (proposal.replay as Record<string, unknown>).submitResearchMockOrders; }, /submitResearchMockOrders/],
      ["submitResearchMockOrders false", proposal => { proposal.replay.submitResearchMockOrders = false as true; }, /submitResearchMockOrders/],
      ["enableReplayFusedContext", proposal => { delete (proposal.replay as Record<string, unknown>).enableReplayFusedContext; }, /enableReplayFusedContext/],
      ["enableReplayFusedContext nonboolean", proposal => { proposal.replay.enableReplayFusedContext = "true" as unknown as boolean; }, /enableReplayFusedContext/],
      ["retentionMode", proposal => { delete (proposal.replay as Record<string, unknown>).retentionMode; }, /retentionMode/],
      ["retentionMode unsupported", proposal => { proposal.replay.retentionMode = "UNBOUNDED" as "FULL"; }, /retentionMode/],
      ["partialRunEvidence", proposal => { delete (proposal.replay as Record<string, unknown>).partialRunEvidence; }, /partialRunEvidence/],
      ["partialRunEvidence eligible", proposal => { proposal.replay.partialRunEvidence = "eligible" as "ineligible"; }, /partialRunEvidence/],
    ];

    for (const [label, mutate, expected] of controls) {
      const proposal = validProposal();
      mutate(proposal);
      expect(() => parseResearchExperimentSpecV1(proposal), label).toThrow(expected);
    }
  });

  it("rejects an unapproved cost and any missing canonical cost field", () => {
    const changedCost = validProposal();
    changedCost.costs.halfSpreadBps = "6" as typeof changedCost.costs.halfSpreadBps;
    rejects(changedCost, /halfSpreadBps/);

    const missingCost = validProposal();
    delete (missingCost.costs as Partial<typeof missingCost.costs>).cancelLatencyMs;
    rejects(missingCost, /cancelLatencyMs/);
  });

  it("rejects invalid universe identity and a reused train/validation partition", () => {
    const wrongUniverse = validProposal();
    wrongUniverse.universe.market = "FUTURES" as typeof wrongUniverse.universe.market;
    rejects(wrongUniverse, /market/);

    const reused = validProposal();
    reused.partitions.validation.contentSha256 = reused.partitions.train.contentSha256;
    rejects(reused, /reused partition content identity/);
  });

  it("rejects duplicate ordered trials and duplicate observation evidence", () => {
    const duplicateTrial = validProposal();
    duplicateTrial.orderedTrials[2] = clone(duplicateTrial.orderedTrials[0]!);
    rejects(duplicateTrial, /duplicate declared trial/);

    const duplicateEvidence = validProposal();
    duplicateEvidence.hypothesis.observationEvidenceSha256[1] =
      duplicateEvidence.hypothesis.observationEvidenceSha256[0]!;
    rejects(duplicateEvidence, /duplicate observation evidence/);
  });

  it.each([
    ["train/validation overlap", (proposal: ReturnType<typeof validProposal>) => {
      proposal.partitions.validation.firstOpenMs = 199;
    }, /train\/validation\/blind intervals overlap or are out of order/],
    ["validation/blind out of order", (proposal: ReturnType<typeof validProposal>) => {
      proposal.partitions.blind.firstOpenMs = 299;
    }, /train\/validation\/blind intervals overlap or are out of order/],
    ["discovery observation inside training", (proposal: ReturnType<typeof validProposal>) => {
      proposal.hypothesis.observationCutoffMs = 190;
    }, /hypothesis observations must end before training starts/],
    ["discovery observation at training start", (proposal: ReturnType<typeof validProposal>) => {
      proposal.hypothesis.observationCutoffMs = 100;
    }, /hypothesis observations must end before training starts/],
    ["post-train hypothesis evidence", (proposal: ReturnType<typeof validProposal>) => {
      proposal.hypothesis.observationCutoffMs = 201;
    }, /hypothesis observations must end before training starts/],
    ["future point-in-time universe", (proposal: ReturnType<typeof validProposal>) => {
      proposal.universe.knownAtMs = 101;
    }, /universe is not known at training start/],
    ["walk-forward outside validation", (proposal: ReturnType<typeof validProposal>) => {
      proposal.partitions.walkForward[0]!.firstOpenMs = 199;
    }, /walk-forward windows must be ordered non-overlapping validation slices/],
    ["overlapping walk-forward windows", (proposal: ReturnType<typeof validProposal>) => {
      proposal.partitions.walkForward[1]!.firstOpenMs = 239;
    }, /walk-forward windows must be ordered non-overlapping validation slices/],
    ["unordered walk-forward windows", (proposal: ReturnType<typeof validProposal>) => {
      proposal.partitions.walkForward.reverse();
    }, /walk-forward windows must be ordered non-overlapping validation slices/],
  ])("rejects %s", (_label, mutate, expected) => {
    const proposal = validProposal();
    (mutate as (proposal: ReturnType<typeof validProposal>) => void)(proposal);
    rejects(proposal, expected as RegExp);
  });

  it.each([
    ["root unknown field", (proposal: Record<string, unknown>) => { proposal.qualified = true; }],
    ["selected parameters", (proposal: Record<string, unknown>) => {
      (proposal.selection as Record<string, unknown>).selectedParameters = { lookbackBars: 8 };
    }],
    ["execution authority field", (proposal: Record<string, unknown>) => {
      (proposal.replay as Record<string, unknown>).execute = true;
    }],
  ])("rejects %s", (_label, mutate) => {
    const proposal = validProposal() as unknown as Record<string, unknown>;
    (mutate as (proposal: Record<string, unknown>) => void)(proposal);
    rejects(proposal, /Unrecognized key/);
  });

  it("clones and freezes parsed data so later caller mutation cannot alter the proposal", () => {
    const input = validProposal();
    const parsed = parseResearchExperimentSpecV1(input);
    const before = researchExperimentIdentityV1(input).specSha256;
    input.orderedTrials[0]!.lookbackBars = 64;
    input.partitions.walkForward[0]!.barCount = 99;
    input.hypothesis.observationEvidenceSha256[0] = digest("f");

    expect(parsed.orderedTrials[0]!.lookbackBars).toBe(8);
    expect(parsed.partitions.walkForward[0]!.barCount).toBe(10);
    expect(parsed.hypothesis.observationEvidenceSha256[0]).toBe(digest("a"));
    expect(researchExperimentIdentityV1(parsed).specSha256).toBe(before);
  });
});
