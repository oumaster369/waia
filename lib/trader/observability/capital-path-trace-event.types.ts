import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const CAPITAL_PATH_TRACE_EVENT_SCHEMA_VERSION = "capital-path-trace-event/v1" as const;

export const CAPITAL_PATH_TRACE_INDEX_SCHEMA_VERSION = "capital-path-trace-index/v1" as const;

export const CAPITAL_PATH_STAGES = [
  "BAR_INGRESS",
  "INTELLIGENCE",
  "CDE_PERMISSION",
  "DECISION",
  "RISK_EVALUATION",
  "ORDER_SUBMIT",
  "ORDER_FILL",
  "POSITION_OPEN",
  "GUARDIAN_CYCLE",
  "EXIT_DECISION",
  "EXIT_ORDER",
  "EXIT_FILL",
  "RECONCILIATION",
  "CLOSED_TRADE",
  "PNL_RECORD",
  "TERMINAL_REPORT",
  "NO_TRADE",
  "RISK_REJECTION",
  "DATA_TRUTH_REJECTION",
  "DRAWDOWN_DOMAIN",
  "PARTIAL_FILL",
  "BREACH_CANCELLATION",
  "CHECKPOINT",
  "IDEMPOTENCY",
  "INTERVAL_BOUNDARY",
] as const;

export type CapitalPathStage = (typeof CAPITAL_PATH_STAGES)[number];

export type CapitalPathTraceNullableReason =
  | "NOT_APPLICABLE_STAGE"
  | "NO_ECONOMIC_MUTATION"
  | "OBSERVATION_ONLY"
  | "PRE_INTELLIGENCE_TERMINAL";

export type CapitalPathTraceEconomicEffect = Readonly<{
  cashDelta: string | null;
  cashDeltaReason: CapitalPathTraceNullableReason | null;
  exposureDelta: string | null;
  exposureDeltaReason: CapitalPathTraceNullableReason | null;
  realizedPnlDelta: string | null;
  realizedPnlDeltaReason: CapitalPathTraceNullableReason | null;
}>;

export type CapitalPathTracePersistentRecordReferences = Readonly<{
  orderId: string | null;
  fillId: string | null;
  riskDecisionId: string | null;
  reconciliationId: string | null;
  closedTradeId: string | null;
  checkpointId: string | null;
  decisionRecordId: string | null;
}>;

export type CapitalPathTraceAssertedInvariants = Readonly<{
  codes: readonly string[];
  allSatisfied: boolean;
}>;

export type CapitalPathTraceEventV1 = Readonly<{
  schemaVersion: typeof CAPITAL_PATH_TRACE_EVENT_SCHEMA_VERSION;
  traceId: string;
  sequenceNumber: number;
  replayTimestamp: string;
  capitalPathStage: CapitalPathStage;
  repositoryPath: string;
  symbol: string | null;
  caller: string;
  callee: string;
  inputDigest: string;
  outputDigest: string;
  stateBeforeDigest: string;
  stateAfterDigest: string;
  decisionOrReasonCode: string | null;
  economicEffect: CapitalPathTraceEconomicEffect;
  persistentRecordReferences: CapitalPathTracePersistentRecordReferences;
  assertedInvariants: CapitalPathTraceAssertedInvariants;
}>;

export type CapitalPathTraceIndexEntryV1 = Readonly<{
  traceId: string;
  scenario: string;
  eventCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  terminalReason: string;
  startingCash: string;
  endingCash: string;
  terminalPosition: string;
  grossPnl: string;
  netPnl: string;
  fees: string;
  spreadCost: string;
  marketImpactCost: string;
  semanticDigest: string;
  result: "PASS" | "FAIL";
  failedInvariants: readonly string[];
}>;

export type CapitalPathTraceIndexV1 = Readonly<{
  schemaVersion: typeof CAPITAL_PATH_TRACE_INDEX_SCHEMA_VERSION;
  traceExpected: number;
  traceObserved: number;
  tracePassed: number;
  traceFailed: number;
  traceSkipped: number;
  uniqueTraceIds: number;
  duplicateTraceIds: number;
  trace02GuardianStopObserved: boolean;
  trace03CanonicalAbstentionObserved: boolean;
  trace04ExactRiskReasonObserved: boolean;
  drawdownVariantsExpected: number;
  drawdownVariantsObserved: number;
  drawdownVariantsPassed: number;
  drawdownVariantsFailed: number;
  trace08CapitalPathDuplicateSuppressed: boolean;
  trace09RunnerIngressRejected: boolean;
  perEventStateDigestsValid: boolean;
  fullEconomicNonInterference: boolean;
  indexDigest: string;
  entries: readonly CapitalPathTraceIndexEntryV1[];
}>;

export const CAPITAL_PATH_TRACE_EVENT_REQUIRED_KEYS = [
  "schemaVersion",
  "traceId",
  "sequenceNumber",
  "replayTimestamp",
  "capitalPathStage",
  "repositoryPath",
  "symbol",
  "caller",
  "callee",
  "inputDigest",
  "outputDigest",
  "stateBeforeDigest",
  "stateAfterDigest",
  "decisionOrReasonCode",
  "economicEffect",
  "persistentRecordReferences",
  "assertedInvariants",
] as const;

const FORBIDDEN_ABSOLUTE_PATH = /^(\/|[A-Za-z]:\\)/;

export function assertCapitalPathTraceEventV1(
  value: unknown,
): asserts value is CapitalPathTraceEventV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("CAPITAL_PATH_TRACE:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  for (const key of CAPITAL_PATH_TRACE_EVENT_REQUIRED_KEYS) {
    if (!(key in record)) {
      throw new Error(`CAPITAL_PATH_TRACE:MISSING_KEY:${key}`);
    }
  }
  if (record.schemaVersion !== CAPITAL_PATH_TRACE_EVENT_SCHEMA_VERSION) {
    throw new Error("CAPITAL_PATH_TRACE:SCHEMA_VERSION_MISMATCH");
  }
  if (
    typeof record.sequenceNumber !== "number" ||
    !Number.isInteger(record.sequenceNumber) ||
    record.sequenceNumber < 0
  ) {
    throw new Error("CAPITAL_PATH_TRACE:SEQUENCE_INVALID");
  }
  if (
    typeof record.repositoryPath !== "string" ||
    FORBIDDEN_ABSOLUTE_PATH.test(record.repositoryPath)
  ) {
    throw new Error("CAPITAL_PATH_TRACE:ABSOLUTE_REPOSITORY_PATH");
  }
  if (!CAPITAL_PATH_STAGES.includes(record.capitalPathStage as CapitalPathStage)) {
    throw new Error("CAPITAL_PATH_TRACE:UNKNOWN_STAGE");
  }
}

export function computeCapitalPathTraceCheckpointComparableDigest(
  events: readonly CapitalPathTraceEventV1[],
): string {
  return computeSemanticSha256Hex(
    events
      .filter((event) => event.capitalPathStage !== "CHECKPOINT")
      .map((event) => ({
        traceId: event.traceId,
        sequenceNumber: event.sequenceNumber,
        replayTimestamp: event.replayTimestamp,
        capitalPathStage: event.capitalPathStage,
        repositoryPath: event.repositoryPath,
        inputDigest: event.inputDigest,
        outputDigest: event.outputDigest,
        decisionOrReasonCode: event.decisionOrReasonCode,
        economicEffect: event.economicEffect,
      })),
  );
}

export function computeCapitalPathTraceSemanticDigest(
  events: readonly CapitalPathTraceEventV1[],
): string {
  return computeSemanticSha256Hex(
    events.map((event) => ({
      traceId: event.traceId,
      sequenceNumber: event.sequenceNumber,
      replayTimestamp: event.replayTimestamp,
      capitalPathStage: event.capitalPathStage,
      repositoryPath: event.repositoryPath,
      inputDigest: event.inputDigest,
      outputDigest: event.outputDigest,
      stateBeforeDigest: event.stateBeforeDigest,
      stateAfterDigest: event.stateAfterDigest,
      decisionOrReasonCode: event.decisionOrReasonCode,
      economicEffect: event.economicEffect,
    })),
  );
}

export function computeCapitalPathTraceIndexDigest(
  index: Omit<CapitalPathTraceIndexV1, "indexDigest">,
): string {
  return computeSemanticSha256Hex(index);
}

export function assertCapitalPathTraceStateDigestContinuity(
  events: readonly CapitalPathTraceEventV1[],
): boolean {
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (current.stateBeforeDigest !== previous.stateAfterDigest) {
      return false;
    }
  }
  return true;
}
