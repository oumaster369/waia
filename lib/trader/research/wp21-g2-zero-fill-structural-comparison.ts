import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
  HTR_HISTORICAL_COST_MODEL_DIGEST,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import type { Bar, EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import {
  createHtrInitialAccountRiskState,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const WP21_ZERO_FILL_STRUCTURAL_CANDIDATE_SCHEMA =
  "waia.trader.wp21.zero-fill-structural-candidate.v1" as const;

export const WP21_ZERO_FILL_STRUCTURAL_COMPARISON_SCHEMA =
  "waia.trader.wp21.zero-fill-structural-comparison.v1" as const;

export const WP21_BOUND_ZERO_FILL_FIXTURE_PATH =
  "tests/fixtures/trader/btcusdt-1m-mean-reversion.json" as const;

export const WP21_BOUND_ZERO_FILL_FIXTURE_SHA256 =
  "aca9b95b6962ee57215daa19f14f820d74df2efcabb2343f4bfe33ac07d49a6f" as const;

export type Wp21ZeroFillStrategyDecisionProjection = {
  decisionChainDigest: string;
  signalCount: number;
  primarySignalId: string | null;
};

export type Wp21ZeroFillPositionStateProjection = {
  openPositionCount: number;
  symbols: string[];
};

export type Wp21ZeroFillCycleProjection = {
  cycleIndex: number;
  cycleTimestamp: string;
  deterministicCycleId: string;
  strategyId: string;
  symbol: string;
  metricsSchemaVersion: string;
  signalIdentity: string | null;
  strategyDecision: Wp21ZeroFillStrategyDecisionProjection;
  tradingPermission: string;
  riskOutcome: string;
  orderIntentPresent: boolean;
  positionState: Wp21ZeroFillPositionStateProjection;
  accountGrossState: { equity: string; equityHwm: string; cash: string | null };
  guardianDecision: string | null;
  guardianReason: string | null;
  noFillCapitalState: {
    startingBalanceUsdt: string;
    endingBalanceUsdt: string;
    realizedPnl: string;
    unrealizedPnl: string;
  };
};

export type Wp21ZeroFillStructuralParentSemantic = {
  schemaVersion: string;
  parentGitSha: string;
  inputFixturePath: string;
  inputFixtureSha256: string;
  parentCostAuthority: {
    feesBps: "10";
    slippageBps: "5";
    costModelVersion: "waia.trader.cost-model.v1";
  };
  cycleCount: number;
  submittedOrders: number;
  acceptedOrders: number;
  filledOrders: number;
  cycles: Wp21ZeroFillCycleProjection[];
  metricsSchemaVersion: string;
  semanticResultDigest: string;
};

export type Wp21ZeroFillStructuralCandidateSemantic = {
  schemaVersion: typeof WP21_ZERO_FILL_STRUCTURAL_CANDIDATE_SCHEMA;
  inputFixturePath: typeof WP21_BOUND_ZERO_FILL_FIXTURE_PATH;
  inputFixtureSha256: string;
  candidateCostAuthority: {
    modelId: "htr-historical-execution-v1";
    schemaVersion: "waia.trader.historical-execution-model.v1";
    feeBps: "20";
    halfSpreadBps: "5";
    marketImpactBps: "10";
    costModelDigest: typeof HTR_HISTORICAL_COST_MODEL_DIGEST;
  };
  cycleCount: number;
  submittedOrders: number;
  acceptedOrders: number;
  filledOrders: number;
  cycles: Wp21ZeroFillCycleProjection[];
  metricsSchemaVersion: string;
  semanticResultDigest: string;
};

export type Wp21ZeroFillStructuralComparison = {
  schemaVersion: typeof WP21_ZERO_FILL_STRUCTURAL_COMPARISON_SCHEMA;
  parentSemanticResultDigest: string;
  candidateSemanticResultDigest: string;
  cycleCountMatch: boolean;
  signalDecisionParity: boolean;
  permissionParity: boolean;
  riskOutcomeParity: boolean;
  capitalParity: boolean;
  unexpectedSubmittedOrders: number;
  unexpectedFills: number;
  allowedMetadataDifference: "costAuthorityOnly";
  comparisonDigest: string;
};

export type Wp21ZeroFillStructuralSession = {
  deps: PaperCycleDeps;
  orderRepository: OrderRepository;
  historicalExecutionProfile: Awaited<
    ReturnType<typeof createInMemoryResearchBacktestSession>
  >["historicalExecutionProfile"];
  cleanup: () => void;
};

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function projectStrategyDecision(
  evaluation: EvaluationCycleResult,
): Wp21ZeroFillStrategyDecisionProjection {
  const decisionChain = evaluation.decisionChain ?? null;
  return {
    decisionChainDigest: sha256Utf8(canonicalJsonString(decisionChain)),
    signalCount: evaluation.signals.length,
    primarySignalId: evaluation.signal?.strategySignalId ?? null,
  };
}

function projectPositionState(): Wp21ZeroFillPositionStateProjection {
  return { openPositionCount: 0, symbols: [] };
}

function resolveCycleAccountGrossState(): {
  equity: string;
  equityHwm: string;
  cash: string | null;
} {
  const balance = HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;
  return { equity: balance, equityHwm: balance, cash: balance };
}

function resolveTradingPermission(cycle: {
  submitBlocked?: boolean;
  skipReason?: string | null;
}): string {
  if (cycle.submitBlocked) return "BLOCKED";
  if (cycle.skipReason) return "SKIPPED";
  return "PERMITTED";
}

function resolveRiskOutcome(cycle: {
  strategyExecutions: Array<{
    submitBlocked?: boolean;
    skipReason?: string | null;
    execution?: { status?: string | null } | null;
  }>;
}): string {
  for (const entry of cycle.strategyExecutions) {
    // A pre-risk fail-closed block (for example, information sufficiency) must
    // not be attributed to the risk layer. Only an explicit risk outcome is a
    // risk rejection; otherwise the no-fill lane preserves its parent risk
    // projection.
    if (entry.skipReason?.includes("risk")) return "RISK_REJECTED";
    if (entry.execution?.status === "rejected") return "RISK_REJECTED";
  }
  return "RISK_ACCEPTED";
}

function resolveGuardianFields(cycle: {
  htrGuardian?: {
    breachState?: string;
    reason?: { code?: string } | string | null;
  } | null;
  guardian?: { evaluations?: Array<{ decision?: string }> } | null;
}): { guardianDecision: string | null; guardianReason: string | null } {
  if (cycle.htrGuardian) {
    const reason =
      cycle.htrGuardian.reason == null
        ? null
        : typeof cycle.htrGuardian.reason === "string"
          ? cycle.htrGuardian.reason
          : (cycle.htrGuardian.reason.code ?? null);
    return {
      guardianDecision: cycle.htrGuardian.breachState ?? null,
      guardianReason: reason,
    };
  }
  if (cycle.guardian?.evaluations?.length) {
    return {
      guardianDecision: cycle.guardian.evaluations[0]?.decision ?? null,
      guardianReason: null,
    };
  }
  return { guardianDecision: null, guardianReason: null };
}

function countOrderMetrics(
  cycleResults: Array<{
    strategyExecutions: Array<{ execution?: { status?: string; order?: unknown } | null }>;
  }>,
): { submittedOrders: number; acceptedOrders: number; filledOrders: number } {
  let submittedOrders = 0;
  let acceptedOrders = 0;
  const filledOrders = 0;
  for (const cycle of cycleResults) {
    for (const entry of cycle.strategyExecutions) {
      const execution = entry.execution;
      if (!execution) continue;
      if (execution.status === "submitted" && execution.order) {
        submittedOrders += 1;
        acceptedOrders += 1;
      }
    }
  }
  return { submittedOrders, acceptedOrders, filledOrders };
}

function resolveOrderIntentPresent(cycle: {
  strategyExecutions: Array<{
    execution?: { order?: unknown; orderId?: string; status?: string } | null;
  }>;
}): boolean {
  return cycle.strategyExecutions.some((entry) => {
    const execution = entry.execution;
    if (!execution) return false;
    if (execution.status === "submitted" && execution.order) return true;
    if ("orderId" in execution && execution.orderId) return true;
    return false;
  });
}

function resolveSignalIdentity(cycle: {
  evaluation: {
    signals?: Array<{ strategySignalId?: string }>;
    signal?: { strategySignalId?: string } | null;
  };
}): string | null {
  return (
    cycle.evaluation.signal?.strategySignalId ??
    cycle.evaluation.signals?.[0]?.strategySignalId ??
    null
  );
}

function normalizeParentCycle(
  parentCycle: {
    cycleIndex: number;
    timestamp: string;
    cycleId: string;
    strategyId: string;
    signalIdentity: string | null;
    strategyDecision: Wp21ZeroFillStrategyDecisionProjection;
    tradingPermission: string;
    riskOutcome: string;
    orderIntentPresent: boolean;
    positionState: Wp21ZeroFillPositionStateProjection;
    accountGrossState: { equity: string; equityHwm: string; cash: string | null };
    guardianDecision: string | null;
    guardianReason: string | null;
    noFillCapitalState: {
      startingBalanceUsdt: string;
      endingBalanceUsdt: string;
      realizedPnl: string;
      unrealizedPnl: string;
    };
  },
  symbol: string,
  metricsSchemaVersion: string,
): Wp21ZeroFillCycleProjection {
  return {
    cycleIndex: parentCycle.cycleIndex,
    cycleTimestamp: parentCycle.timestamp,
    deterministicCycleId: parentCycle.cycleId,
    strategyId: parentCycle.strategyId,
    symbol,
    metricsSchemaVersion,
    signalIdentity: parentCycle.signalIdentity,
    strategyDecision: parentCycle.strategyDecision,
    tradingPermission: parentCycle.tradingPermission,
    riskOutcome: parentCycle.riskOutcome,
    orderIntentPresent: parentCycle.orderIntentPresent,
    positionState: parentCycle.positionState,
    accountGrossState: parentCycle.accountGrossState,
    guardianDecision: parentCycle.guardianDecision,
    guardianReason: parentCycle.guardianReason,
    noFillCapitalState: parentCycle.noFillCapitalState,
  };
}

export function loadWp21ZeroFillFixtureBars(
  fixturePath: string = WP21_BOUND_ZERO_FILL_FIXTURE_PATH,
  expectedSha256: string = WP21_BOUND_ZERO_FILL_FIXTURE_SHA256,
): Bar[] {
  const abs = path.isAbsolute(fixturePath) ? fixturePath : path.join(process.cwd(), fixturePath);
  const raw = readFileSync(abs, "utf8");
  const digest = sha256Utf8(raw);
  if (digest !== expectedSha256) {
    throw new Error("WP21_ZERO_FILL_FIXTURE_DIGEST_MISMATCH");
  }
  return (JSON.parse(raw) as { bars: Bar[] }).bars;
}

export async function createWp21ZeroFillStructuralSession(): Promise<Wp21ZeroFillStructuralSession> {
  const session = await createInMemoryResearchBacktestSession();
  return {
    deps: session.deps,
    orderRepository: session.orderRepository,
    historicalExecutionProfile: session.historicalExecutionProfile,
    cleanup: session.cleanup,
  };
}

export async function exportWp21ZeroFillStructuralCandidate(input: {
  context: OrgContext;
  strategyId?: string;
  strategyVersion?: string;
  metricsSchemaVersion:
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  session: Wp21ZeroFillStructuralSession;
  fixturePath?: string;
  fixtureSha256?: string;
}): Promise<Wp21ZeroFillStructuralCandidateSemantic> {
  const authority = createHtrHistoricalCostModelAuthorityV1();
  const costModel = costModelV1FromAuthority(authority);
  const fixturePath = input.fixturePath ?? WP21_BOUND_ZERO_FILL_FIXTURE_PATH;
  const fixtureSha256 = input.fixtureSha256 ?? WP21_BOUND_ZERO_FILL_FIXTURE_SHA256;
  const bars = loadWp21ZeroFillFixtureBars(fixturePath, fixtureSha256);
  const strategyId = input.strategyId ?? MEAN_REVERSION_V0;
  const strategyVersion = input.strategyVersion ?? "0.1.0";
  const session = input.session;
  const runId = "wp21-zero-fill-structural-candidate";
  const window = {
    start: new Date(bars[0]!.barOpenTime),
    end: new Date(bars.at(-1)!.barCloseTime),
  };
  const cycleIdPrefix = buildResearchValidationCycleIdPrefix(runId);
  const barSource = new HistoricalBarReplaySource({ bars, cycleIdPrefix });
  const portfolioContext =
    input.metricsSchemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
      ? buildResearchV2PortfolioContext(costModel)
      : undefined;

  const backtest = await runBacktest({
    context: input.context,
    barSource,
    deps: session.deps,
    orderRepository: session.orderRepository,
    accountKey: "wp21-zero-fill-structural-candidate",
    defaultQuantity: "0.01",
    costModel,
    strategySignalIds: [strategyId],
    strategyId,
    strategyVersion,
    regimeLabel: "AGGREGATE",
    datasetId: "dataset-wp21-zero-fill-structural-candidate",
    runId,
    split: "validation",
    window,
    accountState: createHtrInitialAccountRiskState(),
    exportedAt: window.end,
    activeStrategyIds: [strategyId],
    refreshAccountStateBetweenStrategies: true,
    portfolio: portfolioContext,
    markPrices: { marks: { [bars.at(-1)!.symbol]: bars.at(-1)!.close } },
    historicalExecutionProfile: session.historicalExecutionProfile,
  });

  const terminalEquity = HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;
  const periodRealizedPnl = backtest.regimeMetrics[0]?.periodRealizedPnl ?? "0";
  const orderMetrics = countOrderMetrics(backtest.cycleResults);
  const accountGross = resolveCycleAccountGrossState();
  const positionState = projectPositionState();
  const symbol = bars[0]?.symbol ?? "BTCUSDT";

  const cycles: Wp21ZeroFillCycleProjection[] = backtest.cycleResults.map((cycle, cycleIndex) => {
    const bar = bars[cycleIndex];
    const timestamp = bar?.barCloseTime ?? window.end.toISOString();
    const guardianFields = resolveGuardianFields(cycle);
    return {
      cycleIndex,
      cycleTimestamp: timestamp,
      deterministicCycleId: `${cycleIdPrefix}-${cycleIndex}`,
      strategyId,
      symbol,
      metricsSchemaVersion: input.metricsSchemaVersion,
      signalIdentity: resolveSignalIdentity(cycle),
      strategyDecision: projectStrategyDecision(cycle.evaluation),
      tradingPermission: resolveTradingPermission(cycle),
      riskOutcome: resolveRiskOutcome(cycle),
      orderIntentPresent: resolveOrderIntentPresent(cycle),
      positionState,
      accountGrossState: accountGross,
      guardianDecision: guardianFields.guardianDecision,
      guardianReason: guardianFields.guardianReason,
      noFillCapitalState: {
        startingBalanceUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        endingBalanceUsdt: terminalEquity,
        realizedPnl: periodRealizedPnl,
        unrealizedPnl: "0",
      },
    };
  });

  const semanticBody = {
    schemaVersion: WP21_ZERO_FILL_STRUCTURAL_CANDIDATE_SCHEMA,
    inputFixturePath: WP21_BOUND_ZERO_FILL_FIXTURE_PATH,
    inputFixtureSha256: fixtureSha256,
    candidateCostAuthority: {
      modelId: "htr-historical-execution-v1" as const,
      schemaVersion: "waia.trader.historical-execution-model.v1" as const,
      feeBps: "20" as const,
      halfSpreadBps: "5" as const,
      marketImpactBps: "10" as const,
      costModelDigest: HTR_HISTORICAL_COST_MODEL_DIGEST,
    },
    cycleCount: backtest.cycleCount,
    submittedOrders: orderMetrics.submittedOrders,
    acceptedOrders: orderMetrics.acceptedOrders,
    filledOrders: orderMetrics.filledOrders,
    cycles,
    metricsSchemaVersion: input.metricsSchemaVersion,
  };

  return {
    ...semanticBody,
    semanticResultDigest: sha256Utf8(canonicalJsonString(semanticBody)),
  };
}

export function normalizeParentZeroFillSemantic(
  parent: {
    cycles: Array<{
      cycleIndex: number;
      timestamp: string;
      cycleId: string;
      strategyId: string;
      signalIdentity: string | null;
      strategyDecision: Wp21ZeroFillStrategyDecisionProjection;
      tradingPermission: string;
      riskOutcome: string;
      orderIntentPresent: boolean;
      positionState: Wp21ZeroFillPositionStateProjection;
      accountGrossState: { equity: string; equityHwm: string; cash: string | null };
      guardianDecision: string | null;
      guardianReason: string | null;
      noFillCapitalState: {
        startingBalanceUsdt: string;
        endingBalanceUsdt: string;
        realizedPnl: string;
        unrealizedPnl: string;
      };
    }>;
    metricsSchemaVersion: string;
  },
  symbol = "BTCUSDT",
): Wp21ZeroFillCycleProjection[] {
  return parent.cycles.map((cycle) =>
    normalizeParentCycle(cycle, symbol, parent.metricsSchemaVersion),
  );
}

export function compareWp21ZeroFillStructuralSemantics(input: {
  parent:
    | Wp21ZeroFillStructuralParentSemantic
    | {
        semanticResultDigest: string;
        cycleCount: number;
        submittedOrders: number;
        acceptedOrders: number;
        filledOrders: number;
        cycles: Wp21ZeroFillCycleProjection[];
      };
  candidate: Wp21ZeroFillStructuralCandidateSemantic;
}): Wp21ZeroFillStructuralComparison {
  const parentCycles = input.parent.cycles;
  const candidateCycles = input.candidate.cycles;

  const cycleCountMatch = input.parent.cycleCount === input.candidate.cycleCount;
  const signalDecisionParity = parentCycles.every((parentCycle, index) => {
    const candidateCycle = candidateCycles[index];
    if (!candidateCycle) return false;
    return (
      parentCycle.signalIdentity === candidateCycle.signalIdentity &&
      canonicalJsonString(parentCycle.strategyDecision) ===
        canonicalJsonString(candidateCycle.strategyDecision)
    );
  });
  const permissionParity = parentCycles.every(
    (parentCycle, index) =>
      parentCycle.tradingPermission === candidateCycles[index]?.tradingPermission,
  );
  const riskOutcomeParity = parentCycles.every(
    (parentCycle, index) => parentCycle.riskOutcome === candidateCycles[index]?.riskOutcome,
  );
  const capitalParity = parentCycles.every((parentCycle, index) => {
    const candidateCycle = candidateCycles[index];
    if (!candidateCycle) return false;
    return (
      canonicalJsonString(parentCycle.noFillCapitalState) ===
      canonicalJsonString(candidateCycle.noFillCapitalState)
    );
  });

  const unexpectedSubmittedOrders = input.parent.submittedOrders + input.candidate.submittedOrders;
  const unexpectedFills = input.parent.filledOrders + input.candidate.filledOrders;

  const comparisonBody = {
    schemaVersion: WP21_ZERO_FILL_STRUCTURAL_COMPARISON_SCHEMA,
    parentSemanticResultDigest: input.parent.semanticResultDigest,
    candidateSemanticResultDigest: input.candidate.semanticResultDigest,
    cycleCountMatch,
    signalDecisionParity,
    permissionParity,
    riskOutcomeParity,
    capitalParity,
    unexpectedSubmittedOrders,
    unexpectedFills,
    allowedMetadataDifference: "costAuthorityOnly" as const,
  };

  return {
    ...comparisonBody,
    comparisonDigest: sha256Utf8(canonicalJsonString(comparisonBody)),
  };
}
