import {
  featureReasonCodes,
  cdeReasonCodes,
  strategyReasonCodes,
} from "@/lib/trader/intelligence/types";
import { miCoreReasonCodes } from "@/lib/trader/intelligence/mi-core.types";

export const universalTerminalReasonCodes = [
  "NO_HYPOTHESIS",
  "NO_ACTIVE",
  "INSUFFICIENT_BARS",
  "NO_TRADE",
  "ALLOW_TRADING",
  "ALLOW_REDUCED_RISK",
] as const;

export type UniversalTerminalReasonCode = (typeof universalTerminalReasonCodes)[number];

export type ResolveUniversalTerminalReasonInput = {
  sourceTerminalReasonCode?: string | null;
  sourceReasonCodes?: readonly string[];
  opportunityAuthorized?: boolean;
  tradingPermission?: string;
  activeHypothesisType?: string | null;
  insufficientBars?: boolean;
};

export function resolveUniversalTerminalReason(
  input: ResolveUniversalTerminalReasonInput,
): UniversalTerminalReasonCode {
  if (input.insufficientBars) {
    return "INSUFFICIENT_BARS";
  }

  const source = input.sourceTerminalReasonCode ?? "";
  const reasonCodes = input.sourceReasonCodes ?? [];

  if (
    source === miCoreReasonCodes.hypothesisNoActive ||
    reasonCodes.includes(miCoreReasonCodes.hypothesisNoActive)
  ) {
    return "NO_ACTIVE";
  }

  if (
    source === featureReasonCodes.insufficientBars ||
    source === miCoreReasonCodes.reconstructionInsufficientBars ||
    reasonCodes.includes(featureReasonCodes.insufficientBars) ||
    reasonCodes.includes(miCoreReasonCodes.reconstructionInsufficientBars)
  ) {
    return "INSUFFICIENT_BARS";
  }

  if (
    input.tradingPermission === "ALLOW_TRADING" &&
    (input.opportunityAuthorized ||
      source === miCoreReasonCodes.cdeConvictionAllowTrading ||
      source === cdeReasonCodes.convictionAllowTrading)
  ) {
    return "ALLOW_TRADING";
  }

  if (
    input.tradingPermission === "ALLOW_REDUCED_RISK" &&
    (input.opportunityAuthorized ||
      source === miCoreReasonCodes.cdeConvictionAllowReducedRisk ||
      source === cdeReasonCodes.convictionAllowReducedRisk)
  ) {
    return "ALLOW_REDUCED_RISK";
  }

  if (
    !input.activeHypothesisType &&
    (source === miCoreReasonCodes.hypothesisNoActive ||
      reasonCodes.includes(miCoreReasonCodes.hypothesisNoActive))
  ) {
    return "NO_HYPOTHESIS";
  }

  if (
    source === miCoreReasonCodes.opportunityNotAuthorized ||
    source === strategyReasonCodes.permissionBlocked ||
    source === cdeReasonCodes.understandingNoTrade ||
    source === cdeReasonCodes.understandingWait ||
    source === cdeReasonCodes.understandingPreserveCapital ||
    input.opportunityAuthorized === false
  ) {
    return "NO_TRADE";
  }

  if (!input.activeHypothesisType) {
    return "NO_HYPOTHESIS";
  }

  return "NO_TRADE";
}
