import {
  grossUnrealizedPnl,
  netUnrealizedPnl,
  remainingGrossPositionBasis,
  remainingNetPositionBasis,
} from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type { AccountingStateV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  HTR_PNL_REPORT_SCHEMA_VERSION,
  type HtrPnlReportTerminalOpenPositionV1,
  type HtrPnlReportV1,
} from "@/lib/trader/accounting/htr-pnl-report-v1.types";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type BuildHtrPnlReportInput = {
  state: AccountingStateV1;
  startingEquityUsdt?: string;
  semanticDigest: string;
};

function terminalOpenPositions(state: AccountingStateV1): HtrPnlReportTerminalOpenPositionV1[] {
  return Object.entries(state.positions)
    .filter(([, pos]) => compareDecimal(pos.quantity, "0") > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, pos]) => ({
      symbol,
      quantity: pos.quantity,
      grossAvgCost:
        compareDecimal(pos.quantity, "0") > 0
          ? divideDecimal(pos.grossPositionBasis, pos.quantity)
          : "0",
      netAvgCost:
        compareDecimal(pos.quantity, "0") > 0
          ? divideDecimal(pos.netPositionBasis, pos.quantity)
          : "0",
    }));
}

export function buildHtrPnlReportV1(input: BuildHtrPnlReportInput): HtrPnlReportV1 {
  const startingEquity = input.startingEquityUsdt ?? HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;
  const grossUnrealized = grossUnrealizedPnl(input.state);
  const netUnrealized = netUnrealizedPnl(input.state);
  const totalExecutionCost = subtractExecutionCost(
    input.state.grossRealizedPnl,
    input.state.netRealizedPnl,
    grossUnrealized,
    netUnrealized,
  );

  return {
    schemaVersion: HTR_PNL_REPORT_SCHEMA_VERSION,
    organizationId: input.state.organizationId,
    accountKey: input.state.accountKey,
    runId: input.state.runId,
    startingEquityUsdt: startingEquity,
    terminalEquityUsdt: input.state.equity,
    terminalCashUsdt: input.state.cash,
    grossRealizedPnlUsdt: input.state.grossRealizedPnl,
    netRealizedPnlUsdt: input.state.netRealizedPnl,
    grossUnrealizedPnlUsdt: grossUnrealized,
    netUnrealizedPnlUsdt: netUnrealized,
    totalExecutionCostUsdt: totalExecutionCost,
    accountDrawdownBps: input.state.accountDrawdownBps,
    equityHwmUsdt: input.state.equityHwm,
    terminalOpenPositions: terminalOpenPositions(input.state),
    accountingSequence: input.state.accountingSequence,
    semanticDigest: input.semanticDigest,
  };
}

function subtractExecutionCost(
  grossRealized: string,
  netRealized: string,
  grossUnrealized: string,
  netUnrealized: string,
): string {
  const grossTotal = addDecimal(grossRealized, grossUnrealized);
  const netTotal = addDecimal(netRealized, netUnrealized);
  return subtractDecimal(grossTotal, netTotal);
}

export function remainingBasisSummary(state: AccountingStateV1): {
  gross: string;
  net: string;
} {
  return {
    gross: remainingGrossPositionBasis(state),
    net: remainingNetPositionBasis(state),
  };
}
