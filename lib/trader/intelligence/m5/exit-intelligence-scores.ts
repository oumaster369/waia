import { exitReasonCodes } from "@/lib/trader/exits/exit-reason-codes";
import { guardianReasonCodes } from "@/lib/trader/guardian/guardian-reason-codes";
import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";
import type {
  ExitIntelligenceLayerSummary,
  ExitIntelligenceRegimeContext,
  ExitIntelligenceScores,
} from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import type { MsvEnvelope, Regime } from "@/lib/trader/intelligence/types";
import {
  compareDecimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

const SCORE_SCALE = 10000n;

function clampScore(value: string): string {
  if (compareDecimal(value, "0") < 0) {
    return "0";
  }
  if (compareDecimal(value, "1") > 0) {
    return "1";
  }
  return value;
}

function scoreFromRatio(numerator: string, denominator: string): string {
  if (compareDecimal(denominator, "0") <= 0) {
    return "0";
  }
  return clampScore(divideDecimal(numerator, denominator));
}

function maxScore(a: string, b: string): string {
  return compareDecimal(a, b) >= 0 ? a : b;
}

function proximityPressure(reason: GuardianReasonRecord): string {
  const levels = reason.slTpLevels;
  if (!levels) {
    return "0";
  }

  const stopDistance = subtractDecimal(reason.markPrice, levels.stopLossPrice);
  const stopSpan = subtractDecimal(levels.takeProfitPrice, levels.stopLossPrice);
  if (compareDecimal(stopSpan, "0") <= 0) {
    return "0";
  }

  const distanceAboveStop = compareDecimal(stopDistance, "0") < 0 ? "0" : stopDistance;
  const proximity = subtractDecimal("1", scoreFromRatio(distanceAboveStop, stopSpan));
  return clampScore(proximity);
}

function eventRiskPressure(msv: MsvEnvelope): string {
  return clampScore(msv.futureContext.eventRiskScore);
}

function regimeShiftPressure(regimeContext: ExitIntelligenceRegimeContext): string {
  return regimeContext.regimeChanged ? "0.35" : "0";
}

export function computeExitPressureScore(input: {
  reason: GuardianReasonRecord;
  msv: MsvEnvelope;
  regimeContext: ExitIntelligenceRegimeContext;
}): string {
  if (input.reason.decision === "EXIT_FULL") {
    return "1";
  }

  const proximity = proximityPressure(input.reason);
  const eventRisk = eventRiskPressure(input.msv);
  const regimeShift = regimeShiftPressure(input.regimeContext);

  return clampScore(maxScore(proximity, maxScore(multiplyDecimal(eventRisk, "0.5"), regimeShift)));
}

function permissionAlignment(reason: GuardianReasonRecord): string {
  const permission = reason.tradingPermission;
  if (permission === "ONLY_CLOSE_POSITIONS" || permission === "STOP_TRADING") {
    return reason.decision === "EXIT_FULL" ? "1" : "0.2";
  }
  if (permission === "PAPER_ONLY") {
    return reason.decision === "HOLD" ? "0.6" : "0.8";
  }
  return reason.decision === "HOLD" ? "0.85" : "1";
}

function reasonCodeAlignment(reason: GuardianReasonRecord): string {
  switch (reason.reasonCode) {
    case guardianReasonCodes.closeOnlyPermission:
    case guardianReasonCodes.stopTradingFlat:
    case guardianReasonCodes.strategyDisallowed:
    case guardianReasonCodes.maxHoldBars:
      return reason.decision === "EXIT_FULL" ? "1" : "0";
    case exitReasonCodes.stopLossHit:
    case exitReasonCodes.takeProfitHit:
    case exitReasonCodes.trailingStopHit:
      return reason.decision === "EXIT_FULL" ? "1" : "0";
    case guardianReasonCodes.hold:
      return reason.decision === "HOLD" ? "0.9" : "0.1";
    default:
      return "0.5";
  }
}

export function computeRiskAlignmentScore(input: { reason: GuardianReasonRecord }): string {
  const permissionScore = permissionAlignment(input.reason);
  const reasonScore = reasonCodeAlignment(input.reason);
  return clampScore(
    formatDecimal(
      (parseDecimal(permissionScore) * 6n + parseDecimal(reasonScore) * 4n) / SCORE_SCALE,
    ),
  );
}

export function computeConflictScore(input: {
  reason: GuardianReasonRecord;
  layerSummary: ExitIntelligenceLayerSummary;
  regimeContext: ExitIntelligenceRegimeContext;
  riskAlignmentScore: string;
}): string {
  let score = subtractDecimal("1", input.riskAlignmentScore);

  if (
    input.reason.decision === "HOLD" &&
    input.layerSummary.markToStopLossDistanceUsdt !== null &&
    compareDecimal(input.layerSummary.markToStopLossDistanceUsdt, "0") >= 0
  ) {
    const levels = input.reason.slTpLevels;
    if (levels) {
      const span = subtractDecimal(levels.takeProfitPrice, levels.stopLossPrice);
      const tightness = scoreFromRatio(
        subtractDecimal(span, input.layerSummary.markToStopLossDistanceUsdt),
        span,
      );
      score = maxScore(score, multiplyDecimal(tightness, "0.7"));
    }
  }

  if (input.regimeContext.regimeChanged && input.reason.decision === "HOLD") {
    score = maxScore(score, "0.45");
  }

  if (input.regimeContext.tradingPermission === "PAPER_ONLY" && input.reason.decision === "HOLD") {
    score = maxScore(score, "0.25");
  }

  return clampScore(score);
}

export function computeAnalyticalScores(input: {
  reason: GuardianReasonRecord;
  msv: MsvEnvelope;
  regimeContext: ExitIntelligenceRegimeContext;
  layerSummary: ExitIntelligenceLayerSummary;
}): ExitIntelligenceScores {
  const riskAlignmentScore = computeRiskAlignmentScore({ reason: input.reason });
  const exitPressureScore = computeExitPressureScore({
    reason: input.reason,
    msv: input.msv,
    regimeContext: input.regimeContext,
  });
  const conflictScore = computeConflictScore({
    reason: input.reason,
    layerSummary: input.layerSummary,
    regimeContext: input.regimeContext,
    riskAlignmentScore,
  });

  return {
    exitPressureScore,
    riskAlignmentScore,
    conflictScore,
  };
}

export function summarizeLayerState(reason: GuardianReasonRecord): ExitIntelligenceLayerSummary {
  const levels = reason.slTpLevels;
  const m4Codes = new Set<string>([
    exitReasonCodes.stopLossHit,
    exitReasonCodes.takeProfitHit,
    exitReasonCodes.trailingStopHit,
  ]);

  let markToStopLossDistanceUsdt: string | null = null;
  let markToTakeProfitDistanceUsdt: string | null = null;

  if (levels) {
    markToStopLossDistanceUsdt = subtractDecimal(reason.markPrice, levels.stopLossPrice);
    markToTakeProfitDistanceUsdt = subtractDecimal(levels.takeProfitPrice, reason.markPrice);
  }

  return {
    structuralExitTriggered: reason.decision === "EXIT_FULL",
    m4PriceExitRuleId: m4Codes.has(reason.reasonCode) ? reason.ruleId : null,
    markToStopLossDistanceUsdt,
    markToTakeProfitDistanceUsdt,
    trailingPhase: levels?.trailingPhase ?? null,
  };
}

export function buildRegimeContext(input: {
  reason: GuardianReasonRecord;
  msv: MsvEnvelope;
  openingRegime: Regime | null;
}): ExitIntelligenceRegimeContext {
  return {
    currentRegime: input.reason.regime,
    openingRegime: input.openingRegime,
    regimeChanged: input.openingRegime !== null && input.openingRegime !== input.reason.regime,
    tradingPermission: input.reason.tradingPermission,
    msvReasonCodes: input.msv.derived.reasonCodes,
    eventRiskScore: input.msv.futureContext.eventRiskScore,
  };
}

export function collectStrategySignalRefs(input: {
  symbol: string;
  strategyId: string;
  signals: readonly { strategySignalId: string; symbol: string; strategyId: string }[];
}): readonly string[] {
  return input.signals
    .filter((signal) => signal.symbol === input.symbol && signal.strategyId === input.strategyId)
    .map((signal) => signal.strategySignalId)
    .sort();
}
