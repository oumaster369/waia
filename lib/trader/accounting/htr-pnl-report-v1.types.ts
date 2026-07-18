export const HTR_PNL_REPORT_SCHEMA_VERSION = "htr-pnl-report/v1" as const;

export type HtrPnlReportTerminalOpenPositionV1 = {
  symbol: string;
  quantity: string;
  grossAvgCost: string;
  netAvgCost: string;
};

export type HtrPnlReportV1 = {
  schemaVersion: typeof HTR_PNL_REPORT_SCHEMA_VERSION;
  organizationId: string;
  accountKey: string;
  runId: string;
  startingEquityUsdt: string;
  terminalEquityUsdt: string;
  terminalCashUsdt: string;
  grossRealizedPnlUsdt: string;
  netRealizedPnlUsdt: string;
  grossUnrealizedPnlUsdt: string;
  netUnrealizedPnlUsdt: string;
  totalExecutionCostUsdt: string;
  accountDrawdownBps: number;
  monthlyDrawdownBps: number;
  equityHwmUsdt: string;
  monthlyPeakHwmUsdt: string;
  strategyDrawdownBpsByKey: Record<string, number>;
  terminalOpenPositions: HtrPnlReportTerminalOpenPositionV1[];
  accountingSequence: number;
  semanticDigest: string;
};
