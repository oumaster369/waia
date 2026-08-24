import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import type { Bar } from "@/lib/trader/intelligence/types";
import { emitPaperBarCloseCycleComplete } from "@/lib/trader/paper/paper-bar-close-loop-telemetry";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import { resolveHtxInformationInquiryCycleV1 } from "@/lib/trader/paper/paper-cycle-runner";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import type {
  PaperLoopCycleReport,
  PaperLoopWorkerConfig,
  RunPaperLoopCycleInput,
} from "@/lib/trader/paper/paper-loop-worker.types";
import type { PortfolioCycleContext } from "@/lib/trader/paper/paper-cycle.types";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import {
  defaultStopDistanceProvider,
  derivePortfolioAccountState,
  toAccountRiskState,
} from "@/lib/trader/portfolio";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function buildPaperLoopPortfolioContext(
  config: PaperLoopWorkerConfig,
  markPrices?: PaperPnLMarkPrices,
): PortfolioCycleContext {
  return {
    runConfig: {
      ...DEFAULT_PORTFOLIO_RUN_CONFIG,
      startingBalanceUsdt: config.startingBalanceUsdt,
      defaultStopDistancePct: config.defaultStopDistancePct,
    },
    limits: {
      maxRiskPerTradePct: DEFAULT_ORG_RISK_LIMITS.maxRiskPerTradePct!,
      maxPortfolioRiskPct: DEFAULT_ORG_RISK_LIMITS.maxPortfolioRiskPct!,
      maxConcurrentPositions: DEFAULT_ORG_RISK_LIMITS.maxConcurrentPositions!,
      maxNotional: DEFAULT_ORG_RISK_LIMITS.maxNotional,
    },
    stopDistanceProvider: defaultStopDistanceProvider,
    costModel: costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1()),
    markPrices,
  };
}

function buildMarkPricesFromSnapshot(bars: readonly Bar[]): PaperPnLMarkPrices | undefined {
  if (bars.length === 0) {
    return undefined;
  }
  const marks: Record<string, string> = {};
  for (const bar of bars) {
    marks[bar.symbol] = bar.close;
  }
  return { marks };
}

async function refreshPortfolioAccountState(
  context: OrgContext,
  input: RunPaperLoopCycleInput,
  portfolio: PortfolioCycleContext,
): Promise<AccountRiskState> {
  const portfolioState = await derivePortfolioAccountState({
    context,
    orderRepository: input.deps.orderRepository,
    runConfig: portfolio.runConfig,
    limits: portfolio.limits,
    stopDistanceProvider: portfolio.stopDistanceProvider,
    executionMode: "mock",
    markPrices: portfolio.markPrices,
  });
  const openOrders = await input.deps.orderRepository.listOpenOrders(context, {
    executionMode: "mock",
  });
  return toAccountRiskState({ portfolio: portfolioState, openOrderCount: openOrders.length });
}

/** Runs one scheduled paper-loop cycle: startup reconciliation → HTX poll → multi-strategy paper dispatch (P5). */
export async function runPaperLoopCycle(
  input: RunPaperLoopCycleInput,
): Promise<PaperLoopCycleReport> {
  const startMs = Date.now();
  const { deps } = input;
  const { config } = deps;
  const telemetrySink = input.telemetrySink;

  if (!config.enabled) {
    deps.logger.log({
      event: "waia_paper_loop",
      phase: "cycle_skipped",
      reason: "disabled",
    });
    return {
      outcome: "noop_disabled",
      organizationId: config.organizationId,
      cycleId: null,
      strategySignalCount: 0,
      strategySubmittedCount: 0,
      startupReconciledOrders: 0,
      durationMs: Date.now() - startMs,
    };
  }

  const context = requireOrgContext(config.organizationId);
  const startup = await deps.startupReconciliation.runStartupReconciliation(context, "mock");

  const resolvedInquiry =
    deps.poll instanceof HtxBarPollSource
      ? await resolveHtxInformationInquiryCycleV1({
          poll: deps.poll,
          expectedOrganizationId: context.organizationId,
          expectedAccountId: config.accountKey,
          resolver: deps.informationInquiryResolver,
        })
      : null;
  const snapshot = resolvedInquiry?.bundle.snapshot ?? (await deps.poll.fetchSnapshot());
  const portfolio = buildPaperLoopPortfolioContext(
    config,
    buildMarkPricesFromSnapshot(snapshot.bars),
  );

  let accountState = EMPTY_STATE;
  try {
    accountState = await refreshPortfolioAccountState(context, input, portfolio);
  } catch {
    accountState = EMPTY_STATE;
  }

  const result = await runPaperCycleOnce(deps.paperCycleDeps, {
    context,
    snapshot,
    fusedContext: resolvedInquiry?.bundle.fusedContext,
    accountKey: config.accountKey,
    defaultQuantity: config.defaultQuantity,
    accountState,
    executionMode: "mock",
    telemetrySink,
    newId: input.newId,
    informationSufficiencyAuthority: resolvedInquiry?.informationSufficiencyAuthority,
    orderRepository: deps.orderRepository,
    refreshAccountStateBetweenStrategies: true,
    portfolio,
  });

  let accountStateAfterCycle = accountState;
  try {
    accountStateAfterCycle = await refreshPortfolioAccountState(context, input, portfolio);
  } catch {
    accountStateAfterCycle = accountState;
  }

  const strategySubmittedCount = result.strategyExecutions.filter(
    (entry) => entry.execution?.status === "submitted",
  ).length;

  emitPaperBarCloseCycleComplete(
    {
      organizationId: context.organizationId,
      cycleId: snapshot.cycleId,
      cyclesRun: 1,
      durationMs: Date.now() - startMs,
      result,
      stateRefreshed: true,
      accountStateAfterCycle,
    },
    telemetrySink,
  );

  const outcome =
    strategySubmittedCount > 0
      ? "submitted"
      : result.submitBlocked && result.skipReason === "no_signal"
        ? "skipped_no_signal"
        : "blocked";

  deps.logger.log({
    event: "waia_paper_loop",
    phase: "cycle_complete",
    outcome,
    organizationId: context.organizationId,
    cycleId: snapshot.cycleId,
    strategySignalCount: result.strategyExecutions.length,
    strategySubmittedCount,
    startupReconciledOrders: startup.reconciliation.outcomes.length,
    durationMs: Date.now() - startMs,
  });

  return {
    outcome,
    organizationId: context.organizationId,
    cycleId: snapshot.cycleId,
    strategySignalCount: result.strategyExecutions.length,
    strategySubmittedCount,
    startupReconciledOrders: startup.reconciliation.outcomes.length,
    durationMs: Date.now() - startMs,
  };
}
