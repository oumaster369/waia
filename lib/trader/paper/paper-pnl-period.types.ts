import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import type { PaperPnL } from "@/lib/trader/paper/paper-pnl.types";

/** Half-open window on fill `executedAt`: [start, end). */
export type PaperPnLWindow = {
  start: Date;
  end: Date;
};

/** Org-scoped operational period rollup for mock/paper execution modes. */
export type PaperPnLPeriodRollup = {
  organizationId: string;
  executionMode: PaperBookExecutionMode;
  quoteCurrency: string;
  window: PaperPnLWindow;
  periodRealizedPnl: string;
  periodTotalFees: string;
  periodFeesByAsset: Record<string, string>;
  periodValuationGaps: string[];
  periodUnrealizedChange: string | null;
  periodTotalPnlChange: string | null;
  /** Cumulative economics as-of `window.end` (fills with `executedAt < window.end` only). */
  endSnapshot: PaperPnL;
  derivedAt: Date;
};
