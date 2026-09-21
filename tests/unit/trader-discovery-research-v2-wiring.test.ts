import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/research-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trader/research-v2")>();
  return {
    ...actual,
    runStrategyEvolutionResearchPassV2: vi.fn(actual.runStrategyEvolutionResearchPassV2),
  };
});

import {
  DEFAULT_DISCOVERY_RUN_CONFIG,
  DISCOVERY_SCHEMA_VERSION,
  type DiscoveryRunContext,
} from "@/lib/trader/discovery/discovery.types";
import { runDiscoveryEvolutionPass } from "@/lib/trader/discovery/evolution-orchestrator";
import { NoReinforcementGuardError } from "@/lib/trader/discovery/no-reinforcement-guard";
import {
  qualifyFutureCycleEpistemicEffectV2,
  type KnowledgeNavigatorCandidateV2,
  type SelectKnowledgeForQuestionV2Input,
} from "@/lib/trader/knowledge/navigator";
import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";
import {
  runStrategyEvolutionResearchPassV2,
  type PartitionWindowMetricV2,
  type QualificationEvaluationV2,
  type StrategyParentRefV2,
} from "@/lib/trader/research-v2";

const DIGEST = {
  a: "a".repeat(64),
  b: "b".repeat(64),
  c: "c".repeat(64),
  d: "d".repeat(64),
  e: "e".repeat(64),
};
const PIT = "2026-02-01T12:00:00.000Z";
const PRIOR_PIT = "2026-01-31T12:00:00.000Z";
const CUTOFF = "2026-02-01T11:00:00.000Z";

const EX = {} as never;

function closedTrade(
  overrides: Partial<PaperClosedTrade> & Pick<PaperClosedTrade, "fillId" | "tradePnl">,
): PaperClosedTrade {
  return {
    orderId: `order-${overrides.fillId}`,
    symbol: "BTCUSDT",
    executedAt: new Date(CUTOFF),
    quantity: "1",
    price: "100",
    ...overrides,
  };
}

function parent(id: string, digest: string): StrategyParentRefV2 {
  return {
    strategyId: id,
    strategyVersion: "1.0.0",
    params: { lookbackBars: "20", holdBars: "4" },
    artifactDigestHex: digest,
  };
}

function evaluation(overrides: Partial<QualificationEvaluationV2> = {}): QualificationEvaluationV2 {
  return {
    netEconomicResult: "2.5",
    maxDrawdown: "-1.0",
    tailEventCount: 1,
    sampleSize: 12,
    incumbentComparisonDigestHex: DIGEST.b,
    ...overrides,
  };
}

function walkForwardEvaluation(): QualificationEvaluationV2 {
  return evaluation({
    netEconomicResult: "1.25",
    maxDrawdown: "-1.5",
    tailEventCount: 2,
    sampleSize: 8,
    incumbentComparisonDigestHex: DIGEST.a,
  });
}

function windowFor(
  partition: PartitionWindowMetricV2["partition"],
  source: QualificationEvaluationV2,
  windowId: string,
): PartitionWindowMetricV2 {
  return {
    windowId,
    partition,
    netEconomicResult: source.netEconomicResult,
    maxDrawdown: source.maxDrawdown,
    tailEventCount: source.tailEventCount,
    closedTradeCount: source.sampleSize,
    incumbentComparisonDigestHex: source.incumbentComparisonDigestHex,
  };
}

function navigatorCandidate(
  overrides: Partial<KnowledgeNavigatorCandidateV2> = {},
): KnowledgeNavigatorCandidateV2 {
  return {
    knowledgeEdgeId: "edge-1",
    version: 1,
    contentDigestHex: DIGEST.c,
    organizationId: "org-1025",
    symbol: "BTCUSDT",
    questionId: "WHAT_HAPPENING",
    pitEventAt: "2026-01-31T11:00:00.000Z",
    lifecycleState: "ACTIVE",
    verified: true,
    fromRef: "btc-regime",
    toRef: "btc-move",
    relationKind: "EXPLAINS",
    ...overrides,
  };
}

function navigatorSelect(
  overrides: Partial<SelectKnowledgeForQuestionV2Input> = {},
): SelectKnowledgeForQuestionV2Input {
  return {
    organizationId: "org-1025",
    runId: "run-1",
    symbol: "BTCUSDT",
    purpose: "strategy-evolution-research",
    questionId: "WHAT_HAPPENING",
    pitAnchor: PIT,
    informationNeedPlanDigestHex: DIGEST.a,
    evidenceBudget: 2,
    maxStalenessMs: 48 * 60 * 60 * 1000,
    candidates: [navigatorCandidate()],
    ...overrides,
  };
}

function futureCycle() {
  return qualifyFutureCycleEpistemicEffectV2({
    evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
    effectKind: "SUPPORT",
    producedByReceiptDigestHex: DIGEST.d,
    prior: navigatorSelect({ pitAnchor: PRIOR_PIT, runId: "run-0" }),
    future: navigatorSelect({ pitAnchor: PIT, runId: "run-1" }),
  });
}

function runContext(overrides: Partial<DiscoveryRunContext> = {}): DiscoveryRunContext {
  return {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    config: { ...DEFAULT_DISCOVERY_RUN_CONFIG },
    context: { organizationId: "org-1025" },
    campaignRef: {
      campaignId: "camp-1025",
      campaignDigest: "pending",
      state: "ACTIVE",
    },
    operatorAttestationDigest: "attest",
    ...overrides,
  };
}

function enabledAdmission() {
  return {
    navigatorSelect: navigatorSelect(),
    predictiveAdmissionVerdict: "RESEARCH_ONLY" as const,
    futureCycleEffect: futureCycle(),
    researchCodeIdentity: "research-code/v2",
    costModelIdentity: "cost-model/v2",
    generation: {
      kind: "PARAMETER_MUTATION" as const,
      candidateId: "cand-1025",
      strategyId: "mean_reversion_research",
      strategyVersion: "1.1.0",
      parents: [parent("mean_reversion_research", DIGEST.e)],
      params: { lookbackBars: "24", holdBars: "4" },
    },
    development: evaluation(),
    walkForward: walkForwardEvaluation(),
    developmentWindows: [windowFor("DEVELOPMENT", evaluation(), "dev-1")],
    walkForwardWindows: [windowFor("WALK_FORWARD", walkForwardEvaluation(), "wf-1")],
    qualificationVerdict: "QUALIFIED" as const,
    evidenceCutoffUtc: CUTOFF,
    symbol: "BTCUSDT",
  };
}

describe("DEE-1025 discovery research-v2 wiring", () => {
  beforeEach(() => {
    vi.mocked(runStrategyEvolutionResearchPassV2).mockClear();
  });

  it("keeps default discovery disabled and skips without calling research-v2", async () => {
    expect(DEFAULT_DISCOVERY_RUN_CONFIG.enabled).toBe(false);
    const result = await runDiscoveryEvolutionPass(EX, {
      runContext: runContext(),
      bars: [],
      closedTrades: [],
    });
    expect(result).toEqual({
      skipped: true,
      reason: "discovery_run_disabled",
    });
    expect(runStrategyEvolutionResearchPassV2).not.toHaveBeenCalled();
  });

  it("fails closed when enabled without navigator or admission fields and does not synthesize mean_reversion_v0", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/trader/discovery/evolution-orchestrator.ts"),
      "utf8",
    );
    expect(source).not.toContain("synthesizeDefaultStrategy");
    expect(source).not.toContain("mean_reversion_v0");
    expect(source).not.toContain("promoteStrategyCandidateV2");
    expect(source).not.toContain("assignStrategyCandidateToAccountV2");

    const result = await runDiscoveryEvolutionPass(EX, {
      runContext: runContext({
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      }),
      config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      bars: [],
      closedTrades: [closedTrade({ fillId: "loss-1", tradePnl: "-8.25" })],
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("research_v2_admission_incomplete");
    expect(result.status).toBe("FAIL_CLOSED");
    expect(result.capitalAuthority).toBe("NONE");
    expect(runStrategyEvolutionResearchPassV2).not.toHaveBeenCalled();
  });

  it("runs RESEARCH_ONLY + navigator + a LOSS through research-v2 and retains the losing outcome", async () => {
    const result = await runDiscoveryEvolutionPass(EX, {
      runContext: runContext({
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      }),
      config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      bars: [],
      closedTrades: [
        closedTrade({ fillId: "win-1", tradePnl: "12.5" }),
        closedTrade({ fillId: "loss-1", tradePnl: "-8.25" }),
      ],
      ...enabledAdmission(),
    });

    expect(runStrategyEvolutionResearchPassV2).toHaveBeenCalledTimes(1);
    const v2Input = vi.mocked(runStrategyEvolutionResearchPassV2).mock.calls[0]?.[0];
    expect(v2Input?.predictiveAdmissionVerdict).toBe("RESEARCH_ONLY");
    expect(v2Input?.outcomes.map((row) => row.netEconomicResult).sort()).toEqual(["-8.25", "12.5"]);
    expect(v2Input?.outcomes.some((row) => row.outcomeId === "loss-1")).toBe(true);

    expect(result.skipped).toBe(false);
    expect(result.status).toBe("HUMAN_PROPOSAL_PENDING");
    expect(result.capitalAuthority).toBe("RESEARCH_ONLY");
    expect(result.outcomePolarities).toEqual(["PROFIT", "LOSS"]);
    expect(result.candidateProposalId).toBe("cand-1025");
    expect(result.promotionProposalId).toBe("camp-1025:proposal");
    expect(result.researchQuestionId).toBe("camp-1025:question");
    expect(result.hypothesisProposalId).toBe("camp-1025:hypothesis");
  });

  it("fails closed when a supplied evaluation does not match the recorded windows", async () => {
    const result = runDiscoveryEvolutionPass(EX, {
      runContext: runContext({
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      }),
      config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      bars: [],
      closedTrades: [closedTrade({ fillId: "loss-1", tradePnl: "-8.25" })],
      ...enabledAdmission(),
      development: evaluation({ netEconomicResult: "99" }),
    });
    await expect(result).rejects.toThrow(/QUALIFICATION_PARTITION_METRICS_MISMATCH/);
    expect(runStrategyEvolutionResearchPassV2).not.toHaveBeenCalled();
  });

  it("derives the research-v2 evaluations from the recorded windows", async () => {
    const {
      development: _development,
      walkForward: _walkForward,
      developmentWindows: _developmentWindows,
      walkForwardWindows: _walkForwardWindows,
      ...admission
    } = enabledAdmission();
    void _development;
    void _walkForward;
    void _developmentWindows;
    void _walkForwardWindows;
    const developmentWindows = [
      windowFor(
        "DEVELOPMENT",
        evaluation({
          netEconomicResult: "1",
          maxDrawdown: "-0.5",
          tailEventCount: 1,
          sampleSize: 3,
        }),
        "dev-1",
      ),
      windowFor(
        "DEVELOPMENT",
        evaluation({
          netEconomicResult: "0.25",
          maxDrawdown: "-1.5",
          tailEventCount: 1,
          sampleSize: 5,
        }),
        "dev-2",
      ),
    ];
    const result = await runDiscoveryEvolutionPass(EX, {
      runContext: runContext({
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      }),
      config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      bars: [],
      closedTrades: [
        closedTrade({ fillId: "win-1", tradePnl: "12.5" }),
        closedTrade({ fillId: "loss-1", tradePnl: "-8.25" }),
      ],
      ...admission,
      developmentWindows,
      walkForwardWindows: [windowFor("WALK_FORWARD", walkForwardEvaluation(), "wf-1")],
    });
    expect(result.skipped).toBe(false);
    const v2Input = vi.mocked(runStrategyEvolutionResearchPassV2).mock.calls[0]?.[0];
    expect(v2Input?.development).toEqual({
      netEconomicResult: "1.25",
      maxDrawdown: "-1.5",
      tailEventCount: 2,
      sampleSize: 8,
      incumbentComparisonDigestHex: DIGEST.b,
    });
    expect(v2Input?.walkForward).toEqual(walkForwardEvaluation());
    expect(v2Input?.development.netEconomicResult).not.toBe("-8.25");
  });

  it("fails closed when enabled admission omits the partition windows", async () => {
    const {
      developmentWindows: _developmentWindows,
      walkForwardWindows: _walkForwardWindows,
      ...admission
    } = enabledAdmission();
    void _developmentWindows;
    void _walkForwardWindows;
    const result = await runDiscoveryEvolutionPass(EX, {
      runContext: runContext({
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      }),
      config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      bars: [],
      closedTrades: [closedTrade({ fillId: "loss-1", tradePnl: "-8.25" })],
      ...admission,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("research_v2_admission_incomplete");
    expect(runStrategyEvolutionResearchPassV2).not.toHaveBeenCalled();
  });

  it("refuses holdoutQueryAttempted as iterative fitness", async () => {
    await expect(
      runDiscoveryEvolutionPass(EX, {
        runContext: runContext({
          config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
        }),
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
        bars: [],
        closedTrades: [
          closedTrade({ fillId: "win-1", tradePnl: "12.5" }),
          closedTrade({ fillId: "loss-1", tradePnl: "-8.25" }),
        ],
        ...enabledAdmission(),
        holdoutQueryAttempted: true,
      }),
    ).rejects.toThrow(/BLIND_HOLDOUT_ITERATIVE_FITNESS_FORBIDDEN/);
  });

  it("still refuses banned fitness fields on discovery config", async () => {
    await expect(
      runDiscoveryEvolutionPass(EX, {
        runContext: runContext(),
        config: {
          ...DEFAULT_DISCOVERY_RUN_CONFIG,
          enabled: false,
          winRate: "0.9",
        } as never,
        bars: [],
        closedTrades: [],
      }),
    ).rejects.toThrow(NoReinforcementGuardError);
    expect(runStrategyEvolutionResearchPassV2).not.toHaveBeenCalled();
  });

  it("fails closed when enabled admission is present but generation and parents are missing", async () => {
    const { generation: _generation, ...admission } = enabledAdmission();
    void _generation;
    const result = await runDiscoveryEvolutionPass(EX, {
      runContext: runContext({
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      }),
      config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      bars: [],
      closedTrades: [
        closedTrade({ fillId: "win-1", tradePnl: "12.5" }),
        closedTrade({ fillId: "loss-1", tradePnl: "-8.25" }),
      ],
      ...admission,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("research_v2_generation_incomplete");
    expect(result.status).toBe("FAIL_CLOSED");
    expect(runStrategyEvolutionResearchPassV2).not.toHaveBeenCalled();
  });

  it("derives PARAMETER_MUTATION from parentStrategies when generation is omitted", async () => {
    const { generation: _generation, ...admission } = enabledAdmission();
    void _generation;
    const result = await runDiscoveryEvolutionPass(EX, {
      runContext: runContext({
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      }),
      config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      bars: [],
      closedTrades: [
        closedTrade({ fillId: "win-1", tradePnl: "12.5" }),
        closedTrade({ fillId: "loss-1", tradePnl: "-8.25" }),
      ],
      ...admission,
      parentStrategies: [parent("mean_reversion_research", DIGEST.e)],
    });
    expect(result.skipped).toBe(false);
    expect(result.status).toBe("HUMAN_PROPOSAL_PENDING");
    expect(result.candidateProposalId).toBe("camp-1025:candidate");
    const v2Input = vi.mocked(runStrategyEvolutionResearchPassV2).mock.calls[0]?.[0];
    expect(v2Input?.generation?.kind).toBe("PARAMETER_MUTATION");
    expect(v2Input?.generation?.params.holdBars).toBe("5");
  });

  it("yields enabled discovery to capital runtime without calling research-v2", async () => {
    const result = await runDiscoveryEvolutionPass(EX, {
      runContext: runContext({
        config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      }),
      config: { ...DEFAULT_DISCOVERY_RUN_CONFIG, enabled: true },
      bars: [],
      closedTrades: [closedTrade({ fillId: "win-1", tradePnl: "12.5" })],
      capitalRuntimeActive: true,
    });
    expect(result).toEqual({
      skipped: true,
      reason: "research_yielded_to_capital_runtime",
      capitalAuthority: "NONE",
    });
    expect(runStrategyEvolutionResearchPassV2).not.toHaveBeenCalled();
  });
});
