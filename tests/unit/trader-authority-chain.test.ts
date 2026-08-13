import { describe, expect, it } from "vitest";

import { COST_MODEL_VERSION_V1 } from "@/lib/trader/execution/cost-model";
import {
  computeDecisionEvRangeV1,
  computeReplicaPayoffMeans,
} from "@/lib/trader/intelligence/decision-economics";
import {
  buildDecisionRecord,
  type BuildDecisionRecordInput,
} from "@/lib/trader/intelligence/forecast-decision/build-decision-record";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import type { StrategySignal } from "@/lib/trader/intelligence/types";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { createInitialPortfolioAccountState } from "@/lib/trader/portfolio/derive-portfolio-account-state";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { computeStopBasedQuantity } from "@/lib/trader/portfolio/stop-based-sizing";
import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import {
  assertAuthorityChainStageOrdering,
  assertHypothesisConfidenceNonAuthoritative,
  AUTHORITY_CHAIN_STAGES,
  AuthorityChainViolationError,
  clampRiskProposalDownwardOnly,
  extractLegacyStrategyDiagnostics,
  RiskImprovementForbiddenError,
  V2_CAPITAL_AUTHORITY_PATH,
} from "@/lib/trader/risk/authority-chain";
import {
  advanceKillFold,
  createKillFoldState,
  killFoldEnforcementModeForStage,
  runKillFoldToHalt,
} from "@/lib/trader/risk/kill-switch/kill-fold";
import { mapKillFoldToDecision } from "@/lib/trader/risk/kill-switch-enforcement";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";

const EVALUATED_AT = "2026-08-10T12:00:00.000Z";

const ORDER: PlaceOrderInput = {
  clientOrderId: "coid-auth",
  symbol: "BTC/USDT",
  side: "buy",
  type: "limit",
  price: "65000",
  quantity: "0.1",
};

const WIDE_LIMITS = {
  maxRiskPerTradePct: "0.01",
  maxPortfolioRiskPct: "0.50",
  maxConcurrentPositions: 10,
  maxNotional: "100000.00",
};

const COST_MODEL = {
  version: COST_MODEL_VERSION_V1,
  feesBps: "10",
  slippageBps: "5",
};

function sampleReplicaMeans() {
  const sample = [0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
  return computeReplicaPayoffMeans({
    notionalUsdt: 10_000,
    costRate: 0.0035,
    slippageBufferUsdt: 5,
    replicaSamples: [[sample], [sample], [sample]],
  });
}

function buildV2DecisionInput(
  overrides: Partial<BuildDecisionRecordInput> = {},
): BuildDecisionRecordInput {
  const cycle = runWp14EvaluationCycle();
  const bundle = buildIntelligenceCycleBundle({
    organizationId: "org-wp14",
    runId: "wp14-run",
    cycleId: "0",
    symbol: "BTC/USDT",
    marketStateSnapshot: cycle.marketStateSnapshot!,
    decisionChain: cycle.decisionChain!,
  });
  const means = sampleReplicaMeans();
  const decisionEvRange = computeDecisionEvRangeV1({
    muBaseReplicas: means.muBaseReplicas,
    muLowerReplicas: means.muLowerReplicas,
    scientificAdmissionVerified: true,
  });

  return {
    intelligenceCycleBundle: bundle,
    decisionChain: cycle.decisionChain!,
    msv: cycle.msv,
    signal: cycle.signal,
    capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
    decisionEvRange,
    ...overrides,
  };
}

function mutateSignal(base: StrategySignal, patch: Partial<StrategySignal>): StrategySignal {
  return { ...base, ...patch };
}

describe("trader authority chain (DEE-521)", () => {
  describe("authority ordering", () => {
    it("accepts causal Forecast→Decision→…→Execution ordering", () => {
      expect(() =>
        assertAuthorityChainStageOrdering([
          "FORECAST",
          "DECISION",
          "DESIRED_SIZE",
          "PORTFOLIO",
          "RISK",
          "EXECUTION",
        ]),
      ).not.toThrow();
    });

    it("rejects out-of-order stage completion", () => {
      expect(() => assertAuthorityChainStageOrdering(["DECISION", "FORECAST"])).toThrow(
        AuthorityChainViolationError,
      );
    });

    it("defines the full frozen chain", () => {
      expect(AUTHORITY_CHAIN_STAGES).toEqual([
        "FORECAST",
        "DECISION",
        "DESIRED_SIZE",
        "PORTFOLIO",
        "RISK",
        "EXECUTION",
      ]);
    });
  });

  describe("risk downward-only", () => {
    it("clamps to the smaller quantity", () => {
      expect(
        clampRiskProposalDownwardOnly({
          proposedQuantity: "0.10",
          riskApprovedQuantity: "0.05",
        }),
      ).toBe("0.05");
    });

    it("forbids risk improving a proposal", () => {
      expect(() =>
        clampRiskProposalDownwardOnly({
          proposedQuantity: "0.05",
          riskApprovedQuantity: "0.10",
        }),
      ).toThrow(RiskImprovementForbiddenError);
    });
  });

  describe("kill fold", () => {
    it("advances TRIPPED→…→CLOSE_ONLY on trip initiation", () => {
      let fold = createKillFoldState(EVALUATED_AT);
      fold = advanceKillFold(fold);
      fold = advanceKillFold(fold);
      fold = advanceKillFold(fold, { pendingEntriesCancelled: true });

      expect(fold.stage).toBe("CLOSE_ONLY");
      expect(fold.exposureRevoked).toBe(true);
      expect(fold.pendingEntriesCancelled).toBe(true);
      expect(killFoldEnforcementModeForStage(fold.stage)).toBe("CLOSE_ONLY");
    });

    it("runs to HALT when flat and reconciled", () => {
      const fold = runKillFoldToHalt(EVALUATED_AT, {
        isFlat: true,
        reconcileComplete: true,
      });

      expect(fold.stage).toBe("HALT");
      expect(fold.haltActive).toBe(true);
      expect(killFoldEnforcementModeForStage("HALT")).toBe("STOP_ACCOUNT");
    });

    it("maps kill fold CLOSE_ONLY to risk CLOSE_ONLY decision", () => {
      let fold = createKillFoldState(EVALUATED_AT);
      fold = advanceKillFold(fold);
      fold = advanceKillFold(fold);
      fold = advanceKillFold(fold, { pendingEntriesCancelled: true });

      const result = mapKillFoldToDecision(fold, ORDER, EVALUATED_AT);
      expect(result.enforced).toBe(true);
      expect(result.decision?.outcome).toBe("CLOSE_ONLY");
    });
  });

  describe("strategy mutation non-effect on V2 EV and decision", () => {
    it("ignores legacy strategy confidence/expectedEdge/maxRisk for V2 decision record", () => {
      const baselineInput = buildV2DecisionInput();
      const baseline = buildDecisionRecord(baselineInput);
      const mutated = buildDecisionRecord(
        buildV2DecisionInput({
          signal: mutateSignal(baselineInput.signal, {
            confidence: "0.99",
            expectedEdge: "99999.00",
            maxRisk: "1.00",
          }),
        }),
      );

      expect(mutated.decisionClass).toBe(baseline.decisionClass);
      expect(mutated.costEvidenceState).toBe("NOT_APPLICABLE");
      expect(mutated.grossExpectedReward).toBeNull();
      expect(mutated.expectedRewardAfterCosts).toBeNull();
      expect(mutated.strategyId).toBe(baseline.strategyId);
    });

    it("extracts legacy diagnostics without using them for economics", () => {
      const input = buildV2DecisionInput();
      const diagnostics = extractLegacyStrategyDiagnostics(input.signal);
      expect(diagnostics.legacyDiagnosticConfidence).toBeDefined();
      expect(diagnostics.legacyDiagnosticExpectedEdge).toBeDefined();
      expect(diagnostics.legacyDiagnosticMaxRisk).toBeDefined();
    });
  });

  describe("hypothesis confidence firewall", () => {
    it("keeps Forecast-owned EV unchanged when conviction mutates", () => {
      const means = sampleReplicaMeans();
      const decisionEvRange = computeDecisionEvRangeV1({
        muBaseReplicas: means.muBaseReplicas,
        muLowerReplicas: means.muLowerReplicas,
        scientificAdmissionVerified: true,
      });

      const baselineDecision = buildDecisionRecord(buildV2DecisionInput({ decisionEvRange }));

      const cycle = runWp14EvaluationCycle();
      const highConvictionBundle = buildIntelligenceCycleBundle({
        organizationId: "org-wp14",
        runId: "wp14-run",
        cycleId: "0",
        symbol: "BTC/USDT",
        marketStateSnapshot: cycle.marketStateSnapshot!,
        decisionChain: cycle.decisionChain!,
      });
      const lowConvictionBundle = {
        ...highConvictionBundle,
        conviction: {
          ...highConvictionBundle.conviction,
          convictionValue: "0.01",
        },
      };

      const mutatedDecision = buildDecisionRecord(
        buildV2DecisionInput({
          intelligenceCycleBundle: lowConvictionBundle,
          decisionEvRange,
        }),
      );

      expect(mutatedDecision.decisionClass).toBe(baselineDecision.decisionClass);
      expect(mutatedDecision.costEvidenceState).toBe(baselineDecision.costEvidenceState);
      expect(mutatedDecision.grossExpectedReward).toBe(baselineDecision.grossExpectedReward);
    });

    it("fails closed when hypothesis confidence is used as capital authority", () => {
      expect(() =>
        assertHypothesisConfidenceNonAuthoritative({
          convictionValue: 0.9,
          usedAsProbabilityOrCapitalAuthority: true,
        }),
      ).toThrow(AuthorityChainViolationError);
    });
  });

  describe("scientific admission fail-closed for V2 economics", () => {
    it("missing verified admission yields non-actionable EV", () => {
      const means = sampleReplicaMeans();
      const ev = computeDecisionEvRangeV1({
        muBaseReplicas: means.muBaseReplicas,
        muLowerReplicas: means.muLowerReplicas,
        scientificAdmissionVerified: false,
      });
      expect(ev.decisionActionable).toBe(false);
      expect(ev.reasonCodes).toContain("SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED");
    });

    it("verified admission still requires EV_lower > 0", () => {
      const means = sampleReplicaMeans();
      // Force non-positive EV_lower via heavily negative returns path is covered elsewhere;
      // verified=true alone is not capital authorization.
      const ev = computeDecisionEvRangeV1({
        muBaseReplicas: means.muBaseReplicas,
        muLowerReplicas: means.muLowerReplicas,
        scientificAdmissionVerified: true,
      });
      if (ev.evLower > 0) {
        expect(ev.decisionActionable).toBe(true);
      } else {
        expect(ev.decisionActionable).toBe(false);
      }
    });
  });

  describe("maxRisk quarantine on V2 sizing path", () => {
    it("does not clamp by StrategySignal.maxRisk on V2 path", () => {
      const cycle = runWp14EvaluationCycle();
      const account = createInitialPortfolioAccountState({
        runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "100000.00" },
        limits: WIDE_LIMITS,
        stopDistanceProvider: defaultStopDistanceProvider,
      });

      const baseInput = {
        side: "buy" as const,
        entryPrice: "65000.00",
        defaultQuantity: "1",
        account,
        limits: WIDE_LIMITS,
        stopDistanceProvider: defaultStopDistanceProvider,
        runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, defaultStopDistancePct: "0.02" },
        costModel: COST_MODEL,
      };

      const v1TightMaxRisk = computeStopBasedQuantity({
        ...baseInput,
        signal: mutateSignal(cycle.signal, { maxRisk: "100.00" }),
        capitalAuthorityPath: "v1",
      });
      const v1WideMaxRisk = computeStopBasedQuantity({
        ...baseInput,
        signal: mutateSignal(cycle.signal, { maxRisk: "50000.00" }),
        capitalAuthorityPath: "v1",
      });
      const v2TightMaxRisk = computeStopBasedQuantity({
        ...baseInput,
        signal: mutateSignal(cycle.signal, { maxRisk: "100.00" }),
        capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
      });
      const v2WideMaxRisk = computeStopBasedQuantity({
        ...baseInput,
        signal: mutateSignal(cycle.signal, { maxRisk: "50000.00" }),
        capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
      });

      expect(v1TightMaxRisk.ok).toBe(true);
      expect(v1WideMaxRisk.ok).toBe(true);
      if (v1TightMaxRisk.ok && v1WideMaxRisk.ok) {
        expect(v1TightMaxRisk.quantity).not.toBe(v1WideMaxRisk.quantity);
      }

      expect(v2TightMaxRisk.ok).toBe(true);
      expect(v2WideMaxRisk.ok).toBe(true);
      if (v2TightMaxRisk.ok && v2WideMaxRisk.ok) {
        expect(v2TightMaxRisk.quantity).toBe(v2WideMaxRisk.quantity);
      }
    });
  });
});
