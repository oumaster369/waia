import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";

/** Caller-supplied valuation marks — not fetched from connectors in S1. */
export type PaperPnLMarkPrices = {
  marks: Record<string, string>;
  quoteCurrency?: string;
};

/** Per-symbol open-position economics in the Paper PnL snapshot. */
export type PaperPositionPnL = {
  symbol: string;
  quantity: string;
  avgCost: string;
  costBasis: string;
  markPrice: string | null;
  marketValue: string | null;
  realizedPnl: string;
  unrealizedPnl: string | null;
  fees: string;
};

/** Org-scoped operational PnL read model for mock/paper execution modes. */
export type PaperPnL = {
  organizationId: string;
  executionMode: PaperBookExecutionMode;
  quoteCurrency: string;
  realizedPnl: string;
  unrealizedPnl: string | null;
  totalFees: string;
  totalPnl: string | null;
  positions: PaperPositionPnL[];
  feesByAsset: Record<string, string>;
  valuationGaps: string[];
  derivedAt: Date;
};
