import {
  cdeReasonCodes,
  featureReasonCodes,
  liquiditySweepReasonCodes,
  strategyReasonCodes,
  trendMomentumReasonCodes,
} from "@/lib/trader/intelligence/types";
import { miCoreReasonCodes } from "@/lib/trader/intelligence/mi-core.types";
import { universalTerminalReasonCodes } from "@/lib/trader/intelligence/terminal-reason/universal-terminal-reason";

export const NO_TRADE_CATEGORIES = [
  "no economic edge",
  "insufficient evidence",
  "Risk veto",
  "runtime restrictions",
  "conflict or unknown prior execution",
] as const;

export type NoTradeCategory = (typeof NO_TRADE_CATEGORIES)[number];

const EVIDENCE = new Set<string>([
  "NO_HYPOTHESIS",
  "NO_ACTIVE",
  "INSUFFICIENT_BARS",
  featureReasonCodes.insufficientBars,
  featureReasonCodes.barGapDetected,
  featureReasonCodes.staleQuote,
  miCoreReasonCodes.reconstructionInsufficientBars,
  miCoreReasonCodes.hypothesisNoActive,
  cdeReasonCodes.understandingDataInsufficient,
  cdeReasonCodes.understandingKnowledgeGap,
  cdeReasonCodes.providerDegraded,
  cdeReasonCodes.fusedContextReduced,
]);

const ECONOMIC = new Set<string>([
  "NO_TRADE",
  cdeReasonCodes.understandingNoTrade,
  cdeReasonCodes.understandingWait,
  cdeReasonCodes.understandingPreserveCapital,
  cdeReasonCodes.understandingStressed,
  strategyReasonCodes.zscoreNeutral,
  trendMomentumReasonCodes.regimeFlat,
  trendMomentumReasonCodes.zscoreNeutral,
  liquiditySweepReasonCodes.noPattern,
  miCoreReasonCodes.hypothesisConvictionBelowThreshold,
]);

const RUNTIME = new Set<string>([
  strategyReasonCodes.permissionBlocked,
  strategyReasonCodes.strategyNotAllowed,
  trendMomentumReasonCodes.permissionBlocked,
  trendMomentumReasonCodes.strategyNotAllowed,
  liquiditySweepReasonCodes.permissionBlocked,
  liquiditySweepReasonCodes.strategyNotAllowed,
  cdeReasonCodes.qualityPaperOnly,
  miCoreReasonCodes.opportunityNotAuthorized,
]);

const CONFLICT = new Set<string>([
  cdeReasonCodes.understandingCrossVenueConflict,
  cdeReasonCodes.regimeUnknown,
]);

const RISK = new Set<string>(["ALLOW_REDUCED_RISK", cdeReasonCodes.understandingReducedRisk]);

const NOT_A_REFUSAL = new Set<string>([
  "ALLOW_TRADING",
  "ALLOW_REDUCED_RISK",
  miCoreReasonCodes.opportunityAuthorized,
  miCoreReasonCodes.cdeConvictionAllowTrading,
  miCoreReasonCodes.cdeConvictionAllowReducedRisk,
  miCoreReasonCodes.cdeTruthfulHealthSufficient,
  miCoreReasonCodes.cdeTruthfulHealthDegradedOk,
  miCoreReasonCodes.decisionChainComplete,
  cdeReasonCodes.qualityAllowTrading,
  cdeReasonCodes.convictionAllowTrading,
  cdeReasonCodes.convictionAllowReducedRisk,
  cdeReasonCodes.truthfulHealthDegradedOk,
  cdeReasonCodes.truthfulHealthSufficient,
  cdeReasonCodes.regimeRange,
  cdeReasonCodes.regimeTrendBear,
  cdeReasonCodes.newsSentimentDeferredPr3,
  strategyReasonCodes.zscoreBuy,
  strategyReasonCodes.zscoreSell,
  trendMomentumReasonCodes.momentumEntry,
  trendMomentumReasonCodes.momentumExit,
  liquiditySweepReasonCodes.sweepEntry,
  liquiditySweepReasonCodes.recoveryExit,
]);

export function knownNoTradeCodes(): readonly string[] {
  return [
    ...universalTerminalReasonCodes,
    ...Object.values(featureReasonCodes),
    ...Object.values(cdeReasonCodes),
    ...Object.values(strategyReasonCodes),
    ...Object.values(trendMomentumReasonCodes),
    ...Object.values(liquiditySweepReasonCodes),
    ...Object.values(miCoreReasonCodes),
  ];
}

export function noTradeCategory(code: string): NoTradeCategory | `Other: ${string}` | null {
  if (NOT_A_REFUSAL.has(code)) return null;
  if (EVIDENCE.has(code)) return "insufficient evidence";
  if (ECONOMIC.has(code)) return "no economic edge";
  if (RISK.has(code)) return "Risk veto";
  if (RUNTIME.has(code)) return "runtime restrictions";
  if (CONFLICT.has(code)) return "conflict or unknown prior execution";
  return `Other: ${code}`;
}

/** A justified no-trade outcome is not an incident. */
export function noTradeEntersIncidentQueue(code: string): boolean {
  const category = noTradeCategory(code);
  if (category == null) return false;
  if (category.startsWith("Other:")) return false;
  return false;
}
