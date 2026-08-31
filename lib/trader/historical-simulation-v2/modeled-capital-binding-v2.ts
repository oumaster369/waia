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
import { calculateRiskAdmissionV2, type RiskAccountAccountingV2 } from "@/lib/trader/risk/v2/risk-admission-service-v2";
import type { ProtectivePostureV2 } from "@/lib/trader/risk/v2/protective-posture-v2";

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
  executionAttemptId: string;
  orderId: string;
  riskReceiptContentDigestHex: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  decisionBarIndex: number;
  acceptedAtUtc: string;
  contentDigestHex: string;
}>;

export type HistoricalModeledGuardianReceiptV2 = ModeledSource & Readonly<{
  schemaVersion: typeof HISTORICAL_MODELED_GUARDIAN_V2_SCHEMA;
  cycleId: string;
  accountingFrontierContentDigestHex: string;
  status: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";
  reasonCodes: readonly string[];
  contentDigestHex: string;
}>;

export type HistoricalModeledAccountingSnapshotV2 = Readonly<{
  frontierContentDigestHex: string;
  accounting: RiskAccountAccountingV2;
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
  decisionBarIndex(cycle: HistoricalSimulationV2Cycle): number;
  evaluateGuardian(input: Readonly<{
    cycle: HistoricalSimulationV2Cycle;
    accounting: HistoricalModeledAccountingSnapshotV2;
  }>): Promise<Readonly<{ status: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT"; reasonCodes: readonly string[] }>>;
  persistEvidence(evidence: PersistedModeledEvidence): Promise<void>;
  /** Advances eligible mock orders, applies modeled fills, and persists accounting. */
  advanceModeledExecution(cycle: HistoricalSimulationV2Cycle): Promise<void>;
  learningProjection: RunHistoricalSimulationV2Input["resolveLedgerProjection"] extends
    (input: infer I) => Promise<infer O> ? (input: I) => Promise<O extends { learning: infer L } ? L : never> : never;
}>;

export type HistoricalModeledCapitalBindingV2 = Readonly<{
  decisionCapitalAuthorityV2: CanonicalDecisionCapitalAuthorityV2Deps;
  modeledExit: NonNullable<RunHistoricalSimulationV2Input["modeledExit"]>;
  resolveLedgerProjection: RunHistoricalSimulationV2Input["resolveLedgerProjection"];
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function seal<T extends Record<string, unknown>>(body: T): Readonly<T & { contentDigestHex: string }> {
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`HISTORICAL_MODELED_BINDING_INVALID:${field}`);
}

function orderFromReceipt(input: {
  organizationId: string;
  accountId: string;
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
    riskDecisionId: input.decisionId,
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

  async function assessRisk(args: Readonly<{
    request: DecisionQualificationRequestV2;
    decision: DecisionAuthorityV2;
  }>): Promise<RiskStageOutcomeV2> {
    const cycle = input.resolveCycle(args.request.cycleId);
    if (cycle.symbol !== args.request.symbol || cycle.referencePrice !== args.request.referencePrice) {
      throw new Error("HISTORICAL_MODELED_BINDING_REFUSED:CYCLE_IDENTITY_MISMATCH");
    }
    const accounting = await input.loadAccounting(cycle);
    requireDigest(accounting.frontierContentDigestHex, "accountingFrontierContentDigestHex");
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
      posture: accounting.posture,
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
    const receipt = seal({
      schemaVersion: HISTORICAL_MODELED_EXECUTION_V2_SCHEMA,
      source: "MODELED_HISTORICAL" as const,
      capitalEligible: false as const,
      executionPlanId,
      executionAttemptId,
      orderId,
      riskReceiptContentDigestHex: risk.contentDigestHex,
      symbol: args.cycle.symbol,
      side: args.side,
      quantity: args.quantity,
      decisionBarIndex: input.decisionBarIndex(args.cycle),
      acceptedAtUtc: args.cycle.observedAt,
    }) as HistoricalModeledExecutionReceiptV2;
    const order = orderFromReceipt({
      organizationId: input.organizationId,
      accountId: input.accountId,
      decisionId: args.decisionId,
      allowanceId: args.allowanceId,
      receipt,
    });
    input.exchange.registerOrder(order, receipt.decisionBarIndex, Date.parse(receipt.acceptedAtUtc));
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
      const order = orderFromReceipt({ organizationId: input.organizationId, accountId: input.accountId, decisionId: decision.decisionId, allowanceId: permission.riskAllowanceId, receipt });
      return Object.freeze({
        decisionContentDigestHex: decision.contentDigestHex,
        riskAllowanceId: permission.riskAllowanceId,
        riskAllowanceContentDigestHex: permission.riskAllowanceContentDigestHex,
        riskAllowanceOrderBindingDigestHex: receipt.riskReceiptContentDigestHex,
        executionPlanId: receipt.executionPlanId,
        executionPlanContentDigestHex: receipt.contentDigestHex,
        executionAttemptId: receipt.executionAttemptId,
        executionAttemptContentDigestHex: receipt.contentDigestHex,
        submittedQuantity: receipt.quantity,
        execution: { status: "submitted" as const, order },
      });
    },
  };

  const modeledExit = {
    async execute({ cycle, proposal }: { cycle: HistoricalSimulationV2Cycle; proposal: HistoricalPortfolioProposalV2 }): Promise<HistoricalModeledExitV2> {
      const accounting = await input.loadAccounting(cycle);
      const risk = seal({
        schemaVersion: HISTORICAL_MODELED_RISK_V2_SCHEMA,
        source: "MODELED_HISTORICAL" as const,
        capitalEligible: false as const,
        riskVerdictId: deterministicExecutionUuidV2("risk-event", { kind: "exit-verdict", runId: input.runId, cycleId: cycle.cycleId, decisionContentDigestHex: proposal.decisionContentDigestHex }),
        riskAllowanceId: deterministicExecutionUuidV2("risk-event", { kind: "exit-allowance", runId: input.runId, cycleId: cycle.cycleId, decisionContentDigestHex: proposal.decisionContentDigestHex }),
        riskAllowanceContentDigestHex: computeSemanticSha256Hex({ schemaVersion: "waia.trader.historical_modeled_risk_allowance.v2", source: "MODELED_HISTORICAL", capitalEligible: false, runId: input.runId, cycleId: cycle.cycleId, decisionContentDigestHex: proposal.decisionContentDigestHex }),
        decisionContentDigestHex: proposal.decisionContentDigestHex,
        accountingFrontierContentDigestHex: accounting.frontierContentDigestHex,
        verdict: "APPROVE" as const,
        approvedQuantity: proposal.quantity,
        requestedReservationNotional: "0",
        remainingBeforeAdmissionNotional: "0",
        remainingAfterAdmissionNotional: "0",
        reasonCodes: Object.freeze(["STRICT_MODELED_EXPOSURE_REDUCTION"]),
      }) as HistoricalModeledRiskReceiptV2;
      riskByDecision.set(proposal.decisionContentDigestHex, risk);
      await input.persistEvidence(risk);
      const execution = await executeModeled({ cycle, decisionId: proposal.decisionContentDigestHex, decisionContentDigestHex: proposal.decisionContentDigestHex, allowanceId: risk.riskAllowanceId!, side: "sell", quantity: proposal.quantity! });
      return Object.freeze({
        risk: { status: "APPROVE", reasonCodes: [], verdictContentDigestHex: risk.contentDigestHex, allowanceContentDigestHex: risk.riskAllowanceContentDigestHex },
        execution: { status: "COMMITTED", reasonCodes: [], planContentDigestHex: execution.contentDigestHex, attemptContentDigestHex: execution.contentDigestHex, reportContentDigestHex: null, fillContentDigestHexes: [] },
      });
    },
  };

  const resolveLedgerProjection: RunHistoricalSimulationV2Input["resolveLedgerProjection"] = async (context) => {
    await input.advanceModeledExecution(context.cycle);
    const accounting = await input.loadAccounting(context.cycle);
    const evaluated = await input.evaluateGuardian({ cycle: context.cycle, accounting });
    const guardian = seal({
      schemaVersion: HISTORICAL_MODELED_GUARDIAN_V2_SCHEMA,
      source: "MODELED_HISTORICAL" as const,
      capitalEligible: false as const,
      cycleId: context.cycle.cycleId,
      accountingFrontierContentDigestHex: accounting.frontierContentDigestHex,
      status: evaluated.status,
      reasonCodes: Object.freeze([...evaluated.reasonCodes]),
    }) as HistoricalModeledGuardianReceiptV2;
    guardianByCycle.set(context.cycle.cycleId, guardian);
    await input.persistEvidence(guardian);
    return {
      accounting: { status: executionByCycle.has(context.cycle.cycleId) ? "APPLIED" : "UNCHANGED", reasonCodes: [], frontierContentDigestHex: accounting.frontierContentDigestHex },
      guardian: { status: guardian.status, reasonCodes: guardian.reasonCodes, assessmentContentDigestHex: guardian.contentDigestHex },
      learning: await input.learningProjection(context),
    };
  };

  return Object.freeze({ decisionCapitalAuthorityV2, modeledExit, resolveLedgerProjection });
}
