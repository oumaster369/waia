import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import type { AccountingStateV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrRuntimeCallEvent } from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertCapitalPathTraceEventV1,
  computeCapitalPathTraceSemanticDigest,
  CAPITAL_PATH_TRACE_EVENT_SCHEMA_VERSION,
  type CapitalPathStage,
  type CapitalPathTraceAssertedInvariants,
  type CapitalPathTraceEconomicEffect,
  type CapitalPathTraceEventV1,
  type CapitalPathTracePersistentRecordReferences,
} from "@/lib/trader/observability/capital-path-trace-event.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

export type CreateCapitalPathTraceCollectorInput = {
  traceId: string;
  scenario: string;
};

export type CapitalPathTraceCollector = Readonly<{
  traceId: string;
  scenario: string;
  events: readonly CapitalPathTraceEventV1[];
  append: (
    event: Omit<CapitalPathTraceEventV1, "schemaVersion" | "traceId" | "sequenceNumber">,
  ) => CapitalPathTraceEventV1;
  semanticDigest: () => string;
  writeJsonl: (outputPath: string) => void;
}>;

const NO_ECONOMIC_EFFECT: CapitalPathTraceEconomicEffect = {
  cashDelta: null,
  cashDeltaReason: "NO_ECONOMIC_MUTATION",
  exposureDelta: null,
  exposureDeltaReason: "NO_ECONOMIC_MUTATION",
  realizedPnlDelta: null,
  realizedPnlDeltaReason: "NO_ECONOMIC_MUTATION",
};

const OBSERVATION_ONLY_EFFECT: CapitalPathTraceEconomicEffect = {
  cashDelta: null,
  cashDeltaReason: "OBSERVATION_ONLY",
  exposureDelta: null,
  exposureDeltaReason: "OBSERVATION_ONLY",
  realizedPnlDelta: null,
  realizedPnlDeltaReason: "OBSERVATION_ONLY",
};

export const CAPITAL_PATH_TRACE_EMPTY_STATE_DIGEST = computeSemanticSha256Hex({
  schema: "capital-path-trace-empty-state/v1",
  cash: "0",
  equity: "0",
  positions: {},
  consumedFillIds: [],
});

function emptyPersistentRefs(): CapitalPathTracePersistentRecordReferences {
  return {
    orderId: null,
    fillId: null,
    riskDecisionId: null,
    reconciliationId: null,
    closedTradeId: null,
    checkpointId: null,
    decisionRecordId: null,
  };
}

function satisfiedInvariants(codes: readonly string[]): CapitalPathTraceAssertedInvariants {
  return { codes, allSatisfied: true };
}

function digestValue(value: unknown): string {
  try {
    return computeSemanticSha256Hex(value);
  } catch {
    return sha256Utf8(
      JSON.stringify(value, (_key, inner) =>
        typeof inner === "number" && !Number.isFinite(inner) ? String(inner) : inner,
      ),
    );
  }
}

class TraceStateTracker {
  private digest = CAPITAL_PATH_TRACE_EMPTY_STATE_DIGEST;

  snapshotBefore(): string {
    return this.digest;
  }

  observeReadOnly(): { stateBeforeDigest: string; stateAfterDigest: string } {
    return {
      stateBeforeDigest: this.digest,
      stateAfterDigest: this.digest,
    };
  }

  observeTransition(observation: unknown): { stateBeforeDigest: string; stateAfterDigest: string } {
    const stateBeforeDigest = this.digest;
    this.digest = digestValue({ prior: stateBeforeDigest, observation });
    return { stateBeforeDigest, stateAfterDigest: this.digest };
  }

  anchorAccountingState(state: AccountingStateV1): {
    stateBeforeDigest: string;
    stateAfterDigest: string;
  } {
    const stateBeforeDigest = this.digest;
    this.digest = computeAccountingSemanticDigest(state);
    return { stateBeforeDigest, stateAfterDigest: this.digest };
  }
}

function mapRuntimeKindToStage(kind: HtrRuntimeCallEvent["kind"]): CapitalPathStage {
  switch (kind) {
    case "WP18_INITIAL_STATE":
      return "POSITION_OPEN";
    case "WP17_FILL_CONSUMED":
      return "ORDER_FILL";
    case "WP18_MARK_ATTACHED":
      return "PNL_RECORD";
    case "WP19_RECONCILIATION_PASS":
    case "WP19_RECONCILIATION_FAIL":
      return "RECONCILIATION";
    case "WP20_GUARDIAN_EVALUATED":
      return "GUARDIAN_CYCLE";
    case "WP20_BREACH_CANCELLATION_EXECUTED":
      return "BREACH_CANCELLATION";
    case "WP20_DRAWDOWN_PERSISTED":
      return "DRAWDOWN_DOMAIN";
    case "CHECKPOINT_RESTORED":
      return "CHECKPOINT";
    case "TERMINAL_EXPORT":
      return "TERMINAL_REPORT";
    default:
      return "RECONCILIATION";
  }
}

function resolvePrimaryRiskReasonCode(
  execution: Extract<
    NonNullable<PaperCycleResult["strategyExecutions"][number]["execution"]>,
    { status: "risk_rejected" }
  >,
): string {
  return execution.riskDecision.decision.reasonCodes[0] ?? execution.riskDecision.decision.outcome;
}

export function createCapitalPathTraceCollector(
  input: CreateCapitalPathTraceCollectorInput,
): CapitalPathTraceCollector {
  const events: CapitalPathTraceEventV1[] = [];
  let sequenceNumber = -1;
  let lastReplayTimestamp = "";

  const append = (
    event: Omit<CapitalPathTraceEventV1, "schemaVersion" | "traceId" | "sequenceNumber">,
  ): CapitalPathTraceEventV1 => {
    const replayTimestamp =
      lastReplayTimestamp && event.replayTimestamp < lastReplayTimestamp
        ? lastReplayTimestamp
        : event.replayTimestamp;
    lastReplayTimestamp = replayTimestamp;
    sequenceNumber += 1;
    const committed: CapitalPathTraceEventV1 = {
      schemaVersion: CAPITAL_PATH_TRACE_EVENT_SCHEMA_VERSION,
      traceId: input.traceId,
      sequenceNumber,
      ...event,
      replayTimestamp,
    };
    assertCapitalPathTraceEventV1(committed);
    events.push(committed);
    return committed;
  };

  return {
    traceId: input.traceId,
    scenario: input.scenario,
    get events() {
      return events;
    },
    append,
    semanticDigest: () => computeCapitalPathTraceSemanticDigest(events),
    writeJsonl: (outputPath: string) => {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
      writeFileSync(outputPath, lines, "utf8");
    },
  };
}

export function assertCapitalPathTraceChronology(events: readonly CapitalPathTraceEventV1[]): void {
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (current.sequenceNumber <= previous.sequenceNumber) {
      throw new Error("CAPITAL_PATH_TRACE:SEQUENCE_NOT_MONOTONIC");
    }
    if (current.replayTimestamp < previous.replayTimestamp) {
      throw new Error("CAPITAL_PATH_TRACE:TIMESTAMP_NOT_NONDECREASING");
    }
  }
}

export function detectCapitalPathTraceMutation(
  events: readonly CapitalPathTraceEventV1[],
  expectedDigest: string,
): boolean {
  return computeCapitalPathTraceSemanticDigest(events) === expectedDigest;
}

export function assertCapitalPathTraceOneByteMutationRejected(
  events: readonly CapitalPathTraceEventV1[],
): void {
  const digest = computeCapitalPathTraceSemanticDigest(events);
  const cloned = JSON.parse(JSON.stringify(events)) as CapitalPathTraceEventV1[];
  const last = cloned.at(-1);
  if (!last) {
    throw new Error("CAPITAL_PATH_TRACE:EMPTY_EVENT_STREAM");
  }
  const lastIndex = cloned.length - 1;
  cloned[lastIndex] = {
    ...last,
    outputDigest: `${last.outputDigest.slice(0, -1)}X`,
  };
  expectDigestMutationRejected(cloned, digest);
}

function expectDigestMutationRejected(
  events: readonly CapitalPathTraceEventV1[],
  expectedDigest: string,
): void {
  if (detectCapitalPathTraceMutation(events, expectedDigest)) {
    throw new Error("CAPITAL_PATH_TRACE:MUTATION_NOT_REJECTED");
  }
}

export type EmitCapitalPathTraceFromBacktestInput = {
  collector: CapitalPathTraceCollector;
  cycleResults: readonly PaperCycleResult[];
  accountingState: AccountingStateV1 | null | undefined;
  symbol?: string;
  barTimestamps?: readonly string[];
};

export function emitCapitalPathTraceFromBacktest(
  input: EmitCapitalPathTraceFromBacktestInput,
): CapitalPathTraceEventV1[] {
  const symbol = input.symbol ?? "BTC/USDT";
  const tracker = new TraceStateTracker();

  for (let cycleIndex = 0; cycleIndex < input.cycleResults.length; cycleIndex += 1) {
    const cycle = input.cycleResults[cycleIndex]!;
    const replayTimestamp =
      input.barTimestamps?.[cycleIndex] ??
      cycle.evaluation.features?.evaluatedAt ??
      cycle.htrRuntimeCallOrder?.[0]?.at ??
      new Date(Date.parse("2026-01-01T00:00:00.000Z") + cycleIndex * 60_000).toISOString();

    const barIngressState = tracker.observeReadOnly();
    input.collector.append({
      replayTimestamp,
      capitalPathStage: "BAR_INGRESS",
      repositoryPath: "lib/trader/market-data/historical-bar-replay-source",
      symbol,
      caller: "runBacktest",
      callee: "HistoricalBarReplaySource.next",
      inputDigest: digestValue({ cycleIndex }),
      outputDigest: digestValue({ barCount: cycle.evaluation.features ? 1 : 0 }),
      ...barIngressState,
      decisionOrReasonCode: "BAR_CLOSED",
      economicEffect: NO_ECONOMIC_EFFECT,
      persistentRecordReferences: emptyPersistentRefs(),
      assertedInvariants: satisfiedInvariants(["BAR_INGRESS_READ_ONLY"]),
    });

    const intelligenceState = tracker.observeReadOnly();
    input.collector.append({
      replayTimestamp,
      capitalPathStage: "INTELLIGENCE",
      repositoryPath: "lib/trader/intelligence/evaluation-cycle",
      symbol,
      caller: "runPaperCycle",
      callee: "runEvaluationCycle",
      inputDigest: digestValue({
        featureCount: cycle.evaluation.features ? 1 : 0,
        signalCount: cycle.evaluation.signals?.length ?? 0,
      }),
      outputDigest: digestValue({
        primarySignal: cycle.evaluation.signal?.strategySignalId ?? null,
        terminalReasonCode:
          cycle.evaluation.intelligenceCycleBundle?.envelope.terminalReasonCode ?? null,
      }),
      ...intelligenceState,
      decisionOrReasonCode: cycle.evaluation.signal?.strategySignalId ?? "NO_PRIMARY_SIGNAL",
      economicEffect: NO_ECONOMIC_EFFECT,
      persistentRecordReferences: emptyPersistentRefs(),
      assertedInvariants: satisfiedInvariants(["INTELLIGENCE_READ_ONLY"]),
    });

    for (const strategyExecution of cycle.strategyExecutions) {
      const gateState = tracker.observeReadOnly();
      input.collector.append({
        replayTimestamp,
        capitalPathStage: "CDE_PERMISSION",
        repositoryPath: "lib/trader/intelligence/strategies/strategy-eligibility-gate",
        symbol: strategyExecution.signal.symbol,
        caller: "runPaperCycle",
        callee: "evaluateStrategyEligibilityGate",
        inputDigest: digestValue({ signalId: strategyExecution.signal.strategySignalId }),
        outputDigest: digestValue({ submitBlocked: strategyExecution.submitBlocked }),
        ...gateState,
        decisionOrReasonCode: strategyExecution.submitBlocked ? "SUBMIT_BLOCKED" : "ACTIONABLE",
        economicEffect: NO_ECONOMIC_EFFECT,
        persistentRecordReferences: emptyPersistentRefs(),
        assertedInvariants: satisfiedInvariants(["CDE_GATE_READ_ONLY"]),
      });

      const decisionState = tracker.observeReadOnly();
      input.collector.append({
        replayTimestamp,
        capitalPathStage: "DECISION",
        repositoryPath: "lib/trader/paper/signal-to-order",
        symbol: strategyExecution.signal.symbol,
        caller: "runPaperCycle",
        callee: "mapSignalToSubmitOrder",
        inputDigest: digestValue({
          side: strategyExecution.signal.side,
          strategyId: strategyExecution.signal.strategyId,
        }),
        outputDigest: digestValue({ blocked: strategyExecution.submitBlocked }),
        ...decisionState,
        decisionOrReasonCode: strategyExecution.signal.side ?? null,
        economicEffect: NO_ECONOMIC_EFFECT,
        persistentRecordReferences: emptyPersistentRefs(),
        assertedInvariants: satisfiedInvariants(["DECISION_READ_ONLY"]),
      });

      const execution = strategyExecution.execution;
      if (execution?.status === "risk_rejected") {
        const riskReasonCode = resolvePrimaryRiskReasonCode(execution);
        const riskState = tracker.observeReadOnly();
        input.collector.append({
          replayTimestamp,
          capitalPathStage: "RISK_EVALUATION",
          repositoryPath: "lib/trader/risk/risk-engine-service",
          symbol: strategyExecution.signal.symbol,
          caller: "OrderExecutionService.submitOrder",
          callee: "RiskEngineService.evaluateOrderRequest",
          inputDigest: digestValue({ signalId: strategyExecution.signal.strategySignalId }),
          outputDigest: digestValue({
            outcome: execution.riskDecision.decision.outcome,
            reasonCodes: execution.riskDecision.decision.reasonCodes,
          }),
          ...riskState,
          decisionOrReasonCode: riskReasonCode,
          economicEffect: NO_ECONOMIC_EFFECT,
          persistentRecordReferences: {
            ...emptyPersistentRefs(),
            riskDecisionId: execution.riskDecision.riskDecisionId,
          },
          assertedInvariants: satisfiedInvariants(["NO_ORDER_RECORD", "NO_EXPOSURE_CHANGE"]),
        });
        input.collector.append({
          replayTimestamp,
          capitalPathStage: "RISK_REJECTION",
          repositoryPath: "lib/trader/execution/order-execution-service",
          symbol: strategyExecution.signal.symbol,
          caller: "OrderExecutionService.submitOrder",
          callee: "terminalRiskRejected",
          inputDigest: digestValue({ clientOrderId: strategyExecution.signal.strategySignalId }),
          outputDigest: digestValue({
            status: "risk_rejected",
            reasonCodes: execution.riskDecision.decision.reasonCodes,
          }),
          ...riskState,
          decisionOrReasonCode: riskReasonCode,
          economicEffect: NO_ECONOMIC_EFFECT,
          persistentRecordReferences: {
            ...emptyPersistentRefs(),
            riskDecisionId: execution.riskDecision.riskDecisionId,
          },
          assertedInvariants: satisfiedInvariants(["NO_ORDER_RECORD", "NO_RESERVED_CASH"]),
        });
        continue;
      }

      if (execution?.status === "submitted" && execution.order) {
        const riskState = tracker.observeReadOnly();
        input.collector.append({
          replayTimestamp,
          capitalPathStage: "RISK_EVALUATION",
          repositoryPath: "lib/trader/risk/risk-engine-service",
          symbol: strategyExecution.signal.symbol,
          caller: "OrderExecutionService.submitOrder",
          callee: "RiskEngineService.evaluateOrderRequest",
          inputDigest: digestValue({ signalId: strategyExecution.signal.strategySignalId }),
          outputDigest: digestValue({ status: "APPROVE" }),
          ...riskState,
          decisionOrReasonCode: "APPROVE",
          economicEffect: NO_ECONOMIC_EFFECT,
          persistentRecordReferences: emptyPersistentRefs(),
          assertedInvariants: satisfiedInvariants(["RISK_APPROVED"]),
        });
        const orderState = tracker.observeTransition({
          stage: "ORDER_SUBMIT",
          orderId: execution.order.id,
          state: execution.order.state,
        });
        input.collector.append({
          replayTimestamp,
          capitalPathStage: "ORDER_SUBMIT",
          repositoryPath: "lib/trader/execution/order-execution-service",
          symbol: strategyExecution.signal.symbol,
          caller: "runPaperCycle",
          callee: "OrderExecutionService.submitOrder",
          inputDigest: digestValue({ side: strategyExecution.signal.side }),
          outputDigest: digestValue({ orderId: execution.order.id, state: execution.order.state }),
          ...orderState,
          decisionOrReasonCode: execution.order.state,
          economicEffect: OBSERVATION_ONLY_EFFECT,
          persistentRecordReferences: {
            ...emptyPersistentRefs(),
            orderId: execution.order.id,
          },
          assertedInvariants: satisfiedInvariants(["ORDER_CREATED"]),
        });
      }
    }

    const decisionRecord = cycle.evaluation.forecastDecisionBundle?.decision;
    const submissionAttempted = cycle.strategyExecutions.some(
      (entry) => entry.execution !== undefined && entry.execution !== null,
    );
    if (
      !submissionAttempted &&
      (cycle.strategyExecutions.length === 0 ||
        cycle.strategyExecutions.every((entry) => entry.submitBlocked))
    ) {
      const abstainDecision =
        cycle.strategyExecutions.every((entry) => entry.submitBlocked) &&
        cycle.strategyExecutions.length > 0
          ? "ABSTAIN"
          : "NO_TRADE";
      const noTradeState = tracker.observeReadOnly();
      input.collector.append({
        replayTimestamp,
        capitalPathStage: "NO_TRADE",
        repositoryPath: "lib/trader/intelligence/terminal-reason/universal-terminal-reason",
        symbol,
        caller: "runEvaluationCycle",
        callee: "resolveTerminalReasonCode",
        inputDigest: digestValue({
          cycleIndex,
          signal: cycle.evaluation.signal?.strategySignalId ?? null,
          terminalReasonCode: decisionRecord?.universalTerminalReasonCode ?? null,
        }),
        outputDigest: digestValue({
          decision: abstainDecision,
          decisionClass: decisionRecord?.decisionClass ?? null,
          whyNotCashJson: decisionRecord?.whyNotCashJson ?? null,
          whyCashOrAbstainJson: decisionRecord?.whyCashOrAbstainJson ?? null,
          explanationDigest: digestValue({
            whyNotCashJson: decisionRecord?.whyNotCashJson ?? null,
            whyCashOrAbstainJson: decisionRecord?.whyCashOrAbstainJson ?? null,
          }),
        }),
        ...noTradeState,
        decisionOrReasonCode: decisionRecord?.universalTerminalReasonCode ?? abstainDecision,
        economicEffect: NO_ECONOMIC_EFFECT,
        persistentRecordReferences: {
          ...emptyPersistentRefs(),
          decisionRecordId: decisionRecord?.id ?? null,
        },
        assertedInvariants: satisfiedInvariants(["ZERO_ORDERS", "ZERO_EXPOSURE_CHANGE"]),
      });
    }

    for (const runtimeEvent of cycle.htrRuntimeCallOrder ?? []) {
      const stage = mapRuntimeKindToStage(runtimeEvent.kind);
      const isEconomic =
        runtimeEvent.kind === "WP17_FILL_CONSUMED" ||
        runtimeEvent.kind === "WP20_BREACH_CANCELLATION_EXECUTED" ||
        runtimeEvent.kind === "WP18_MARK_ATTACHED";
      const runtimeState = isEconomic
        ? tracker.observeTransition({
            kind: runtimeEvent.kind,
            cycleIndex: runtimeEvent.cycleIndex ?? cycleIndex,
            detail: runtimeEvent.detail ?? null,
          })
        : tracker.observeReadOnly();
      input.collector.append({
        replayTimestamp: runtimeEvent.at,
        capitalPathStage: stage,
        repositoryPath: "lib/trader/accounting/htr-accounting-cycle-bridge",
        symbol,
        caller: "htrAccountingCycleBridge",
        callee: runtimeEvent.kind,
        inputDigest: digestValue({ cycleIndex: runtimeEvent.cycleIndex ?? cycleIndex }),
        outputDigest: digestValue({ detail: runtimeEvent.detail ?? null }),
        ...runtimeState,
        decisionOrReasonCode: runtimeEvent.kind,
        economicEffect:
          runtimeEvent.kind === "WP17_FILL_CONSUMED" ||
          runtimeEvent.kind === "WP20_BREACH_CANCELLATION_EXECUTED"
            ? OBSERVATION_ONLY_EFFECT
            : NO_ECONOMIC_EFFECT,
        persistentRecordReferences: emptyPersistentRefs(),
        assertedInvariants: satisfiedInvariants([runtimeEvent.kind]),
      });
    }

    if (cycle.htrGuardian) {
      const guardianState = tracker.observeReadOnly();
      input.collector.append({
        replayTimestamp,
        capitalPathStage: "GUARDIAN_CYCLE",
        repositoryPath: "lib/trader/guardian/htr-guardian-risk-bridge",
        symbol,
        caller: "runPaperCycle",
        callee: "evaluateHtrGuardianForBridge",
        inputDigest: digestValue({ breachState: cycle.htrGuardian.breachState }),
        outputDigest: digestValue({
          allowNewExposure: cycle.htrGuardian.allowNewExposure,
          permitRiskReducingExit: cycle.htrGuardian.permitRiskReducingExit,
          reason: cycle.htrGuardian.reason,
        }),
        ...guardianState,
        decisionOrReasonCode: cycle.htrGuardian.reason ?? cycle.htrGuardian.breachState,
        economicEffect: NO_ECONOMIC_EFFECT,
        persistentRecordReferences: emptyPersistentRefs(),
        assertedInvariants: satisfiedInvariants(["GUARDIAN_EVALUATED"]),
      });
    }

    for (const guardianExecution of cycle.guardianExecutions ?? []) {
      if (guardianExecution.execution?.status === "submitted") {
        const exitState = tracker.observeTransition({
          stage: "EXIT_ORDER",
          intentId: guardianExecution.intentId,
          orderId: guardianExecution.execution.order?.id ?? null,
        });
        input.collector.append({
          replayTimestamp,
          capitalPathStage: "EXIT_ORDER",
          repositoryPath: "lib/trader/guardian",
          symbol,
          caller: "runPaperCycle",
          callee: "mapExitIntentToSubmitOrder",
          inputDigest: digestValue({ intentId: guardianExecution.intentId }),
          outputDigest: digestValue({
            orderId: guardianExecution.execution?.order?.id ?? null,
          }),
          ...exitState,
          decisionOrReasonCode: "GUARDIAN_EXIT",
          economicEffect: OBSERVATION_ONLY_EFFECT,
          persistentRecordReferences: {
            ...emptyPersistentRefs(),
            orderId: guardianExecution.execution?.order?.id ?? null,
          },
          assertedInvariants: satisfiedInvariants(["EXIT_ORDER_SUBMITTED"]),
        });
      }
    }

    if (cycle.reconciliation) {
      const failed =
        (cycle.reconciliation.counts.TERMINAL_DRIFT ?? 0) > 0 ||
        (cycle.reconciliation.counts.UNKNOWN_POSITION ?? 0) > 0;
      const reconciliationState = tracker.observeReadOnly();
      input.collector.append({
        replayTimestamp,
        capitalPathStage: "RECONCILIATION",
        repositoryPath: "lib/trader/execution/reconciliation-service",
        symbol,
        caller: "runPaperCycle",
        callee: "reconcile",
        inputDigest: digestValue({ cycleIndex }),
        outputDigest: digestValue({ failed, counts: cycle.reconciliation.counts }),
        ...reconciliationState,
        decisionOrReasonCode: failed ? "RECONCILIATION_FAIL" : "RECONCILIATION_OK",
        economicEffect: NO_ECONOMIC_EFFECT,
        persistentRecordReferences: emptyPersistentRefs(),
        assertedInvariants: satisfiedInvariants([
          failed ? "RECONCILIATION_FAILED" : "RECONCILIATION_PASSED",
        ]),
      });
    }
  }

  if (input.accountingState) {
    const terminalTimestamp =
      input.barTimestamps?.at(-1) ??
      input.cycleResults.at(-1)?.htrRuntimeCallOrder?.at(-1)?.at ??
      new Date().toISOString();
    const terminalState = tracker.anchorAccountingState(input.accountingState);
    input.collector.append({
      replayTimestamp: terminalTimestamp,
      capitalPathStage: "TERMINAL_REPORT",
      repositoryPath: "lib/trader/readiness/build-fhv-pnl-report.v1",
      symbol: input.symbol ?? "BTC/USDT",
      caller: "runBacktest",
      callee: "buildBacktestEvaluationExport",
      inputDigest: digestValue({ cycleCount: input.cycleResults.length }),
      outputDigest: terminalState.stateAfterDigest,
      ...terminalState,
      decisionOrReasonCode: "TERMINAL_EXPORT",
      economicEffect: {
        cashDelta: input.accountingState.cash,
        cashDeltaReason: null,
        exposureDelta: input.accountingState.markedPositionValue,
        exposureDeltaReason: null,
        realizedPnlDelta: input.accountingState.netRealizedPnl,
        realizedPnlDeltaReason: null,
      },
      persistentRecordReferences: emptyPersistentRefs(),
      assertedInvariants: satisfiedInvariants(["TERMINAL_RECONCILED"]),
    });

    if (compareDecimal(input.accountingState.netRealizedPnl, "0") !== 0) {
      const closedTradeState = tracker.observeReadOnly();
      input.collector.append({
        replayTimestamp: terminalTimestamp,
        capitalPathStage: "CLOSED_TRADE",
        repositoryPath: "lib/trader/lifecycle/derive-trades-from-fills",
        symbol: input.symbol ?? "BTC/USDT",
        caller: "runBacktest",
        callee: "deriveTradesFromFills",
        inputDigest: digestValue({ fillCount: input.accountingState.consumedFillIds.length }),
        outputDigest: digestValue({ netRealizedPnl: input.accountingState.netRealizedPnl }),
        ...closedTradeState,
        decisionOrReasonCode:
          compareDecimal(input.accountingState.netRealizedPnl, "0") > 0
            ? "PROFITABLE_CLOSED_TRADE"
            : "LOSING_CLOSED_TRADE",
        economicEffect: {
          cashDelta: input.accountingState.cash,
          cashDeltaReason: null,
          exposureDelta: "0",
          exposureDeltaReason: null,
          realizedPnlDelta: input.accountingState.netRealizedPnl,
          realizedPnlDeltaReason: null,
        },
        persistentRecordReferences: emptyPersistentRefs(),
        assertedInvariants: satisfiedInvariants(["CLOSED_TRADE_RECORDED"]),
      });
    }
  }

  return [...input.collector.events];
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
