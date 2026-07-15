import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";
import type { HypothesisSet } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import {
  DECISION_CHAIN_SCHEMA_VERSION,
  miCoreReasonCodes,
  type CycleObservationRecord,
  type DecisionChain,
  type MarketStateSnapshot,
} from "@/lib/trader/intelligence/mi-core.types";
import type { TradingPermission } from "@/lib/trader/intelligence/types";
import { resolveUniversalTerminalReason } from "@/lib/trader/intelligence/terminal-reason/universal-terminal-reason";

export type AssembleDecisionChainInput = {
  evaluatedAt: string;
  reconstruction: ReconstructionSnapshot;
  understanding?: MarketUnderstandingSnapshot;
  hypothesisSet: HypothesisSet;
  marketStateSnapshot: MarketStateSnapshot;
  tradingPermission: TradingPermission;
  reasonCodes: readonly string[];
};

function buildObservationRecord(input: AssembleDecisionChainInput): CycleObservationRecord {
  const active = input.hypothesisSet.activeHypothesis;
  const opportunity = input.hypothesisSet.opportunity;
  const expectedPath = active?.expectedPath ?? "none";
  const observedOutcome = opportunity?.authorized
    ? `opportunity_${opportunity.hypothesisType}`
    : "no_opportunity";
  const deviation =
    active && opportunity ? (opportunity.conviction - active.confidence).toFixed(4) : "0";
  const invalidationStatus = active
    ? active.invalidationConditions.length > 0
      ? "ACTIVE"
      : "NOT_APPLICABLE"
    : "NOT_APPLICABLE";

  return {
    expectedPath,
    observedOutcome,
    deviation,
    invalidationStatus,
    terminalReasonCode: input.marketStateSnapshot.terminalReasonCode,
  };
}

export function assembleDecisionChain(input: AssembleDecisionChainInput): DecisionChain {
  const opportunity = input.hypothesisSet.opportunity;
  const observation = buildObservationRecord(input);
  const universalTerminalReason = resolveUniversalTerminalReason({
    sourceTerminalReasonCode: input.marketStateSnapshot.terminalReasonCode,
    sourceReasonCodes: input.reasonCodes,
    opportunityAuthorized: opportunity?.authorized ?? false,
    tradingPermission: input.tradingPermission,
    activeHypothesisType: input.hypothesisSet.activeHypothesis?.hypothesisType ?? null,
  });

  return {
    schemaVersion: DECISION_CHAIN_SCHEMA_VERSION,
    evaluatedAt: input.evaluatedAt,
    steps: ["RECONSTRUCTION", "UNDERSTANDING", "HYPOTHESES", "OPPORTUNITY", "CDE", "FINALIZATION"],
    terminalReasonCode: universalTerminalReason,
    reasonCodes: [...input.reasonCodes, miCoreReasonCodes.decisionChainComplete],
    observation: {
      ...observation,
      terminalReasonCode: universalTerminalReason,
    },
    reconstructionSummary: `${input.reconstruction.marketStructure.structureBias}|${input.reconstruction.trendStructure.regimeBias}|${input.reconstruction.volatilityStructure.volatilityRegime}`,
    activeHypothesisType: input.hypothesisSet.activeHypothesis?.hypothesisType ?? null,
    opportunityAuthorized: opportunity?.authorized ?? false,
    tradingPermission: input.tradingPermission,
  };
}
