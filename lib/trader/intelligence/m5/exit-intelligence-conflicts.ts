import { exitReasonCodes } from "@/lib/trader/exits/exit-reason-codes";
import { guardianReasonCodes } from "@/lib/trader/guardian/guardian-reason-codes";
import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";
import type {
  ExitIntelligenceConflictAnalysis,
  ExitIntelligenceLayerSummary,
  ExitIntelligenceRegimeContext,
} from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import type { ExitIntelligenceScores } from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

export const exitIntelligenceConflictTags = {
  guardianExitMatchesM4Rule: "guardian_exit_matches_m4_rule",
  permissionRequiresCloseAndGuardianExits: "permission_requires_close_and_guardian_exits",
  structuralExitMatchesReasonCode: "structural_exit_matches_reason_code",
  guardianHoldWithTightSlProximity: "guardian_hold_with_tight_sl_proximity",
  regimeShiftWithoutStructuralExit: "regime_shift_without_structural_exit",
  msvPaperOnlyWhilePositionOpen: "msv_paper_only_while_position_open",
  layersCoherentOnHold: "layers_coherent_on_hold",
} as const;

export function detectCrossLayerConflicts(input: {
  reason: GuardianReasonRecord;
  layerSummary: ExitIntelligenceLayerSummary;
  regimeContext: ExitIntelligenceRegimeContext;
}): ExitIntelligenceConflictAnalysis {
  const aligned: string[] = [];
  const conflicting: string[] = [];

  const m4Codes = new Set<string>([
    exitReasonCodes.stopLossHit,
    exitReasonCodes.takeProfitHit,
    exitReasonCodes.trailingStopHit,
  ]);

  if (input.reason.decision === "EXIT_FULL" && m4Codes.has(input.reason.reasonCode)) {
    aligned.push(exitIntelligenceConflictTags.guardianExitMatchesM4Rule);
  }

  if (
    (input.reason.tradingPermission === "ONLY_CLOSE_POSITIONS" ||
      input.reason.tradingPermission === "STOP_TRADING") &&
    input.reason.decision === "EXIT_FULL"
  ) {
    aligned.push(exitIntelligenceConflictTags.permissionRequiresCloseAndGuardianExits);
  }

  if (
    input.reason.decision === "EXIT_FULL" &&
    input.reason.reasonCode !== guardianReasonCodes.hold
  ) {
    aligned.push(exitIntelligenceConflictTags.structuralExitMatchesReasonCode);
  }

  if (input.reason.decision === "HOLD") {
    aligned.push(exitIntelligenceConflictTags.layersCoherentOnHold);
  }

  if (
    input.reason.decision === "HOLD" &&
    input.layerSummary.markToStopLossDistanceUsdt !== null &&
    input.reason.slTpLevels &&
    compareDecimal(
      input.layerSummary.markToStopLossDistanceUsdt,
      input.reason.slTpLevels.atrUsdt,
    ) <= 0
  ) {
    conflicting.push(exitIntelligenceConflictTags.guardianHoldWithTightSlProximity);
  }

  if (input.regimeContext.regimeChanged && input.reason.decision === "HOLD") {
    conflicting.push(exitIntelligenceConflictTags.regimeShiftWithoutStructuralExit);
  }

  if (input.regimeContext.tradingPermission === "PAPER_ONLY" && input.reason.decision === "HOLD") {
    conflicting.push(exitIntelligenceConflictTags.msvPaperOnlyWhilePositionOpen);
  }

  return {
    aligned: [...aligned].sort(),
    conflicting: [...conflicting].sort(),
  };
}

export function buildExplanation(input: {
  reason: GuardianReasonRecord;
  scores: ExitIntelligenceScores;
  conflictAnalysis: ExitIntelligenceConflictAnalysis;
}): string {
  const aligned = input.conflictAnalysis.aligned.join(", ") || "none";
  const conflicting = input.conflictAnalysis.conflicting.join(", ") || "none";

  return [
    `exitPressure=${input.scores.exitPressureScore}`,
    `riskAlignment=${input.scores.riskAlignmentScore}`,
    `conflict=${input.scores.conflictScore}`,
    `guardian=${input.reason.decision}:${input.reason.reasonCode}`,
    `aligned=${aligned}`,
    `conflicting=${conflicting}`,
  ].join("; ");
}
