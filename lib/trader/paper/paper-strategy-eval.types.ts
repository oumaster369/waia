import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import type { PaperPnL } from "@/lib/trader/paper/paper-pnl.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";

/** Per in-window sell fill for strategy-scoped evaluation. */
export type PaperClosedTrade = {
  fillId: string;
  orderId: string;
  symbol: string;
  executedAt: Date;
  quantity: string;
  price: string;
  tradePnl: string;
};

/** Org-scoped operational strategy evaluation read model for mock/paper execution modes. */
export type PaperStrategyEvaluation = {
  organizationId: string;
  executionMode: PaperBookExecutionMode;
  strategySignalId: string;
  quoteCurrency: string;
  window: PaperPnLWindow;
  periodRealizedPnl: string;
  periodTotalFees: string;
  periodFeesByAsset: Record<string, string>;
  periodValuationGaps: string[];
  periodUnrealizedChange: string | null;
  periodTotalPnlChange: string | null;
  endSnapshot: PaperPnL;
  closedTrades: PaperClosedTrade[];
  closedTradeCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: string | null;
  lossRate: string | null;
  averageWin: string | null;
  averageLoss: string | null;
  grossProfit: string;
  grossLoss: string;
  profitFactor: string | null;
  expectancy: string | null;
  maxRealizedDrawdown: string;
  recoveryFactor: string | null;
  derivedAt: Date;
};
