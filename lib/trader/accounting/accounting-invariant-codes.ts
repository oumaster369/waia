export const accountingInvariantCodes = {
  cashEquityConservation: "ACCOUNTING_CASH_EQUITY_CONSERVATION",
  inventoryParity: "ACCOUNTING_INVENTORY_PARITY",
  grossNetExecutionCost: "ACCOUNTING_GROSS_NET_EXECUTION_COST",
  startingEquityTerminal: "ACCOUNTING_STARTING_EQUITY_TERMINAL",
  equitySeriesTerminal: "ACCOUNTING_EQUITY_SERIES_TERMINAL",
  cashLedgerTerminal: "ACCOUNTING_CASH_LEDGER_TERMINAL",
  sequenceContiguous: "ACCOUNTING_SEQUENCE_CONTIGUOUS",
  oneConsumptionPerFill: "ACCOUNTING_ONE_CONSUMPTION_PER_FILL",
  cashEventIntegrity: "ACCOUNTING_CASH_EVENT_INTEGRITY",
  pnlReportTerminal: "ACCOUNTING_PNL_REPORT_TERMINAL",
  reconciliationFailure: "ACCOUNTING_RECONCILIATION_FAILURE",
} as const;

export type AccountingInvariantCode =
  (typeof accountingInvariantCodes)[keyof typeof accountingInvariantCodes];
