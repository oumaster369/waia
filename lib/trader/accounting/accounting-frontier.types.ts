import type { CostedFillEconomics } from "@/lib/trader/execution/historical-execution-model.types";

export const ACCOUNTING_FRONTIER_SCHEMA_VERSION = "htr-accounting-frontier/v1" as const;
export const HTR_PNL_REPORT_SCHEMA_VERSION = "htr-pnl-report/v1" as const;
export const ACCOUNTING_ENGINE_ID = "CANONICAL_CROSS_BACKEND_ACCOUNTING_ENGINE_V1" as const;
export const ACCOUNTING_BASIS_METHOD = "DUAL_GROSS_NET_WEIGHTED_AVERAGE_BASIS_V1" as const;

export type SymbolBasisMap = Record<string, string>;
export type SymbolQuantityMap = Record<string, string>;

export type SymbolMarkV1 = {
  price: string;
  barCloseTime: string;
};

export type MarksJsonV1 = Record<string, SymbolMarkV1>;

export type SymbolPositionBasis = {
  quantity: string;
  grossPositionBasis: string;
  netPositionBasis: string;
};

export type AccountingStateV1 = {
  schemaVersion: typeof ACCOUNTING_FRONTIER_SCHEMA_VERSION;
  engineId: typeof ACCOUNTING_ENGINE_ID;
  basisMethod: typeof ACCOUNTING_BASIS_METHOD;
  organizationId: string;
  accountKey: string;
  runId: string;
  accountingSequence: number;
  frontierAsOf: string;
  monthKey: string;
  cash: string;
  positions: Record<string, SymbolPositionBasis>;
  grossRealizedPnl: string;
  netRealizedPnl: string;
  marks: MarksJsonV1;
  markedPositionValue: string;
  equity: string;
  equityHwm: string;
  accountDrawdownBps: number;
  consumedFillIds: string[];
};

export type AccountingFrontierV1 = AccountingStateV1 & {
  id: string;
  sourceFillId: string | null;
  sourceEconomicsDigest: string;
  semanticContentDigest: string;
  idempotencyKey: string;
};

export type AccountingFillInput = {
  fillId: string;
  economics: Pick<
    CostedFillEconomics,
    | "symbol"
    | "side"
    | "quantity"
    | "grossFillPrice"
    | "grossNotional"
    | "netFillPrice"
    | "feeAmount"
    | "netCashEffect"
    | "spreadCost"
    | "impactSlippageCost"
    | "totalExecutionCost"
    | "economicsContentDigest"
  >;
  executedAt: string;
};

export type AdvanceAccountingFrontierInput = {
  state: AccountingStateV1;
  fill?: AccountingFillInput;
  marks?: MarksJsonV1;
  frontierAsOf: string;
  frontierId?: string;
  idempotencyKey?: string;
};

export class AccountingInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingInvariantError";
  }
}

export class AccountingIdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingIdempotencyConflictError";
  }
}
