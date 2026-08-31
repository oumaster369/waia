import {
  issueForecastRuntimeV2,
  type ForecastRuntimeInputV2,
  type ForecastRuntimeOutcomeV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import {
  runDecisionCapitalAuthorityV2,
  type CanonicalDecisionCapitalAuthorityV2Deps,
  type DecisionCapitalAuthorityV2Result,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import { assertFhvV2PostgresSchemaPreflight } from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";
import {
  appendHistoricalSimulationReasonLedgerV2,
  type HistoricalSimulationReasonLedgerV2,
  type HistoricalSimulationReasonLedgerV2Draft,
} from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { evaluateDecisionEconomicsV2ForSemanticMode } from "@/lib/trader/intelligence/decision-economics/decision-economic-evaluator-v2";
import type { DecisionEconomicEvaluationInputV2 } from "@/lib/trader/intelligence/decision-economics/dee660-decision-evaluation-contract-v1";
import type { HistoricalDatasetMembershipV2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";

export const HISTORICAL_SIMULATION_V2_SCHEMA_VERSION =
  "waia.trader.historical_simulation.v2" as const;

export type HistoricalSimulationV2Cycle = Readonly<{
  cycleId: string;
  observedAt: string;
  symbol: string;
  referencePrice: string;
  datasetMembership: HistoricalDatasetMembershipV2;
}>;

export type HistoricalKnowledgeSnapshotV2 = Readonly<{
  asOf: string;
  contentDigestHex: string;
}>;

export type HistoricalMaturedClosureV2 = Readonly<{
  forecastAuthorityContentDigestHex: string;
  maturedAt: string;
  outcomeContentDigestHex: string;
}>;

export type HistoricalKnowledgePortV2 = Readonly<{
  /** Returns only state whose evidence was available at or before asOf. */
  snapshotAsOf(asOf: string): Promise<HistoricalKnowledgeSnapshotV2>;
  /** Must never return a closure with maturedAt >= strictlyBefore. */
  closeMaturedForecasts(strictlyBefore: string): Promise<readonly HistoricalMaturedClosureV2[]>;
  applyMaturedClosures(input: Readonly<{
    strictlyBefore: string;
    closures: readonly HistoricalMaturedClosureV2[];
  }>): Promise<HistoricalKnowledgeSnapshotV2>;
}>;

export type HistoricalSimulationV2Evidence = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_V2_SCHEMA_VERSION;
  source: "MODELED_HISTORICAL_EXECUTION";
  capitalEligible: false;
  cycleId: string;
  observedAt: string;
  symbol: string;
  knowledgeBeforeDigestHex: string;
  knowledgeAfterClosureDigestHex: string;
  maturedClosureDigestsHex: readonly string[];
  forecastStatus: ForecastRuntimeOutcomeV2["status"];
  forecastAuthorityContentDigestHex: string | null;
  action: "ENTER_LONG" | "CASH" | "REDUCE" | "CLOSE";
  terminalStage: "FORECAST" | "DECISION" | "RISK" | "EXECUTION";
  reasonCodes: readonly string[];
  decisionContentDigestHex: string | null;
  riskVerdictContentDigestHex: string | null;
  riskAllowanceContentDigestHex: string | null;
  executionPlanContentDigestHex: string | null;
  executionAttemptContentDigestHex: string | null;
}>;

export type HistoricalPortfolioProposalV2 = Readonly<{
  decisionSemanticMode: "HISTORICAL";
  action: "ENTER_LONG" | "CASH" | "REDUCE" | "CLOSE";
  quantity: string | null;
  proposalContentDigestHex: string;
  reasonCodes: readonly string[];
  decisionContentDigestHex: string;
  whyNotCashReceiptDigestHex: string;
  evLower: string | null;
  evBase: string | null;
  evUpper: string | null;
}>;

/** Canonical ENTER_LONG/CASH resolver; callers may layer REDUCE/CLOSE from portfolio/guardian state. */
export function createHistoricalDecisionEconomicsPortfolioResolverV2(input: Readonly<{
  buildEvaluationInput(context: Readonly<{
    cycle: HistoricalSimulationV2Cycle;
    forecast: Extract<ForecastRuntimeOutcomeV2, { status: "FORECAST_AUTHORIZED" }>;
    knowledge: HistoricalKnowledgeSnapshotV2;
  }>): Promise<DecisionEconomicEvaluationInputV2>;
}>): RunHistoricalSimulationV2Input["resolvePortfolioProposal"] {
  return async (context) => {
    if (context.forecast.status !== "FORECAST_AUTHORIZED") {
      const body = {
        cycleId: context.cycle.cycleId,
        action: "CASH" as const,
        reasonCodes: [context.forecast.reason],
        forecastContentDigestHex: context.forecast.contentDigestHex,
      };
      const contentDigestHex = computeSemanticSha256Hex(body);
      return {
        decisionSemanticMode: "HISTORICAL",
        action: "CASH",
        quantity: null,
        proposalContentDigestHex: contentDigestHex,
        reasonCodes: body.reasonCodes,
        decisionContentDigestHex: contentDigestHex,
        whyNotCashReceiptDigestHex: contentDigestHex,
        evLower: null,
        evBase: null,
        evUpper: null,
      };
    }
    const result = evaluateDecisionEconomicsV2ForSemanticMode(
      await input.buildEvaluationInput({ ...context, forecast: context.forecast }),
      "HISTORICAL",
    );
    const quantity = result.economicAdmissibleSizeSet?.exactQuantities[0] ?? null;
    const proposalBody = {
      cycleId: context.cycle.cycleId,
      action: result.action,
      quantity,
      decisionReceiptContentDigestHex: result.decisionReceipt.contentDigestHex,
      knowledgeContentDigestHex: context.knowledge.contentDigestHex,
    };
    return {
      decisionSemanticMode: "HISTORICAL",
      action: result.action,
      quantity,
      proposalContentDigestHex: computeSemanticSha256Hex(proposalBody),
      reasonCodes: result.receipt.reasonCodes,
      decisionContentDigestHex: result.decisionReceipt.contentDigestHex,
      whyNotCashReceiptDigestHex: result.receipt.contentDigestHex,
      evLower: result.evRange?.evLowerScale8 ?? null,
      evBase: result.evRange?.evBaseScale8 ?? null,
      evUpper: result.evRange?.evUpperScale8 ?? null,
    };
  };
}

type LedgerProjection = Pick<
  HistoricalSimulationReasonLedgerV2Draft,
  "accounting" | "guardian" | "learning"
> & Readonly<{
  execution?: HistoricalSimulationReasonLedgerV2Draft["execution"];
  observedExecutionEffects?: HistoricalSimulationReasonLedgerV2Draft["observedExecutionEffects"];
}>;

export type HistoricalModeledExitV2 = Readonly<{
  risk: HistoricalSimulationReasonLedgerV2Draft["risk"];
  execution: HistoricalSimulationReasonLedgerV2Draft["execution"];
}>;

export type RunHistoricalSimulationV2Input = Readonly<{
  organizationId: string;
  accountId: string;
  runId: string;
  split: "development" | "walk_forward";
  authority: "HISTORICAL_SIMULATION_V2";
  cycles: readonly HistoricalSimulationV2Cycle[];
  defaultQuantity: string;
  knowledge: HistoricalKnowledgePortV2;
  resolveForecastInput(input: Readonly<{
    cycle: HistoricalSimulationV2Cycle;
    knowledge: HistoricalKnowledgeSnapshotV2;
  }>): Promise<ForecastRuntimeInputV2>;
  /** Persists the issuance and advances future-only closure state after current PIT issuance. */
  forecastLifecycleSink?: (input: Readonly<{
    cycle: HistoricalSimulationV2Cycle;
    forecast: ForecastRuntimeOutcomeV2;
  }>) => Promise<void>;
  decisionCapitalAuthorityV2: CanonicalDecisionCapitalAuthorityV2Deps;
  /** Must call Decision Economics V2 in semantic mode HISTORICAL and inspect current portfolio. */
  resolvePortfolioProposal(input: Readonly<{
    cycle: HistoricalSimulationV2Cycle;
    forecast: ForecastRuntimeOutcomeV2;
    knowledge: HistoricalKnowledgeSnapshotV2;
  }>): Promise<HistoricalPortfolioProposalV2>;
  /** Explicit, capital-isolated exit engine; required for REDUCE/CLOSE. */
  modeledExit?: Readonly<{
    execute(input: Readonly<{
      cycle: HistoricalSimulationV2Cycle;
      proposal: HistoricalPortfolioProposalV2;
    }>): Promise<HistoricalModeledExitV2>;
  }>;
  /** Exact accounting/guardian/future-learning projections after this cycle. */
  resolveLedgerProjection(input: Readonly<{
    cycle: HistoricalSimulationV2Cycle;
    proposal: HistoricalPortfolioProposalV2;
    knowledgeBefore: HistoricalKnowledgeSnapshotV2;
    knowledgeAfterClosure: HistoricalKnowledgeSnapshotV2;
    closures: readonly HistoricalMaturedClosureV2[];
  }>): Promise<LedgerProjection>;
  /** Production default is the exact schema/hash/table preflight; injection exists for isolated tests. */
  postgresSchemaPreflight?: () => Promise<void>;
  evidenceSink?: (evidence: HistoricalSimulationV2Evidence) => Promise<void> | void;
  /** Durable append-only sink. Called only after the entry is hash-linked and complete. */
  reasonLedgerSink?: (entry: HistoricalSimulationReasonLedgerV2) => Promise<void> | void;
}>;

export type RunHistoricalSimulationV2Result = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_V2_SCHEMA_VERSION;
  cycleCount: number;
  enterLongCount: number;
  cashCount: number;
  reduceCount: number;
  closeCount: number;
  evidence: readonly HistoricalSimulationV2Evidence[];
  reasonLedger: readonly HistoricalSimulationReasonLedgerV2[];
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function requireIdentity(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`HISTORICAL_SIMULATION_V2_INVALID:${field}`);
}

function requireChronology(cycles: readonly HistoricalSimulationV2Cycle[]): void {
  let previous = Number.NEGATIVE_INFINITY;
  for (const cycle of cycles) {
    requireIdentity(cycle.cycleId, "cycleId");
    requireIdentity(cycle.symbol, "symbol");
    if (!DIGEST.test(cycle.datasetMembership.contentDigestHex)) {
      throw new Error("HISTORICAL_SIMULATION_V2_INVALID:datasetMembership");
    }
    const epoch = Date.parse(cycle.observedAt);
    if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== cycle.observedAt) {
      throw new Error("HISTORICAL_SIMULATION_V2_INVALID:observedAt");
    }
    if (epoch <= previous) throw new Error("HISTORICAL_SIMULATION_V2_INVALID:chronology");
    previous = epoch;
  }
}

function requireKnowledgeSnapshot(
  snapshot: HistoricalKnowledgeSnapshotV2,
  expectedAsOf: string,
): void {
  if (snapshot.asOf !== expectedAsOf || !DIGEST.test(snapshot.contentDigestHex)) {
    throw new Error("HISTORICAL_SIMULATION_V2_PIT_VIOLATION:knowledgeSnapshot");
  }
}

function projectEvidence(input: {
  cycle: HistoricalSimulationV2Cycle;
  before: HistoricalKnowledgeSnapshotV2;
  after: HistoricalKnowledgeSnapshotV2;
  closures: readonly HistoricalMaturedClosureV2[];
  forecast: ForecastRuntimeOutcomeV2;
  authority: DecisionCapitalAuthorityV2Result;
  proposal: HistoricalPortfolioProposalV2;
  exit: HistoricalModeledExitV2 | null;
}): HistoricalSimulationV2Evidence {
  const { cycle, before, after, closures, forecast, authority, proposal, exit } = input;
  if (authority.status === "NO_TRADE") {
    return Object.freeze({
      schemaVersion: HISTORICAL_SIMULATION_V2_SCHEMA_VERSION,
      source: "MODELED_HISTORICAL_EXECUTION" as const,
      capitalEligible: false as const,
      cycleId: cycle.cycleId,
      observedAt: cycle.observedAt,
      symbol: cycle.symbol,
      knowledgeBeforeDigestHex: before.contentDigestHex,
      knowledgeAfterClosureDigestHex: after.contentDigestHex,
      maturedClosureDigestsHex: Object.freeze(closures.map((value) => value.outcomeContentDigestHex)),
      forecastStatus: forecast.status,
      forecastAuthorityContentDigestHex:
        forecast.status === "FORECAST_AUTHORIZED" ? forecast.authority.contentDigestHex : null,
      action:
        proposal.action === "REDUCE" || proposal.action === "CLOSE"
          ? proposal.action
          : "CASH",
      terminalStage:
        proposal.action === "REDUCE" || proposal.action === "CLOSE" ? "EXECUTION" : authority.stage,
      reasonCodes: Object.freeze(
        exit ? [...exit.risk.reasonCodes, ...exit.execution.reasonCodes] : [...authority.reasonCodes],
      ),
      decisionContentDigestHex: authority.decisionContentDigestHex,
      riskVerdictContentDigestHex: exit?.risk.verdictContentDigestHex ?? null,
      riskAllowanceContentDigestHex: exit?.risk.allowanceContentDigestHex ?? null,
      executionPlanContentDigestHex: exit?.execution.planContentDigestHex ?? null,
      executionAttemptContentDigestHex: exit?.execution.attemptContentDigestHex ?? null,
    });
  }
  return Object.freeze({
    schemaVersion: HISTORICAL_SIMULATION_V2_SCHEMA_VERSION,
    source: "MODELED_HISTORICAL_EXECUTION" as const,
    capitalEligible: false as const,
    cycleId: cycle.cycleId,
    observedAt: cycle.observedAt,
    symbol: cycle.symbol,
    knowledgeBeforeDigestHex: before.contentDigestHex,
    knowledgeAfterClosureDigestHex: after.contentDigestHex,
    maturedClosureDigestsHex: Object.freeze(closures.map((value) => value.outcomeContentDigestHex)),
    forecastStatus: forecast.status,
    forecastAuthorityContentDigestHex:
      forecast.status === "FORECAST_AUTHORIZED" ? forecast.authority.contentDigestHex : null,
    action: proposal.action,
    terminalStage: "EXECUTION" as const,
    reasonCodes: Object.freeze([]),
    decisionContentDigestHex: authority.decision.contentDigestHex,
    riskVerdictContentDigestHex: authority.permission.riskVerdictContentDigestHex,
    riskAllowanceContentDigestHex: authority.permission.riskAllowanceContentDigestHex,
    executionPlanContentDigestHex: authority.execution.executionPlanContentDigestHex,
    executionAttemptContentDigestHex: authority.execution.executionAttemptContentDigestHex,
  });
}

/**
 * Capital-isolated V2 historical composition boundary. Canonical Reality V2 is deliberately
 * absent: simulated fills are evidence, never exchange/reality facts.
 */
export async function runHistoricalSimulationV2(
  input: RunHistoricalSimulationV2Input,
): Promise<RunHistoricalSimulationV2Result> {
  requireIdentity(input.organizationId, "organizationId");
  requireIdentity(input.accountId, "accountId");
  requireIdentity(input.runId, "runId");
  if (input.authority !== "HISTORICAL_SIMULATION_V2") {
    throw new Error("HISTORICAL_SIMULATION_V2_FORBIDDEN:authority");
  }
  if (input.split !== "development" && input.split !== "walk_forward") {
    throw new Error("HISTORICAL_SIMULATION_V2_FORBIDDEN:blindHoldout");
  }
  requireChronology(input.cycles);

  // This precedes authorization, evidence creation and every runtime stage.
  await (input.postgresSchemaPreflight ?? assertFhvV2PostgresSchemaPreflight)();

  const evidence: HistoricalSimulationV2Evidence[] = [];
  const reasonLedger: HistoricalSimulationReasonLedgerV2[] = [];
  for (const cycle of input.cycles) {
    const before = await input.knowledge.snapshotAsOf(cycle.observedAt);
    requireKnowledgeSnapshot(before, cycle.observedAt);
    const closures = await input.knowledge.closeMaturedForecasts(cycle.observedAt);
    for (const closure of closures) {
      if (
        Date.parse(closure.maturedAt) >= Date.parse(cycle.observedAt) ||
        !DIGEST.test(closure.forecastAuthorityContentDigestHex) ||
        !DIGEST.test(closure.outcomeContentDigestHex)
      ) {
        throw new Error("HISTORICAL_SIMULATION_V2_PIT_VIOLATION:futureClosure");
      }
    }
    const after = await input.knowledge.applyMaturedClosures({
      strictlyBefore: cycle.observedAt,
      closures,
    });
    requireKnowledgeSnapshot(after, cycle.observedAt);

    const forecastInput = await input.resolveForecastInput({ cycle, knowledge: after });
    const forecast = issueForecastRuntimeV2(forecastInput);
    await input.forecastLifecycleSink?.({ cycle, forecast });
    const proposal = await input.resolvePortfolioProposal({ cycle, forecast, knowledge: after });
    if (proposal.decisionSemanticMode !== "HISTORICAL" ||
        !DIGEST.test(proposal.proposalContentDigestHex) || !DIGEST.test(proposal.decisionContentDigestHex) ||
        !DIGEST.test(proposal.whyNotCashReceiptDigestHex)) {
      throw new Error("HISTORICAL_SIMULATION_V2_INVALID:portfolioProposalEvidence");
    }
    if (proposal.action !== "CASH" && (!proposal.quantity || Number(proposal.quantity) <= 0)) {
      throw new Error("HISTORICAL_SIMULATION_V2_INVALID:portfolioProposalQuantity");
    }

    let authority: DecisionCapitalAuthorityV2Result;
    let exit: HistoricalModeledExitV2 | null = null;
    if (proposal.action === "ENTER_LONG") {
      authority = await runDecisionCapitalAuthorityV2(input.decisionCapitalAuthorityV2, {
      organizationId: input.organizationId,
      accountId: input.accountId,
      cycleId: cycle.cycleId,
      symbol: cycle.symbol,
      referencePrice: cycle.referencePrice,
      executionMode: "historical",
      forecastOutcome: forecast,
      proposal: {
        action: "ENTER_LONG",
        quantity: proposal.quantity!,
        strategySignalId: null,
      },
      });
    } else if (proposal.action === "REDUCE" || proposal.action === "CLOSE") {
      if (!input.modeledExit) throw new Error("HISTORICAL_SIMULATION_V2_FORBIDDEN:exitPortMissing");
      exit = await input.modeledExit.execute({ cycle, proposal });
      authority = {
        schemaVersion: "waia.trader.decision_capital_authority.v2",
        status: "NO_TRADE",
        stage: "DECISION",
        reasonCodes: ["ENTRY_AUTHORITY_NOT_APPLICABLE_TO_EXIT"],
        decisionContentDigestHex: proposal.decisionContentDigestHex,
      };
    } else {
      authority = {
        schemaVersion: "waia.trader.decision_capital_authority.v2",
        status: "NO_TRADE",
        stage: forecast.status === "FORECAST_AUTHORIZED" ? "DECISION" : "FORECAST",
        reasonCodes: proposal.reasonCodes.length > 0 ? proposal.reasonCodes : ["CASH_SELECTED"],
        decisionContentDigestHex: proposal.decisionContentDigestHex,
      };
    }
    const row = projectEvidence({ cycle, before, after, closures, forecast, authority, proposal, exit });
    evidence.push(row);
    await input.evidenceSink?.(row);

    const projection = await input.resolveLedgerProjection({
      cycle,
      proposal,
      knowledgeBefore: before,
      knowledgeAfterClosure: after,
      closures,
    });
    const authorityExecution = authority.status === "EXECUTION_BOUND" ? authority : null;
    const ledgerEntry = appendHistoricalSimulationReasonLedgerV2(reasonLedger.at(-1) ?? null, {
      organizationId: input.organizationId,
      runId: input.runId,
      cycleId: cycle.cycleId,
      symbol: cycle.symbol,
      partition: input.split === "development" ? "DEVELOPMENT" : "WALK_FORWARD",
      replayBarClosedAtUtc: cycle.observedAt,
      datasetMembership: cycle.datasetMembership,
      forecast: forecast.status === "FORECAST_AUTHORIZED"
        ? { status: "AUTHORIZED", reasonCodes: [], authorityContentDigestHex: forecast.authority.contentDigestHex }
        : { status: "NON_ACTIONABLE", reasonCodes: [forecast.reason], authorityContentDigestHex: null },
      decision: {
        status: proposal.action,
        reasonCodes: proposal.action === "CASH" ? proposal.reasonCodes : [],
        decisionContentDigestHex: proposal.decisionContentDigestHex,
        whyNotCashReceiptDigestHex: proposal.whyNotCashReceiptDigestHex,
        evLower: proposal.evLower,
        evBase: proposal.evBase,
        evUpper: proposal.evUpper,
      },
      portfolio: {
        status: proposal.action === "CASH" ? "NO_PROPOSAL" : "PROPOSED",
        reasonCodes: proposal.action === "CASH" ? proposal.reasonCodes : [],
        proposalContentDigestHex: proposal.proposalContentDigestHex,
      },
      risk: exit?.risk ?? (authorityExecution
        ? {
            status: authorityExecution.permission.approvedQualifiedQuantity === authorityExecution.decision.qualifiedQuantity ? "APPROVE" : "RESIZE",
            reasonCodes: [],
            verdictContentDigestHex: authorityExecution.permission.riskVerdictContentDigestHex,
            allowanceContentDigestHex: authorityExecution.permission.riskAllowanceContentDigestHex,
          }
        : {
            status: authority.status === "NO_TRADE" && authority.stage === "RISK" ? "VETO" : "NOT_EVALUATED",
            reasonCodes: authority.status === "NO_TRADE" && authority.stage === "RISK" ? authority.reasonCodes : ["RISK_NOT_EVALUATED"],
            verdictContentDigestHex: null,
            allowanceContentDigestHex: null,
          }),
      execution: projection.execution ?? exit?.execution ?? (authorityExecution
        ? {
            status: "COMMITTED",
            reasonCodes: [],
            planContentDigestHex: authorityExecution.execution.executionPlanContentDigestHex,
            attemptContentDigestHex: authorityExecution.execution.executionAttemptContentDigestHex,
            reportContentDigestHex: null,
            fillContentDigestHexes: [],
          }
        : {
            status: "NOT_DISPATCHED",
            reasonCodes: ["EXECUTION_NOT_DISPATCHED"],
            planContentDigestHex: null,
            attemptContentDigestHex: null,
            reportContentDigestHex: null,
            fillContentDigestHexes: [],
          }),
      observedExecutionEffects: projection.observedExecutionEffects ?? [],
      accounting: projection.accounting,
      guardian: projection.guardian,
      learning: projection.learning,
    });
    reasonLedger.push(ledgerEntry);
    await input.reasonLedgerSink?.(ledgerEntry);
  }

  const enterLongCount = evidence.filter((row) => row.action === "ENTER_LONG").length;
  const cashCount = evidence.filter((row) => row.action === "CASH").length;
  return Object.freeze({
    schemaVersion: HISTORICAL_SIMULATION_V2_SCHEMA_VERSION,
    cycleCount: evidence.length,
    enterLongCount,
    cashCount,
    reduceCount: evidence.filter((row) => row.action === "REDUCE").length,
    closeCount: evidence.filter((row) => row.action === "CLOSE").length,
    evidence: Object.freeze(evidence),
    reasonLedger: Object.freeze(reasonLedger),
  });
}
