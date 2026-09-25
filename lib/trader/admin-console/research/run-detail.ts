export type ResearchRunDetail = {
  id: string;
  runId: string;
  organizationId: string;
  kind: "historical" | "backtest";
  phase: string;
  symbol: string;
  partition: string;
  observedAt: string | null;
  conditions: {
    dataset: string | null;
    period: string | null;
    costs: string | null;
    version: string | null;
    model: string | null;
  };
  metrics: {
    equity: string | null;
    cash: string | null;
    netPnl: string | null;
    realizedPnl: string | null;
    fees: string | null;
    currency: "USDT";
    method: string;
    forecastQuality: string | null;
  };
  progress: { committed: number | null; qualified: number | null };
  cycles: {
    id: string;
    accountId: string;
    sequence: number;
    at: string;
    netPnl: string | null;
    fills: number;
    decisions: number;
    riskVetoes: number;
    checkpoint: string | null;
  }[];
  artifacts: { label: string; digest: string }[];
  resultSlices: {
    regime: string;
    strategySignalId: string;
    realizedPnl: string | null;
    fees: string | null;
    closedTrades: number | null;
    digest: string | null;
  }[];
  events: { phase: string; at: string; errorCode: string | null; committed: number }[];
  reasons: string[];
  totalCycles: number;
  truncated: boolean;
};
