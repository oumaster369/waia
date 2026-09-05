import type {
  HistoricalModeledExitV2,
  HistoricalPortfolioProposalV2,
  HistoricalSimulationV2Cycle,
  RunHistoricalSimulationV2Input,
} from "@/lib/trader/backtest/historical-simulation-v2";
import type { HistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { deterministicExecutionUuidV2, multiplyExecutionNotionalConservativelyV2 } from "@/lib/trader/execution/v2/contracts";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  CanonicalDecisionCapitalAuthorityV2Deps,
  DecisionAuthorityV2,
  DecisionQualificationRequestV2,
  DecisionStageOutcomeV2,
  RiskStageOutcomeV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import { calculateRiskAdmissionV2 } from "@/lib/trader/risk/v2/risk-admission-service-v2";
import type { ProtectivePostureV2 } from "@/lib/trader/risk/v2/protective-posture-v2";
import type { HistoricalSimulationReasonLedgerV2Draft } from "./reason-ledger-v2";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  buildHistoricalModeledPortfolioLifecycleV2,
  buildHistoricalModeledRealityV2,
  deriveHistoricalModeledRiskAccountingV2,
  type HistoricalModeledPortfolioLifecycleReceiptV2,
  type HistoricalModeledRealityV2,
  type HistoricalModeledRiskAccountingV2,
} from "./historical-modeled-portfolio-reality-v2";
import { evaluateHtrGuardianCycle } from "@/lib/trader/guardian/htr-guardian-risk-bridge";

export const HISTORICAL_MODELED_RISK_V2_SCHEMA = "waia.trader.historical_modeled_risk.v2" as const;
export const HISTORICAL_MODELED_EXECUTION_V2_SCHEMA = "waia.trader.historical_modeled_execution.v2" as const;
export const HISTORICAL_MODELED_GUARDIAN_V2_SCHEMA = "waia.trader.historical_modeled_guardian.v2" as const;

type ModeledSource = Readonly<{ source: "MODELED_HISTORICAL"; capitalEligible: false }>;

export type HistoricalModeledRiskReceiptV2 = ModeledSource & Readonly<{
  schemaVersion: typeof HISTORICAL_MODELED_RISK_V2_SCHEMA;
  riskVerdictId: string;
  riskAllowanceId: string | null;
  riskAllowanceContentDigestHex: string | null;
  decisionContentDigestHex: string;
  accountingFrontierContentDigestHex: string;
  portfolioLifecycleContentDigestHex: string;
  action: "ENTER_LONG" | "REDUCE" | "CLOSE";
  reconciledExposureNotional: string;
  projectedSymbolExposureNotional: string;
  strictExposureReduction: boolean;
  verdict: "APPROVE" | "VETO";
  approvedQuantity: string | null;
  requestedReservationNotional: string;
  remainingBeforeAdmissionNotional: string;
  remainingAfterAdmissionNotional: string;
  reasonCodes: readonly string[];
  contentDigestHex: string;
}>;

export type HistoricalModeledExecutionReceiptV2 = ModeledSource & Readonly<{
  schemaVersion: typeof HISTORICAL_MODELED_EXECUTION_V2_SCHEMA;
  executionPlanId: string;
  executionPlanContentDigestHex: string;
  executionAttemptId: string;
  executionAttemptContentDigestHex: string;
  orderId: string;
  orderContentDigestHex: string;
  decisionId: string;
  decisionContentDigestHex: string;
  riskVerdictId: string;
  riskReceiptContentDigestHex: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  decisionBarIndex: number;
  acceptedAtUtc: string;
  contentDigestHex: string;
}>;

export type HistoricalModeledExecutionRegistryV2 = Readonly<{
  register(receipt: HistoricalModeledExecutionReceiptV2): void;
  get(orderId: string): HistoricalModeledExecutionReceiptV2 | null;
}>;

export function createHistoricalModeledExecutionRegistryV2(): HistoricalModeledExecutionRegistryV2 {
  const receipts = new Map<string, HistoricalModeledExecutionReceiptV2>();
  return Object.freeze({
    register(receipt: HistoricalModeledExecutionReceiptV2) {
      const existing = receipts.get(receipt.orderId);
      if (existing && existing.contentDigestHex !== receipt.contentDigestHex) {
        throw new Error("HISTORICAL_MODELED_EXECUTION_REGISTRY_CONFLICT");
      }
      receipts.set(receipt.orderId, receipt);
    },
    get(orderId: string) { return receipts.get(orderId) ?? null; },
  });
}

export type HistoricalModeledGuardianReceiptV2 = ModeledSource & Readonly<{
  schemaVersion: typeof HISTORICAL_MODELED_GUARDIAN_V2_SCHEMA;
  cycleId: string;
  accountingFrontierContentDigestHex: string;
  reconciledExposureNotional: string;
  exposureLimitNotional: string;
  status: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";
  reasonCodes: readonly string[];
  contentDigestHex: string;
}>;

export type HistoricalModeledAccountingSnapshotV2 = Readonly<{
  frontier: AccountingFrontierV1;
  exposureLimitNotional: string;
  worstCasePendingExposureNotional: string;
  outstandingReservationNotional: string;
  posture: ProtectivePostureV2;
}>;

type PersistedModeledEvidence = HistoricalModeledRiskReceiptV2 | HistoricalModeledExecutionReceiptV2 | HistoricalModeledGuardianReceiptV2;

export type HistoricalModeledCapitalBindingV2Input = Readonly<{
  organizationId: string;
  accountId: string;
  runId: string;
  resolveCycle(cycleId: string): HistoricalSimulationV2Cycle;
  decide(request: DecisionQualificationRequestV2): Promise<DecisionStageOutcomeV2>;
  loadAccounting(cycle: HistoricalSimulationV2Cycle): Promise<HistoricalModeledAccountingSnapshotV2>;
  exchange: HistoricalSimulatedExchange;
  executionRegistry: HistoricalModeledExecutionRegistryV2;
  decisionBarIndex(cycle: HistoricalSimulationV2Cycle): number;
  evaluateGuardian(input: Readonly<{
    cycle: HistoricalSimulationV2Cycle;
    accounting: HistoricalModeledRiskAccountingV2;
  }>): Promise<Readonly<{ status: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT"; reasonCodes: readonly string[] }>>;
  persistEvidence(evidence: PersistedModeledEvidence): Promise<void>;
  /** Persists the exact credential-free mock order before in-memory exchange registration. */
  persistExecutionSubmission(input: Readonly<{ receipt: HistoricalModeledExecutionReceiptV2;
    order: OrderRow; riskAllowanceId: string }>): Promise<OrderRow>;
  /** Advances eligible mock orders, applies modeled fills, and persists accounting. */
  advanceModeledExecution(cycle: HistoricalSimulationV2Cycle): Promise<Readonly<{
    execution?: HistoricalSimulationReasonLedgerV2Draft["execution"];
    observedExecutionEffects: HistoricalSimulationReasonLedgerV2Draft["observedExecutionEffects"];
    accountingAdvanced: boolean;
  }>>;
  learningProjection: RunHistoricalSimulationV2Input["resolveLedgerProjection"] extends
    (input: infer I) => Promise<infer O> ? (input: I) => Promise<O extends { learning: infer L } ? L : never> : never;
}>;

export type HistoricalModeledCapitalBindingV2 = Readonly<{
  decisionCapitalAuthorityV2: CanonicalDecisionCapitalAuthorityV2Deps;
  modeledExit: NonNullable<RunHistoricalSimulationV2Input["modeledExit"]>;
  resolveLedgerProjection: RunHistoricalSimulationV2Input["resolveLedgerProjection"];
  portfolioLifecycleForCycle(cycleId: string): HistoricalModeledPortfolioLifecycleReceiptV2 | null;
  modeledRealityForCycle(cycleId: string): HistoricalModeledRealityV2 | null;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function seal<T extends Record<string, unknown>>(body: T): Readonly<T & { contentDigestHex: string }> {
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`HISTORICAL_MODELED_BINDING_INVALID:${field}`);
}

export function createHistoricalModeledOrderFromReceiptV2(input: {
  organizationId: string;
  accountId: string;
  runId: string;
  decisionId: string;
  allowanceId: string;
  receipt: HistoricalModeledExecutionReceiptV2;
}): OrderRow {
  const accepted = new Date(input.receipt.acceptedAtUtc);
  return Object.freeze({
    id: input.receipt.orderId,
    organizationId: input.organizationId,
    credentialId: null,
    venue: "HISTORICAL_SIMULATED_EXCHANGE",
    executionMode: "mock",
    historicalRunId: input.runId,
    historicalAccountKey: input.accountId,
    symbol: input.receipt.symbol,
    side: input.receipt.side,
    type: "market",
    price: null,
    quantity: input.receipt.quantity,
    filledQuantity: "0",
    avgFillPrice: null,
    state: "CREATED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `hsv2-${input.receipt.executionAttemptId}`,
    idempotencyKey: `historical-modeled-v2-${input.receipt.contentDigestHex}`,
    riskDecisionId: input.receipt.riskVerdictId,
    riskAllowanceId: input.allowanceId,
    riskAllowanceBindingDigest: input.receipt.riskReceiptContentDigestHex,
    openingCausalLineageJson: null,
    openingCausalLineageDigest: null,
    strategySignalId: null,
    allocationDecisionId: input.decisionId,
    createdAt: accepted,
    updatedAt: accepted,
  });
}

/**
 * Historical-only capital composition. It reuses Risk V2's pure admission math, but deliberately
 * does not call canonical Risk/Reality/Guardian persistence: those contracts assert reconciled
 * venue Reality and cannot truthfully represent simulated bars. All effects are mock orders on the
 * historical exchange and all evidence is explicitly non-capital modeled evidence.
 */
export function createHistoricalModeledCapitalBindingV2(
  input: HistoricalModeledCapitalBindingV2Input,
): HistoricalModeledCapitalBindingV2 {
  const riskByDecision = new Map<string, HistoricalModeledRiskReceiptV2>();
  const executionByCycle = new Map<string, HistoricalModeledExecutionReceiptV2>();
  const guardianByCycle = new Map<string, HistoricalModeledGuardianReceiptV2>();
  const portfolioByCycle = new Map<string, HistoricalModeledPortfolioLifecycleReceiptV2>();
  const realityByCycle = new Map<string, HistoricalModeledRealityV2>();

  async function loadAccounting(cycle: HistoricalSimulationV2Cycle): Promise<Readonly<{
    derived: HistoricalModeledRiskAccountingV2;
    posture: ProtectivePostureV2;
  }>> {
    const snapshot = await input.loadAccounting(cycle);
    const derived = deriveHistoricalModeledRiskAccountingV2({
      frontier: snapshot.frontier,
      organizationId: input.organizationId,
      accountId: input.accountId,
      runId: input.runId,
      exposureLimitNotional: snapshot.exposureLimitNotional,
      worstCasePendingExposureNotional: snapshot.worstCasePendingExposureNotional,
      outstandingReservationNotional: snapshot.outstandingReservationNotional,
    });
    return Object.freeze({ derived, posture: snapshot.posture });
  }

  async function assessRisk(args: Readonly<{
    request: DecisionQualificationRequestV2;
    decision: DecisionAuthorityV2;
  }>): Promise<RiskStageOutcomeV2> {
    const cycle = input.resolveCycle(args.request.cycleId);
    if (cycle.symbol !== args.request.symbol || cycle.referencePrice !== args.request.referencePrice) {
      throw new Error("HISTORICAL_MODELED_BINDING_REFUSED:CYCLE_IDENTITY_MISMATCH");
    }
    const { derived: accounting, posture } = await loadAccounting(cycle);
    requireDigest(accounting.frontierContentDigestHex, "accountingFrontierContentDigestHex");
    const lifecycle = buildHistoricalModeledPortfolioLifecycleV2({
      organizationId: input.organizationId, accountId: input.accountId, runId: input.runId,
      cycleId: cycle.cycleId, symbol: cycle.symbol, action: "ENTER_LONG",
      quantity: args.decision.qualifiedQuantity, referencePrice: cycle.referencePrice, accounting,
    });
    portfolioByCycle.set(cycle.cycleId, lifecycle);
    const requested = multiplyExecutionNotionalConservativelyV2(
      args.decision.qualifiedQuantity,
      args.request.referencePrice,
    );
    // This maps modeled-accounting coherence into the pure envelope calculator. It does not
    // create or assert a venue Reality reconciliation record.
    const modeledAccountingCoherence = "CURRENT_MODELED_FRONTIER" as const;
    const calculation = calculateRiskAdmissionV2({
      accounting: accounting.accounting,
      requestedReservationNotional: requested,
      posture,
      strictExposureReduction: false,
      reconciliationStatus:
        modeledAccountingCoherence === "CURRENT_MODELED_FRONTIER" ? "RECONCILED" : "UNAVAILABLE",
    });
    const riskVerdictId = deterministicExecutionUuidV2("risk-event", {
      runId: input.runId,
      cycleId: args.request.cycleId,
      decisionContentDigestHex: args.decision.contentDigestHex,
    });
    const allowanceId = calculation.status === "ADMITTED"
      ? deterministicExecutionUuidV2("risk-event", { kind: "allowance", riskVerdictId })
      : null;
    const allowanceContentDigestHex = allowanceId === null ? null : computeSemanticSha256Hex({
      schemaVersion: "waia.trader.historical_modeled_risk_allowance.v2",
      source: "MODELED_HISTORICAL",
      capitalEligible: false,
      allowanceId,
      riskVerdictId,
      decisionContentDigestHex: args.decision.contentDigestHex,
      approvedQuantity: args.decision.qualifiedQuantity,
    });
    const receipt = seal({
      schemaVersion: HISTORICAL_MODELED_RISK_V2_SCHEMA,
      source: "MODELED_HISTORICAL" as const,
      capitalEligible: false as const,
      riskVerdictId,
      riskAllowanceId: allowanceId,
      riskAllowanceContentDigestHex: allowanceContentDigestHex,
      decisionContentDigestHex: args.decision.contentDigestHex,
      accountingFrontierContentDigestHex: accounting.frontierContentDigestHex,
      portfolioLifecycleContentDigestHex: lifecycle.contentDigestHex,
      action: "ENTER_LONG" as const,
      reconciledExposureNotional: accounting.accounting.reconciledExposureNotional,
      projectedSymbolExposureNotional: lifecycle.exposureNotionalAfter,
      strictExposureReduction: false,
      verdict: calculation.status === "ADMITTED" ? "APPROVE" as const : "VETO" as const,
      approvedQuantity: calculation.status === "ADMITTED" ? args.decision.qualifiedQuantity : null,
      requestedReservationNotional: requested,
      remainingBeforeAdmissionNotional: calculation.remainingBeforeAdmissionNotional,
      remainingAfterAdmissionNotional: calculation.remainingAfterAdmissionNotional,
      reasonCodes: Object.freeze(calculation.status === "ADMITTED" ? [] : [calculation.reason]),
    }) as HistoricalModeledRiskReceiptV2;
    riskByDecision.set(args.decision.contentDigestHex, receipt);
    await input.persistEvidence(receipt);
    if (calculation.status === "REFUSED") {
      return Object.freeze({
        status: "VETO",
        decisionContentDigestHex: args.decision.contentDigestHex,
        reasonCodes: receipt.reasonCodes,
      });
    }
    return Object.freeze({
      status: "PERMITTED",
      decisionContentDigestHex: args.decision.contentDigestHex,
      riskVerdictId,
      riskVerdictContentDigestHex: receipt.contentDigestHex,
      riskAllowanceId: allowanceId!,
      riskAllowanceContentDigestHex: allowanceContentDigestHex!,
      approvedQualifiedQuantity: args.decision.qualifiedQuantity,
    });
  }

  async function executeModeled(args: {
    cycle: HistoricalSimulationV2Cycle;
    decisionId: string;
    decisionContentDigestHex: string;
    allowanceId: string;
    side: "buy" | "sell";
    quantity: string;
  }): Promise<HistoricalModeledExecutionReceiptV2> {
    const risk = riskByDecision.get(args.decisionContentDigestHex);
    if (!risk || risk.verdict !== "APPROVE" || risk.riskAllowanceId !== args.allowanceId) {
      throw new Error("HISTORICAL_MODELED_BINDING_REFUSED:RISK_RECEIPT_MISSING");
    }
    const executionPlanId = deterministicExecutionUuidV2("plan", {
      runId: input.runId, cycleId: args.cycle.cycleId, side: args.side, risk: risk.contentDigestHex,
    });
    const executionAttemptId = deterministicExecutionUuidV2("attempt", { executionPlanId });
    const orderId = deterministicExecutionUuidV2("order", { executionAttemptId });
    const executionPlanContentDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.trader.historical_modeled_execution_plan.v2", source: "MODELED_HISTORICAL",
      capitalEligible: false, executionPlanId, decisionId: args.decisionId,
      decisionContentDigestHex: args.decisionContentDigestHex, riskReceiptContentDigestHex: risk.contentDigestHex,
      symbol: args.cycle.symbol, side: args.side, quantity: args.quantity,
    });
    const executionAttemptContentDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.trader.historical_modeled_execution_attempt.v2", source: "MODELED_HISTORICAL",
      capitalEligible: false, executionAttemptId, executionPlanId, executionPlanContentDigestHex,
      acceptedAtUtc: args.cycle.observedAt,
    });
    const orderContentDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.trader.historical_modeled_order.v2",
      source: "MODELED_HISTORICAL",
      capitalEligible: false,
      orderId,
      executionAttemptId,
      executionAttemptContentDigestHex,
      decisionContentDigestHex: args.decisionContentDigestHex,
      symbol: args.cycle.symbol,
      side: args.side,
      quantity: args.quantity,
    });
    const receipt = seal({
      schemaVersion: HISTORICAL_MODELED_EXECUTION_V2_SCHEMA,
      source: "MODELED_HISTORICAL" as const,
      capitalEligible: false as const,
      executionPlanId,
      executionPlanContentDigestHex,
      executionAttemptId,
      executionAttemptContentDigestHex,
      orderId,
      orderContentDigestHex,
      decisionId: args.decisionId,
      decisionContentDigestHex: args.decisionContentDigestHex,
      riskVerdictId: risk.riskVerdictId,
      riskReceiptContentDigestHex: risk.contentDigestHex,
      symbol: args.cycle.symbol,
      side: args.side,
      quantity: args.quantity,
      decisionBarIndex: input.decisionBarIndex(args.cycle),
      acceptedAtUtc: args.cycle.observedAt,
    }) as HistoricalModeledExecutionReceiptV2;
    const order = createHistoricalModeledOrderFromReceiptV2({
      organizationId: input.organizationId,
      accountId: input.accountId,
      runId: input.runId,
      decisionId: args.decisionId,
      allowanceId: args.allowanceId,
      receipt,
    });
    const acceptedOrder = await input.persistExecutionSubmission({ receipt, order,
      riskAllowanceId: args.allowanceId });
    if (acceptedOrder.id !== order.id || acceptedOrder.state !== "ACCEPTED") {
      throw new Error("HISTORICAL_MODELED_BINDING_REFUSED:ORDER_NOT_ACCEPTED");
    }
    input.exchange.registerOrder(acceptedOrder, receipt.decisionBarIndex, Date.parse(receipt.acceptedAtUtc));
    input.executionRegistry.register(receipt);
    executionByCycle.set(args.cycle.cycleId, receipt);
    await input.persistEvidence(receipt);
    return receipt;
  }

  const decisionCapitalAuthorityV2: CanonicalDecisionCapitalAuthorityV2Deps = {
    decide: input.decide,
    assessRisk,
    async execute({ request, decision, permission }) {
      if (request.executionMode !== "historical") {
        throw new Error("HISTORICAL_MODELED_BINDING_REFUSED:NON_HISTORICAL_MODE");
      }
      const receipt = await executeModeled({
        cycle: input.resolveCycle(request.cycleId),
        decisionId: decision.decisionId,
        decisionContentDigestHex: decision.contentDigestHex,
        allowanceId: permission.riskAllowanceId,
        side: "buy",
        quantity: permission.approvedQualifiedQuantity,
      });
      const order = Object.freeze({ ...createHistoricalModeledOrderFromReceiptV2({ organizationId: input.organizationId,
        accountId: input.accountId, runId: input.runId, decisionId: decision.decisionId, allowanceId: permission.riskAllowanceId,
        receipt }), state: "ACCEPTED" as const, stateVersion: 2 });
      return Object.freeze({
        decisionContentDigestHex: decision.contentDigestHex,
        riskAllowanceId: permission.riskAllowanceId,
        riskAllowanceContentDigestHex: permission.riskAllowanceContentDigestHex,
        riskAllowanceOrderBindingDigestHex: receipt.riskReceiptContentDigestHex,
        executionPlanId: receipt.executionPlanId,
        executionPlanContentDigestHex: receipt.executionPlanContentDigestHex,
        executionAttemptId: receipt.executionAttemptId,
        executionAttemptContentDigestHex: receipt.executionAttemptContentDigestHex,
        submittedQuantity: receipt.quantity,
        execution: { status: "submitted" as const, order },
      });
    },
  };

  const modeledExit = {
    async execute({ cycle, proposal }: { cycle: HistoricalSimulationV2Cycle; proposal: HistoricalPortfolioProposalV2 }): Promise<HistoricalModeledExitV2> {
      const { derived: accounting, posture } = await loadAccounting(cycle);
      const lifecycle = buildHistoricalModeledPortfolioLifecycleV2({
        organizationId: input.organizationId, accountId: input.accountId, runId: input.runId,
        cycleId: cycle.cycleId, symbol: cycle.symbol, action: proposal.action,
        quantity: proposal.quantity, referencePrice: cycle.referencePrice, accounting,
      });
      portfolioByCycle.set(cycle.cycleId, lifecycle);
      const calculation = calculateRiskAdmissionV2({ accounting: accounting.accounting,
        requestedReservationNotional: "0", posture,
        strictExposureReduction: lifecycle.strictExposureReduction, reconciliationStatus: "RECONCILED" });
      const approved = calculation.status === "ADMITTED";
      const riskVerdictId = deterministicExecutionUuidV2("risk-event", { kind: "exit-verdict",
        runId: input.runId, cycleId: cycle.cycleId,
        decisionContentDigestHex: proposal.decisionContentDigestHex });
      const allowanceId = approved ? deterministicExecutionUuidV2("risk-event", { kind: "exit-allowance",
        runId: input.runId, cycleId: cycle.cycleId,
        decisionContentDigestHex: proposal.decisionContentDigestHex }) : null;
      const allowanceContentDigestHex = allowanceId === null ? null : computeSemanticSha256Hex({
        schemaVersion: "waia.trader.historical_modeled_risk_allowance.v2", source: "MODELED_HISTORICAL",
        capitalEligible: false, allowanceId, riskVerdictId,
        decisionContentDigestHex: proposal.decisionContentDigestHex, approvedQuantity: proposal.quantity });
      const risk = seal({
        schemaVersion: HISTORICAL_MODELED_RISK_V2_SCHEMA,
        source: "MODELED_HISTORICAL" as const,
        capitalEligible: false as const,
        riskVerdictId,
        riskAllowanceId: allowanceId,
        riskAllowanceContentDigestHex: allowanceContentDigestHex,
        decisionContentDigestHex: proposal.decisionContentDigestHex,
        accountingFrontierContentDigestHex: accounting.frontierContentDigestHex,
        portfolioLifecycleContentDigestHex: lifecycle.contentDigestHex,
        action: proposal.action,
        reconciledExposureNotional: accounting.accounting.reconciledExposureNotional,
        projectedSymbolExposureNotional: lifecycle.exposureNotionalAfter,
        strictExposureReduction: lifecycle.strictExposureReduction,
        verdict: approved ? "APPROVE" as const : "VETO" as const,
        approvedQuantity: approved ? proposal.quantity : null,
        requestedReservationNotional: "0",
        remainingBeforeAdmissionNotional: calculation.remainingBeforeAdmissionNotional,
        remainingAfterAdmissionNotional: calculation.remainingAfterAdmissionNotional,
        reasonCodes: Object.freeze(approved ? ["STRICT_MODELED_EXPOSURE_REDUCTION"] : [calculation.reason]),
      }) as HistoricalModeledRiskReceiptV2;
      riskByDecision.set(proposal.decisionContentDigestHex, risk);
      await input.persistEvidence(risk);
      if (!approved || !allowanceId) {
        return Object.freeze({
          risk: { status: "VETO" as const, reasonCodes: risk.reasonCodes,
            verdictContentDigestHex: risk.contentDigestHex, allowanceContentDigestHex: null },
          execution: { status: "NOT_DISPATCHED" as const, reasonCodes: ["RISK_VETO"],
            planContentDigestHex: null, attemptContentDigestHex: null,
            reportContentDigestHex: null, fillContentDigestHexes: [] },
        });
      }
      const execution = await executeModeled({ cycle, decisionId: proposal.decisionContentDigestHex,
        decisionContentDigestHex: proposal.decisionContentDigestHex, allowanceId,
        side: "sell", quantity: proposal.quantity! });
      return Object.freeze({
        risk: { status: "APPROVE", reasonCodes: [], verdictContentDigestHex: risk.contentDigestHex, allowanceContentDigestHex: risk.riskAllowanceContentDigestHex },
        execution: { status: "COMMITTED", reasonCodes: [],
          planContentDigestHex: execution.executionPlanContentDigestHex,
          attemptContentDigestHex: execution.executionAttemptContentDigestHex,
          reportContentDigestHex: null, fillContentDigestHexes: [] },
      });
    },
  };

  const resolveLedgerProjection: RunHistoricalSimulationV2Input["resolveLedgerProjection"] = async (context) => {
    const observed = await input.advanceModeledExecution(context.cycle);
    const { derived: accounting } = await loadAccounting(context.cycle);
    const lifecycle = portfolioByCycle.get(context.cycle.cycleId) ??
      buildHistoricalModeledPortfolioLifecycleV2({ organizationId: input.organizationId,
        accountId: input.accountId, runId: input.runId, cycleId: context.cycle.cycleId,
        symbol: context.cycle.symbol, action: context.proposal.action, quantity: context.proposal.quantity,
        referencePrice: context.cycle.referencePrice, accounting });
    portfolioByCycle.set(context.cycle.cycleId, lifecycle);
    const reality = buildHistoricalModeledRealityV2({ organizationId: input.organizationId,
      accountId: input.accountId, runId: input.runId, cycleId: context.cycle.cycleId,
      accounting, portfolioLifecycle: lifecycle });
    realityByCycle.set(context.cycle.cycleId, reality);
    const restored = await input.evaluateGuardian({ cycle: context.cycle, accounting });
    const frontier = accounting.frontier;
    const derivedGuardian = evaluateHtrGuardianCycle({
      accountPeakHwm: frontier.equityHwm,
      monthlyPeakHwm: frontier.monthlyPeakHwm ?? frontier.equityHwm,
      equityUsdt: frontier.equity,
      strategyDrawdownBps: Math.max(0, ...Object.values(frontier.strategyDrawdownBpsByKey ?? {})),
      skipReconciliationAssert: true,
      missingMark: accounting.openPositionCount > Object.keys(frontier.marks).length,
    });
    const statusRank = { NONE: 0, CLOSE_ONLY: 1, STOP_ACCOUNT: 2 } as const;
    const derivedStatus = derivedGuardian.breachState === "STOP_ACCOUNT" ? "STOP_ACCOUNT" as const :
      derivedGuardian.breachState === "CLOSE_ONLY" ? "CLOSE_ONLY" as const : "NONE" as const;
    const status = statusRank[derivedStatus] >= statusRank[restored.status] ? derivedStatus : restored.status;
    const guardianReasons = Object.freeze([...restored.reasonCodes,
      ...(derivedGuardian.reason === null ? [] : [derivedGuardian.reason])]);
    const guardian = seal({
      schemaVersion: HISTORICAL_MODELED_GUARDIAN_V2_SCHEMA,
      source: "MODELED_HISTORICAL" as const,
      capitalEligible: false as const,
      cycleId: context.cycle.cycleId,
      accountingFrontierContentDigestHex: accounting.frontierContentDigestHex,
      reconciledExposureNotional: accounting.accounting.reconciledExposureNotional,
      exposureLimitNotional: accounting.accounting.exposureLimitNotional,
      status,
      reasonCodes: guardianReasons,
    }) as HistoricalModeledGuardianReceiptV2;
    guardianByCycle.set(context.cycle.cycleId, guardian);
    await input.persistEvidence(guardian);
    return {
      ...(riskByDecision.get(context.proposal.decisionContentDigestHex)
        ? { risk: (() => { const receipt = riskByDecision.get(context.proposal.decisionContentDigestHex)!;
          return { status: receipt.verdict === "APPROVE" ? "APPROVE" as const : "VETO" as const,
            reasonCodes: receipt.reasonCodes, verdictContentDigestHex: receipt.contentDigestHex,
            allowanceContentDigestHex: receipt.riskAllowanceContentDigestHex }; })() }
        : {}),
      accounting: { status: observed.accountingAdvanced ? "APPLIED" : "UNCHANGED", reasonCodes: [], frontierContentDigestHex: accounting.frontierContentDigestHex },
      guardian: { status: guardian.status, reasonCodes: guardian.reasonCodes, assessmentContentDigestHex: guardian.contentDigestHex },
      learning: await input.learningProjection(context),
      execution: observed.execution,
      observedExecutionEffects: observed.observedExecutionEffects,
    };
  };

  return Object.freeze({ decisionCapitalAuthorityV2, modeledExit, resolveLedgerProjection,
    portfolioLifecycleForCycle: (cycleId: string) => portfolioByCycle.get(cycleId) ?? null,
    modeledRealityForCycle: (cycleId: string) => realityByCycle.get(cycleId) ?? null });
}
