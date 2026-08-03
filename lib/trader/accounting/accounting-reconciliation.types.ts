import type { AccountingStateV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrPnlReportV1 } from "@/lib/trader/accounting/htr-pnl-report-v1.types";
import type { AccountingInvariantCode } from "@/lib/trader/accounting/accounting-invariant-codes";

/** Hot-path reconcile only needs terminal cash/equity parity vs accounting state. */
export type AccountingReconciliationPnlTerminal = Readonly<{
  terminalEquityUsdt: string;
  terminalCashUsdt: string;
}>;

export type AccountingReconciliationInput = {
  state: AccountingStateV1;
  startingEquityUsdt: string;
  startingCashUsdt: string;
  /** Full PnL report or hot-path terminal slice (IDHPS automatic reconcile). */
  pnlReport?: HtrPnlReportV1 | AccountingReconciliationPnlTerminal;
  inventoryOpenQtyBySymbol?: Record<string, string>;
  cashEvents?: Array<{ fillId: string; netCashEffect: string }>;
  /**
   * When set, cash-event integrity only requires these fill IDs (current epoch).
   * Defaults to `state.consumedFillIds` for full-history ledgers.
   */
  cashEventIntegrityFillIds?: string[];
  equitySeriesTerminal?: string;
  expectedAccountingSequence?: number;
};

export type AccountingReconciliationViolation = {
  code: AccountingInvariantCode;
  message: string;
};

export type AccountingReconciliationResult = {
  pass: boolean;
  violations: AccountingReconciliationViolation[];
};

export type HistoricalRealityReconciliationReport = AccountingReconciliationResult & {
  organizationId: string;
  accountKey: string;
  runId: string;
  accountingSequence: number;
  terminalEquityUsdt: string;
  terminalCashUsdt: string;
};
