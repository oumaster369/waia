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
  validateHistoricalSimulationReasonLedgerV2,
  type HistoricalSimulationReasonLedgerV2,
  type HistoricalSimulationReasonLedgerV2Draft,
} from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { evaluateDecisionEconomicsV2ForSemanticMode } from "@/lib/trader/intelligence/decision-economics/decision-economic-evaluator-v2";
import type { DecisionEvaluationReceiptV1, WhyNotCashReceiptV2 } from
  "@/lib/trader/intelligence/decision-economics/dee660-why-not-cash-receipt-v2";
import type { DecisionEconomicEvaluationInputV2 } from "@/lib/trader/intelligence/decision-economics/dee660-decision-evaluation-contract-v1";
import type { HistoricalDatasetMembershipV2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import type { DecisionStageOutcomeV2, DecisionQualificationRequestV2 } from
  "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import { prepareHistoricalFutureOnlyForecastV2 } from
  "@/lib/trader/historical-simulation-v2/future-only-learning-v2";

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
  /** Exact DEE-660 output, before the portfolio layer applies position-aware overrides. */
  rawDecisionAction: "ENTER_LONG" | "CASH";
  rawDecisionReasonCodes: readonly string[];
  action: "ENTER_LONG" | "CASH" | "REDUCE" | "CLOSE";
  quantity: string | null;
  proposalContentDigestHex: string;
  /** Portfolio-only reasons; never substituted for the raw Decision explanation. */
  portfolioReasonCodes: readonly string[];
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
        rawDecisionAction: "CASH",
        rawDecisionReasonCodes: body.reasonCodes,
        action: "CASH",
        quantity: null,
        proposalContentDigestHex: contentDigestHex,
        portfolioReasonCodes: ["HISTORICAL_PORTFOLIO_RAW_DECISION_CASH"],
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
      rawDecisionAction: result.action,
      rawDecisionReasonCodes: result.receipt.reasonCodes,
      action: result.action,
      quantity,
      proposalContentDigestHex: computeSemanticSha256Hex(proposalBody),
      portfolioReasonCodes: result.action === "CASH"
        ? ["HISTORICAL_PORTFOLIO_RAW_DECISION_CASH"] : [],
      reasonCodes: result.receipt.reasonCodes,
      decisionContentDigestHex: result.decisionReceipt.contentDigestHex,
      whyNotCashReceiptDigestHex: result.receipt.contentDigestHex,
      evLower: result.evRange?.evLowerScale8 ?? null,
      evBase: result.evRange?.evBaseScale8 ?? null,
      evUpper: result.evRange?.evUpperScale8 ?? null,
    };
  };
}

/** One exact DEE-660 evaluation feeds both portfolio selection and Decision V2 capital admission. */
export function createHistoricalDecisionEconomicsCapitalCoordinatorV2(input: Readonly<{
  organizationId: string; accountId: string;
  buildEvaluationInput(context: Readonly<{ cycle: HistoricalSimulationV2Cycle;
    forecast: Extract<ForecastRuntimeOutcomeV2, { status: "FORECAST_AUTHORIZED" }>;
    knowledge: HistoricalKnowledgeSnapshotV2 }>): Promise<DecisionEconomicEvaluationInputV2>;
}>): Readonly<{ resolvePortfolioProposal: RunHistoricalSimulationV2Input["resolvePortfolioProposal"];
  decide(request: DecisionQualificationRequestV2): Promise<DecisionStageOutcomeV2>;
  takeDecisionEvidence(cycleId: string, portfolioAction?: "ENTER_LONG" | "CASH" | "REDUCE" | "CLOSE"):
    Readonly<{ decisionReceipt: DecisionEvaluationReceiptV1; whyNotCashReceipt: WhyNotCashReceiptV2 }> }> {
  const evaluations = new Map<string, Readonly<{ result: ReturnType<typeof evaluateDecisionEconomicsV2ForSemanticMode>;
    binding: Readonly<{ organizationId: string; accountId: string; cycleId: string; symbol: string;
      referencePrice: string; forecastAuthorityContentDigestHex: string; action: "ENTER_LONG" | "CASH";
      quantity: string | null; decisionContentDigestHex: string; whyNotCashReceiptDigestHex: string }> }>>();
  const completedEvidence = new Map<string, Readonly<{ decisionReceipt: DecisionEvaluationReceiptV1;
    whyNotCashReceipt: WhyNotCashReceiptV2 }>>();
  const resolvePortfolioProposal: RunHistoricalSimulationV2Input["resolvePortfolioProposal"] = async (context) => {
    if (context.forecast.status !== "FORECAST_AUTHORIZED") {
      return createHistoricalDecisionEconomicsPortfolioResolverV2(input)(context);
    }
    const result = evaluateDecisionEconomicsV2ForSemanticMode(await input.buildEvaluationInput({
      ...context, forecast: context.forecast }), "HISTORICAL");
    const quantity = result.economicAdmissibleSizeSet?.exactQuantities[0] ?? null;
    if (evaluations.has(context.cycle.cycleId)) {
      throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DUPLICATE_DECISION_EVALUATION");
    }
    evaluations.set(context.cycle.cycleId, Object.freeze({ result, binding: Object.freeze({
      organizationId: input.organizationId, accountId: input.accountId, cycleId: context.cycle.cycleId,
      symbol: context.cycle.symbol, referencePrice: context.cycle.referencePrice,
      forecastAuthorityContentDigestHex: context.forecast.authority.contentDigestHex,
      action: result.action, quantity, decisionContentDigestHex: result.decisionReceipt.contentDigestHex,
      whyNotCashReceiptDigestHex: result.receipt.contentDigestHex }) }));
    return Object.freeze({ decisionSemanticMode: "HISTORICAL" as const,
      rawDecisionAction: result.action, rawDecisionReasonCodes: result.receipt.reasonCodes,
      action: result.action, quantity,
      proposalContentDigestHex: computeSemanticSha256Hex({ cycleId: context.cycle.cycleId, action: result.action,
        quantity, decisionReceiptContentDigestHex: result.decisionReceipt.contentDigestHex,
        knowledgeContentDigestHex: context.knowledge.contentDigestHex }),
      portfolioReasonCodes: result.action === "CASH"
        ? ["HISTORICAL_PORTFOLIO_RAW_DECISION_CASH"] : [],
      reasonCodes: result.receipt.reasonCodes,
      decisionContentDigestHex: result.decisionReceipt.contentDigestHex,
      whyNotCashReceiptDigestHex: result.receipt.contentDigestHex,
      evLower: result.evRange?.evLowerScale8 ?? null, evBase: result.evRange?.evBaseScale8 ?? null,
      evUpper: result.evRange?.evUpperScale8 ?? null });
  };
  return Object.freeze({ resolvePortfolioProposal,
    takeDecisionEvidence(cycleId, portfolioAction) {
      let evidence = completedEvidence.get(cycleId);
      if (!evidence) {
        const pending = evaluations.get(cycleId);
        const portfolioOverride = (pending?.binding.action === "CASH" &&
          (portfolioAction === undefined || portfolioAction === "CASH" || portfolioAction === "CLOSE")) ||
          (pending?.binding.action === "ENTER_LONG" && portfolioAction === "CASH");
        if (pending && portfolioOverride) {
          evidence = Object.freeze({ decisionReceipt: pending.result.decisionReceipt,
            whyNotCashReceipt: pending.result.receipt });
          evaluations.delete(cycleId);
        }
      }
      if (!evidence) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DECISION_EVIDENCE_UNAVAILABLE");
      completedEvidence.delete(cycleId);
      return evidence;
    },
    async decide(request): Promise<DecisionStageOutcomeV2> {
      const stored = evaluations.get(request.cycleId); const binding = stored?.binding; const result = stored?.result;
      if (!result || !binding || binding.organizationId !== request.organizationId || binding.accountId !== request.accountId ||
          binding.cycleId !== request.cycleId || binding.symbol !== request.symbol ||
          binding.referencePrice !== request.referencePrice || binding.action !== request.proposal.action ||
          binding.forecastAuthorityContentDigestHex !== request.forecastOutcome.authority.contentDigestHex ||
          binding.quantity !== request.proposal.quantity ||
          binding.decisionContentDigestHex !== result.decisionReceipt.contentDigestHex ||
          binding.whyNotCashReceiptDigestHex !== result.receipt.contentDigestHex) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DECISION_COORDINATOR_BINDING");
      }
      evaluations.delete(request.cycleId);
      if (completedEvidence.has(request.cycleId)) {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DUPLICATE_DECISION_EVIDENCE");
      }
      completedEvidence.set(request.cycleId, Object.freeze({ decisionReceipt: result.decisionReceipt,
        whyNotCashReceipt: result.receipt }));
      if (!result.decisionActionable || !result.evRange || !result.economicAdmissibleSizeSet) {
        return Object.freeze({ status: "NO_TRADE", decisionId: deterministicExecutionUuidV2("risk-event", {
          kind: "decision", cycleId: request.cycleId, digest: result.decisionReceipt.contentDigestHex }),
        decisionContentDigestHex: result.decisionReceipt.contentDigestHex,
        forecastAuthorityContentDigestHex: request.forecastOutcome.authority.contentDigestHex,
        reasonCodes: result.receipt.reasonCodes });
      }
      return Object.freeze({ status: "ACTIONABLE", decision: Object.freeze({
        decisionId: deterministicExecutionUuidV2("risk-event", { kind: "decision", cycleId: request.cycleId,
          digest: result.decisionReceipt.contentDigestHex }), semanticDigestHex: result.receipt.contentDigestHex,
        contentDigestHex: result.decisionReceipt.contentDigestHex,
        forecastAuthorityContentDigestHex: request.forecastOutcome.authority.contentDigestHex,
        action: "ENTER_LONG", evLower: result.evRange.evLowerScale8, evBase: result.evRange.evBaseScale8,
        evUpper: result.evRange.evUpperScale8, economicSizeSetId: result.economicAdmissibleSizeSet.sizeSetId,
        economicSizeSetDigestHex: result.economicAdmissibleSizeSet.contentDigestHex,
        qualifiedQuantity: request.proposal.quantity }) });
    } });
}

type LedgerProjection = Pick<
  HistoricalSimulationReasonLedgerV2Draft,
  "accounting" | "guardian" | "learning"
> & Readonly<{
  risk?: HistoricalSimulationReasonLedgerV2Draft["risk"];
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
    forecastInput: ForecastRuntimeInputV2;
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
  /** Internal durable resume seed. Production callers must load this from the validated 0188 cursor/ledger. */
  previousReasonLedger?: HistoricalSimulationReasonLedgerV2 | null;
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
  let previousReasonLedger = input.previousReasonLedger ?? null;
  if (previousReasonLedger) {
    validateHistoricalSimulationReasonLedgerV2(previousReasonLedger);
    if (previousReasonLedger.organizationId !== input.organizationId || previousReasonLedger.accountId !== input.accountId ||
        previousReasonLedger.runId !== input.runId || previousReasonLedger.partition !==
          (input.split === "development" ? "DEVELOPMENT" : "WALK_FORWARD")) {
      throw new Error("HISTORICAL_SIMULATION_V2_FORBIDDEN:resumeLedgerScope");
    }
  }
  for (const cycle of input.cycles) {
    const prepared = await prepareHistoricalFutureOnlyForecastV2({
      organizationId: input.organizationId,
      runId: input.runId,
      split: input.split,
      cycle,
      knowledge: input.knowledge,
      resolveForecastInput: input.resolveForecastInput,
    });
    const before = prepared.knowledgeBefore;
    const after = prepared.knowledgeAfterClosure;
    const closures = prepared.closures;
    const forecastInput = prepared.forecastInput;
    const forecast = issueForecastRuntimeV2(forecastInput);
    await input.forecastLifecycleSink?.({ cycle, forecast, forecastInput });
    const proposal = await input.resolvePortfolioProposal({ cycle, forecast, knowledge: after });
    if (proposal.decisionSemanticMode !== "HISTORICAL" ||
        (proposal.rawDecisionAction !== "ENTER_LONG" && proposal.rawDecisionAction !== "CASH") ||
        !Array.isArray(proposal.rawDecisionReasonCodes) || !Array.isArray(proposal.portfolioReasonCodes) ||
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
    const ledgerEntry = appendHistoricalSimulationReasonLedgerV2(previousReasonLedger, {
      organizationId: input.organizationId,
      accountId: input.accountId,
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
        status: proposal.rawDecisionAction,
        reasonCodes: proposal.rawDecisionReasonCodes,
        decisionContentDigestHex: proposal.decisionContentDigestHex,
        whyNotCashReceiptDigestHex: proposal.whyNotCashReceiptDigestHex,
        evLower: proposal.evLower,
        evBase: proposal.evBase,
        evUpper: proposal.evUpper,
      },
      portfolio: {
        status: proposal.action === "CASH" ? "NO_PROPOSAL" : "PROPOSED",
        action: proposal.action,
        reasonCodes: proposal.portfolioReasonCodes,
        proposalContentDigestHex: proposal.proposalContentDigestHex,
      },
      risk: projection.risk ?? exit?.risk ?? (authorityExecution
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
    previousReasonLedger = ledgerEntry;
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
