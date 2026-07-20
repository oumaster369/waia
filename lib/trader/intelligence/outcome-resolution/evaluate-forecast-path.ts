import { compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { OutcomeResolutionVerdict } from "@/lib/trader/knowledge/mkb-read-model.types";
import {
  OutcomeResolutionEarlyResolutionError,
  OutcomeResolutionLookaheadError,
} from "@/lib/trader/intelligence/outcome-resolution/errors";
import type { ForecastOutcomeClass } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";

const NEUTRAL_THRESHOLD_BPS = 5;

export type ExpectedPathDirection = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";

export type PathEvaluationResult = Readonly<{
  outcomeClass: ForecastOutcomeClass;
  outcomeVerdict: OutcomeResolutionVerdict | null;
  invalidationFired: boolean;
  dataIntegrityFailure: boolean;
  netMove: string | null;
  startClose: string | null;
  endClose: string | null;
}>;

function parseJsonArray(raw: string): readonly string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseScenarioExpectedPath(scenarioSetJson: string): string {
  try {
    const parsed = JSON.parse(scenarioSetJson) as { expected_path?: string };
    return parsed.expected_path ?? "no_clear_path";
  } catch {
    return "no_clear_path";
  }
}

export function classifyExpectedPathDirection(expectedPath: string): ExpectedPathDirection {
  if (
    expectedPath.includes("higher") ||
    expectedPath.includes("extension") ||
    expectedPath.includes("accumulation")
  ) {
    return "BULLISH";
  }
  if (
    expectedPath.includes("lower") ||
    expectedPath.includes("distribution") ||
    expectedPath.includes("top")
  ) {
    return "BEARISH";
  }
  if (expectedPath === "no_clear_path") {
    return "NEUTRAL";
  }
  if (
    expectedPath.includes("revert") ||
    expectedPath.includes("fade") ||
    expectedPath.includes("reversal") ||
    expectedPath.includes("sweep")
  ) {
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

function barsWithinPitWindow(input: {
  bars: readonly Bar[];
  eligibleResolutionAt: string;
  asOf: string;
  evidenceCutoffAt: string;
}): readonly Bar[] {
  const eligibleMs = new Date(input.eligibleResolutionAt).getTime();
  const asOfMs = new Date(input.asOf).getTime();
  const cutoffMs = new Date(input.evidenceCutoffAt).getTime();

  if (asOfMs < eligibleMs) {
    throw new OutcomeResolutionEarlyResolutionError(
      `resolution attempted before eligibleResolutionAt (${input.eligibleResolutionAt})`,
    );
  }

  return input.bars.filter((bar) => {
    const closeMs = new Date(bar.barCloseTime).getTime();
    if (closeMs > asOfMs || closeMs > cutoffMs) {
      return false;
    }
    return closeMs >= eligibleMs;
  });
}

function detectDataIntegrityGap(input: {
  bars: readonly Bar[];
  eligibleResolutionAt: string;
  asOf: string;
}): boolean {
  const eligibleMs = new Date(input.eligibleResolutionAt).getTime();
  const asOfMs = new Date(input.asOf).getTime();
  const expectedBarCount = Math.max(0, Math.floor((asOfMs - eligibleMs) / 60_000));
  if (expectedBarCount === 0) {
    return false;
  }
  const pitBars = input.bars.filter((bar) => {
    const closeMs = new Date(bar.barCloseTime).getTime();
    return closeMs >= eligibleMs && closeMs <= asOfMs;
  });
  return (
    pitBars.length < Math.min(1, expectedBarCount) && pitBars.length === 0 && expectedBarCount > 0
  );
}

function evaluateInvalidationConditions(input: {
  invalidationConditionsJson: string;
  bars: readonly Bar[];
  issuedAt: string;
  eligibleResolutionAt: string;
}): boolean {
  const conditions = parseJsonArray(input.invalidationConditionsJson);
  if (conditions.length === 0) {
    return false;
  }

  const issuedMs = new Date(input.issuedAt).getTime();
  const horizonEndMs = new Date(input.eligibleResolutionAt).getTime();
  const windowBars = input.bars.filter((bar) => {
    const closeMs = new Date(bar.barCloseTime).getTime();
    return closeMs >= issuedMs && closeMs <= horizonEndMs;
  });

  if (windowBars.length < 2) {
    return false;
  }

  const startClose = windowBars[0]!.close;
  const endClose = windowBars.at(-1)!.close;
  const move = subtractDecimal(endClose, startClose);

  for (const condition of conditions) {
    const normalized = condition.toLowerCase();
    if (normalized.includes("below") && compareDecimal(endClose, startClose) < 0) {
      return true;
    }
    if (normalized.includes("above") && compareDecimal(endClose, startClose) > 0) {
      return true;
    }
    if (normalized.includes("invalidate") && compareDecimal(move, "0") !== 0) {
      return true;
    }
  }

  return false;
}

function isNeutralMove(netMove: string): boolean {
  const threshold = (NEUTRAL_THRESHOLD_BPS / 10_000).toString();
  const negThreshold = subtractDecimal("0", threshold);
  return compareDecimal(netMove, negThreshold) >= 0 && compareDecimal(netMove, threshold) <= 0;
}

function directionFromMove(netMove: string): "UP" | "DOWN" | "FLAT" {
  if (isNeutralMove(netMove)) {
    return "FLAT";
  }
  return compareDecimal(netMove, "0") > 0 ? "UP" : "DOWN";
}

export function evaluateForecastPath(input: {
  scenarioSetJson: string;
  invalidationConditionsJson: string;
  issuedAt: string;
  eligibleResolutionAt: string;
  evidenceCutoffAt: string;
  asOf: string;
  bars: readonly Bar[];
}): PathEvaluationResult {
  const asOfMs = new Date(input.asOf).getTime();
  const cutoffMs = new Date(input.evidenceCutoffAt).getTime();
  if (asOfMs > cutoffMs) {
    throw new OutcomeResolutionLookaheadError("asOf exceeds PIT evidence cutoff");
  }

  for (const bar of input.bars) {
    const closeMs = new Date(bar.barCloseTime).getTime();
    if (closeMs > asOfMs) {
      throw new OutcomeResolutionLookaheadError("future bar in PIT window");
    }
  }

  if (detectDataIntegrityGap(input)) {
    return {
      outcomeClass: "UNRESOLVED_DUE_TO_DATA_INTEGRITY",
      outcomeVerdict: null,
      invalidationFired: false,
      dataIntegrityFailure: true,
      netMove: null,
      startClose: null,
      endClose: null,
    };
  }

  if (
    evaluateInvalidationConditions({
      invalidationConditionsJson: input.invalidationConditionsJson,
      bars: input.bars,
      issuedAt: input.issuedAt,
      eligibleResolutionAt: input.eligibleResolutionAt,
    })
  ) {
    return {
      outcomeClass: "INVALIDATED",
      outcomeVerdict: null,
      invalidationFired: true,
      dataIntegrityFailure: false,
      netMove: null,
      startClose: null,
      endClose: null,
    };
  }

  const pitBars = barsWithinPitWindow({
    bars: input.bars,
    eligibleResolutionAt: input.eligibleResolutionAt,
    asOf: input.asOf,
    evidenceCutoffAt: input.evidenceCutoffAt,
  });

  if (pitBars.length === 0) {
    return {
      outcomeClass: "UNRESOLVED_DUE_TO_DATA_INTEGRITY",
      outcomeVerdict: null,
      invalidationFired: false,
      dataIntegrityFailure: true,
      netMove: null,
      startClose: null,
      endClose: null,
    };
  }

  const startClose = pitBars[0]!.close;
  const endClose = pitBars.at(-1)!.close;
  const netMove = subtractDecimal(endClose, startClose);
  const expectedPath = parseScenarioExpectedPath(input.scenarioSetJson);
  const directionClaim = classifyExpectedPathDirection(expectedPath);
  const realized = directionFromMove(netMove);

  if (directionClaim === "NEUTRAL" || directionClaim === "UNKNOWN") {
    return {
      outcomeClass: "EXPIRED",
      outcomeVerdict: null,
      invalidationFired: false,
      dataIntegrityFailure: false,
      netMove,
      startClose,
      endClose,
    };
  }

  if (realized === "FLAT") {
    return {
      outcomeClass: "EXPIRED",
      outcomeVerdict: null,
      invalidationFired: false,
      dataIntegrityFailure: false,
      netMove,
      startClose,
      endClose,
    };
  }

  const bullishCorrect = directionClaim === "BULLISH" && realized === "UP";
  const bearishCorrect = directionClaim === "BEARISH" && realized === "DOWN";
  const verdict: OutcomeResolutionVerdict =
    bullishCorrect || bearishCorrect ? "CORRECT" : "INCORRECT";

  return {
    outcomeClass: "RESOLVED",
    outcomeVerdict: verdict,
    invalidationFired: false,
    dataIntegrityFailure: false,
    netMove,
    startClose,
    endClose,
  };
}

export function extractHorizonFromForecast(
  targetWindowEndAt: string,
  targetWindowStartAt: string,
): string {
  const startMs = new Date(targetWindowStartAt).getTime();
  const endMs = new Date(targetWindowEndAt).getTime();
  const durationMs = Math.max(0, endMs - startMs);
  if (durationMs <= 3_600_000) {
    return "1h";
  }
  if (durationMs <= 14_400_000) {
    return "4h";
  }
  return `${durationMs}ms`;
}

export function extractRegimeFromDecision(
  cdeMsvPermissionSnapshotJson: string | null | undefined,
): string {
  if (!cdeMsvPermissionSnapshotJson) {
    return "UNKNOWN";
  }
  try {
    const parsed = JSON.parse(cdeMsvPermissionSnapshotJson) as { regime?: string };
    return parsed.regime ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}
