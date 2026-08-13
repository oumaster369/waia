import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import type { DecisionEvRange } from "@/lib/trader/intelligence/decision-economics/decision-economics-v2";
import { buildV2WhyNotCashJson } from "@/lib/trader/intelligence/decision-economics/decision-economics-v2-service";
import { addDecimal, multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import {
  assertHypothesisConfidenceNonAuthoritative,
  extractLegacyStrategyDiagnostics,
  isV2CapitalAuthorityPath,
  type CapitalAuthorityPath,
} from "@/lib/trader/risk/authority-chain";
import type { DecisionChain } from "@/lib/trader/intelligence/mi-core.types";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { deriveDecisionRecordId } from "@/lib/trader/intelligence/forecast-decision/derive-forecast-decision-ids";
import {
  canonicalizeReasonCodesJson,
  computeDecisionRecordContentDigest,
} from "@/lib/trader/intelligence/forecast-decision/serialize-forecast-decision";
import {
  DECISION_RECORD_SCHEMA_VERSION,
  type CostEvidenceState,
  type DecisionClass,
  type TraderIntelligenceDecisionRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { MsvEnvelope, StrategySignal } from "@/lib/trader/intelligence/types";

export const wp14DecisionReasonCodes = {
  costEvidenceUnavailable: "WP14_COST_EVIDENCE_UNAVAILABLE",
  noTradeableSignal: "WP14_NO_TRADEABLE_SIGNAL",
  cdePermissionSnapshotOnly: "WP14_CDE_MSV_PERMISSION_SNAPSHOT_ONLY",
} as const;

export type BuildDecisionRecordInput = Readonly<{
  intelligenceCycleBundle: IntelligenceCycleBundle;
  decisionChain: DecisionChain;
  msv: MsvEnvelope;
  signal: StrategySignal;
  costModel?: CostModelV1;
  /** V2 capital path quarantines legacy strategy EV/sizing fields (§1.20). */
  capitalAuthorityPath?: CapitalAuthorityPath;
  /** Forecast-owned EV range for V2 actionability (§1.23). */
  decisionEvRange?: DecisionEvRange;
  /** V2 forecast/package binding for economics-owned whyNotCashJson. */
  forecastId?: string;
  packageContentDigestHex?: string;
  packageGenerationDigestHex?: string;
  scientificAdmissionReceiptDigest?: string | null;
}>;

type CostEvidenceResolution = Readonly<{
  state: CostEvidenceState;
  grossExpectedReward: string | null;
  expectedFees: string | null;
  expectedSlippage: string | null;
  expectedOtherCosts: string | null;
  expectedRewardAfterCosts: string | null;
  costModelId: string | null;
  costModelVersion: string | null;
}>;

function buildCdeMsvPermissionSnapshot(msv: MsvEnvelope): string {
  return canonicalizeSemanticJsonString({
    regime: msv.derived.regime,
    trading_permission: msv.derived.tradingPermission,
    allowed_strategy_ids: msv.derived.allowedStrategyIds,
    risk_multiplier: msv.derived.riskMultiplier,
    data_quality_score: msv.derived.dataQualityScore,
    reason_codes: msv.derived.reasonCodes,
    conviction: msv.derived.conviction ?? null,
    opportunity_authorized: msv.derived.opportunityAuthorized ?? false,
    active_hypothesis_type: msv.derived.activeHypothesisType ?? null,
    snapshot_role: "CDE_MSV_PERMISSION_ONLY_NOT_LD7_DECISION",
  });
}

function resolveCostEvidence(
  signal: StrategySignal,
  costModel?: CostModelV1,
  capitalAuthorityPath?: CapitalAuthorityPath,
): CostEvidenceResolution {
  if (isV2CapitalAuthorityPath(capitalAuthorityPath)) {
    return {
      state: "NOT_APPLICABLE",
      grossExpectedReward: null,
      expectedFees: null,
      expectedSlippage: null,
      expectedOtherCosts: null,
      expectedRewardAfterCosts: null,
      costModelId: null,
      costModelVersion: null,
    };
  }

  if (!costModel) {
    return {
      state: "UNAVAILABLE",
      grossExpectedReward: null,
      expectedFees: null,
      expectedSlippage: null,
      expectedOtherCosts: null,
      expectedRewardAfterCosts: null,
      costModelId: null,
      costModelVersion: null,
    };
  }

  const authority = createHtrHistoricalCostModelAuthorityV1();
  const canonicalCostModel = costModelV1FromAuthority(authority);
  if (
    costModel.feesBps !== canonicalCostModel.feesBps ||
    costModel.slippageBps !== canonicalCostModel.slippageBps
  ) {
    return {
      state: "NOT_APPLICABLE",
      grossExpectedReward: null,
      expectedFees: null,
      expectedSlippage: null,
      expectedOtherCosts: null,
      expectedRewardAfterCosts: null,
      costModelId: null,
      costModelVersion: null,
    };
  }

  if (!signal.expectedEdge || signal.outcome !== "SIGNAL") {
    return {
      state: "NOT_APPLICABLE",
      grossExpectedReward: null,
      expectedFees: null,
      expectedSlippage: null,
      expectedOtherCosts: null,
      expectedRewardAfterCosts: null,
      costModelId: costModel.version,
      costModelVersion: costModel.version,
    };
  }

  const grossExpectedReward = signal.expectedEdge;
  const notional = signal.maxRisk ?? "1";
  const expectedFees = multiplyDecimal(notional, multiplyDecimal(authority.feeBps, "0.0001"));
  const expectedSpread = multiplyDecimal(
    notional,
    multiplyDecimal(authority.halfSpreadBps, "0.0001"),
  );
  const expectedImpact = multiplyDecimal(
    notional,
    multiplyDecimal(authority.marketImpactBps, "0.0001"),
  );
  const expectedSlippage = addDecimal(expectedSpread, expectedImpact);
  const expectedOtherCosts = "0";
  const expectedRewardAfterCosts = subtractDecimal(
    subtractDecimal(subtractDecimal(grossExpectedReward, expectedFees), expectedSlippage),
    expectedOtherCosts,
  );

  return {
    state: "AVAILABLE",
    grossExpectedReward,
    expectedFees,
    expectedSlippage,
    expectedOtherCosts,
    expectedRewardAfterCosts,
    costModelId: authority.modelId,
    costModelVersion: authority.schemaVersion,
  };
}

function resolveDecisionClass(input: {
  decisionChain: DecisionChain;
  signal: StrategySignal;
  costEvidence: CostEvidenceResolution;
  capitalAuthorityPath?: CapitalAuthorityPath;
  decisionEvRange?: DecisionEvRange;
}): DecisionClass {
  if (isV2CapitalAuthorityPath(input.capitalAuthorityPath)) {
    assertHypothesisConfidenceNonAuthoritative({
      convictionValue: undefined,
    });

    const tradeEligible =
      input.signal.tradeEligible === true ||
      (input.signal.outcome === "SIGNAL" && input.signal.tradeEligible !== false);

    if (
      input.decisionEvRange?.decisionActionable === true &&
      input.decisionChain.opportunityAuthorized &&
      input.decisionChain.tradingPermission === "ALLOW_TRADING" &&
      tradeEligible &&
      input.signal.outcome === "SIGNAL"
    ) {
      return "TRADE";
    }

    if (
      input.decisionEvRange?.decisionActionable === true &&
      input.decisionChain.opportunityAuthorized &&
      input.decisionChain.tradingPermission === "ALLOW_REDUCED_RISK" &&
      tradeEligible &&
      input.signal.outcome === "SIGNAL"
    ) {
      return "REDUCED_RISK";
    }

    return "NO_TRADE";
  }

  if (input.costEvidence.state === "UNAVAILABLE") {
    return "NO_TRADE";
  }

  const tradeEligible =
    input.signal.tradeEligible === true ||
    (input.signal.outcome === "SIGNAL" && input.signal.tradeEligible !== false);

  if (
    input.decisionChain.opportunityAuthorized &&
    input.decisionChain.tradingPermission === "ALLOW_TRADING" &&
    tradeEligible &&
    input.signal.outcome === "SIGNAL" &&
    input.costEvidence.state === "AVAILABLE"
  ) {
    return "TRADE";
  }

  if (
    input.decisionChain.opportunityAuthorized &&
    input.decisionChain.tradingPermission === "ALLOW_REDUCED_RISK" &&
    tradeEligible &&
    input.signal.outcome === "SIGNAL" &&
    input.costEvidence.state === "AVAILABLE"
  ) {
    return "REDUCED_RISK";
  }

  return "NO_TRADE";
}

function buildWhyNotCashJson(
  input: BuildDecisionRecordInput,
  decisionClass: DecisionClass,
): string | null {
  if (decisionClass === "NO_TRADE") {
    return null;
  }

  const legacyDiagnostics = extractLegacyStrategyDiagnostics(input.signal);

  if (isV2CapitalAuthorityPath(input.capitalAuthorityPath) && input.decisionEvRange) {
    if (!input.forecastId || !input.packageContentDigestHex || !input.packageGenerationDigestHex) {
      throw new Error("[decision-record] V2 TRADE requires forecast/package economics binding");
    }
    return buildV2WhyNotCashJson({
      forecastId: input.forecastId,
      packageContentDigestHex: input.packageContentDigestHex,
      packageGenerationDigestHex: input.packageGenerationDigestHex,
      evRange: input.decisionEvRange,
      admissionReceiptDigest: input.scientificAdmissionReceiptDigest,
    });
  }

  return canonicalizeSemanticJsonString({
    active_hypothesis_type: input.decisionChain.activeHypothesisType,
    conviction_value: input.intelligenceCycleBundle.conviction.convictionValue,
    opportunity_authorized: input.decisionChain.opportunityAuthorized,
    trading_permission: input.decisionChain.tradingPermission,
    strategy_id: input.signal.strategyId,
    strategy_version: input.signal.strategyVersion,
    lane_influence_codes: input.msv.derived.reasonCodes,
    legacy_strategy_diagnostics: isV2CapitalAuthorityPath(input.capitalAuthorityPath)
      ? legacyDiagnostics
      : undefined,
    risk_beats_cash_rationale:
      "Active hypothesis conviction and trade-eligible strategy signal justify risk over cash preservation.",
  });
}

function buildWhyCashOrAbstainJson(
  input: BuildDecisionRecordInput,
  decisionClass: DecisionClass,
  costEvidence: CostEvidenceResolution,
): string | null {
  if (decisionClass !== "NO_TRADE") {
    return null;
  }

  const abstainCodes = [...input.decisionChain.reasonCodes];
  if (costEvidence.state === "UNAVAILABLE") {
    abstainCodes.push(wp14DecisionReasonCodes.costEvidenceUnavailable);
  }
  if (input.signal.outcome !== "SIGNAL" || input.signal.tradeEligible === false) {
    abstainCodes.push(wp14DecisionReasonCodes.noTradeableSignal);
  }

  return canonicalizeSemanticJsonString({
    terminal_reason_code: input.decisionChain.terminalReasonCode,
    abstain_rationale_codes: abstainCodes,
    trading_permission: input.decisionChain.tradingPermission,
    opportunity_authorized: input.decisionChain.opportunityAuthorized,
    cde_msv_snapshot_role: "PERMISSION_CONTEXT_ONLY",
  });
}

export function buildDecisionRecord(
  input: BuildDecisionRecordInput,
): TraderIntelligenceDecisionRecord {
  const envelope = input.intelligenceCycleBundle.envelope;
  const conviction = input.intelligenceCycleBundle.conviction;
  assertHypothesisConfidenceNonAuthoritative({
    convictionValue: conviction.convictionValue,
  });
  const costEvidence = resolveCostEvidence(
    input.signal,
    input.costModel,
    input.capitalAuthorityPath,
  );
  const decisionClass = resolveDecisionClass({
    decisionChain: input.decisionChain,
    signal: input.signal,
    costEvidence,
    capitalAuthorityPath: input.capitalAuthorityPath,
    decisionEvRange: input.decisionEvRange,
  });

  const reasonCodes = [
    ...input.decisionChain.reasonCodes,
    wp14DecisionReasonCodes.cdePermissionSnapshotOnly,
  ];
  if (costEvidence.state === "UNAVAILABLE") {
    reasonCodes.push(wp14DecisionReasonCodes.costEvidenceUnavailable);
  }

  const strategyId = decisionClass === "NO_TRADE" ? null : input.signal.strategyId;
  const strategyVersion = decisionClass === "NO_TRADE" ? null : input.signal.strategyVersion;

  const base: TraderIntelligenceDecisionRecord = {
    id: deriveDecisionRecordId({
      organizationId: envelope.organizationId,
      runId: envelope.runId,
      cycleId: envelope.cycleId,
      symbol: envelope.symbol,
    }),
    organizationId: envelope.organizationId,
    cycleEnvelopeId: envelope.id,
    convictionRecordId: conviction.id,
    runId: envelope.runId,
    cycleId: envelope.cycleId,
    symbol: envelope.symbol,
    evaluatedAt: envelope.evaluatedAt,
    issuedAt: envelope.evaluatedAt,
    decisionClass,
    universalTerminalReasonCode: input.decisionChain.terminalReasonCode,
    whyNotCashJson: buildWhyNotCashJson(input, decisionClass),
    whyCashOrAbstainJson: buildWhyCashOrAbstainJson(input, decisionClass, costEvidence),
    grossExpectedReward: decisionClass === "NO_TRADE" ? null : costEvidence.grossExpectedReward,
    expectedFees: decisionClass === "NO_TRADE" ? null : costEvidence.expectedFees,
    expectedSlippage: decisionClass === "NO_TRADE" ? null : costEvidence.expectedSlippage,
    expectedOtherCosts: decisionClass === "NO_TRADE" ? null : costEvidence.expectedOtherCosts,
    expectedRewardAfterCosts:
      decisionClass === "NO_TRADE" ? null : costEvidence.expectedRewardAfterCosts,
    costModelId: decisionClass === "NO_TRADE" ? null : costEvidence.costModelId,
    costModelVersion: decisionClass === "NO_TRADE" ? null : costEvidence.costModelVersion,
    costEvidenceState:
      decisionClass === "NO_TRADE" && costEvidence.state === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : costEvidence.state,
    cdeMsvPermissionSnapshotJson: buildCdeMsvPermissionSnapshot(input.msv),
    reasonCodesJson: canonicalizeReasonCodesJson(reasonCodes),
    strategyId,
    strategyVersion,
    contentDigest: "",
    schemaVersion: DECISION_RECORD_SCHEMA_VERSION,
  };

  return {
    ...base,
    contentDigest: computeDecisionRecordContentDigest(base),
  };
}
