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
  "нет экономического преимущества",
  "не хватает evidence",
  "вето Risk",
  "ограничения runtime",
  "конфликт или неизвестность предыдущего исполнения",
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

export function noTradeCategory(code: string): NoTradeCategory | `Прочее: ${string}` | null {
  if (NOT_A_REFUSAL.has(code)) return null;
  if (EVIDENCE.has(code)) return "не хватает evidence";
  if (ECONOMIC.has(code)) return "нет экономического преимущества";
  if (RISK.has(code)) return "вето Risk";
  if (RUNTIME.has(code)) return "ограничения runtime";
  if (CONFLICT.has(code)) return "конфликт или неизвестность предыдущего исполнения";
  return `Прочее: ${code}`;
}

/** A justified no-trade outcome is not an incident. */
export function noTradeEntersIncidentQueue(code: string): boolean {
  const category = noTradeCategory(code);
  if (category == null) return false;
  if (category.startsWith("Прочее:")) return false;
  return false;
}
