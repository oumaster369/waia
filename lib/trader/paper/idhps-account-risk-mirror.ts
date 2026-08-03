import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { addDecimal, multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export const IDHPS_ACCOUNT_RISK_MIRROR_SCHEMA_VERSION = "idhps-account-risk-mirror/v1" as const;

export type IdhpsPortfolioLedgerEntryV1 = {
  openQty: string;
  avgCost: string;
  realizedPnl: string;
};

export type IdhpsAccountRiskMirrorV1 = {
  schemaVersion: typeof IDHPS_ACCOUNT_RISK_MIRROR_SCHEMA_VERSION;
  openOrderCount: number;
  equity: string | null;
  cash: string | null;
  /** Fill-walk-equivalent available balance for portfolio sizing. */
  availableBalanceUsdt: string | null;
  feesPaidUsdt: string;
  /** Fill-walk-equivalent realized PnL across portfolio ledgers. */
  realizedPnlUsdt: string;
  /**
   * Fee-aware avg-cost ledgers keyed by portfolio symbol (`ETH/USDT`).
   * Updated on each new fill; mark-to-market is computed at sizing time.
   */
  portfolioLedgerBySymbol: Record<string, IdhpsPortfolioLedgerEntryV1>;
  accountPeakHwm: string | null;
  monthlyPeakHwm: string | null;
  lastRiskSnapshot: AccountRiskState | null;
};

export function createEmptyIdhpsAccountRiskMirror(): IdhpsAccountRiskMirrorV1 {
  return {
    schemaVersion: IDHPS_ACCOUNT_RISK_MIRROR_SCHEMA_VERSION,
    openOrderCount: 0,
    equity: null,
    cash: null,
    availableBalanceUsdt: null,
    feesPaidUsdt: "0",
    realizedPnlUsdt: "0",
    portfolioLedgerBySymbol: {},
    accountPeakHwm: null,
    monthlyPeakHwm: null,
    lastRiskSnapshot: null,
  };
}

/** Matches computeAvailableBalanceFromFills semantics for one fill. */
export function applyFillToIdhpsAvailableBalance(
  mirror: IdhpsAccountRiskMirrorV1,
  input: {
    side: "buy" | "sell";
    price: string;
    quantity: string;
    fee: string;
    startingBalanceUsdt: string;
  },
): void {
  const prior = mirror.availableBalanceUsdt ?? input.startingBalanceUsdt;
  const notional = multiplyDecimal(input.price, input.quantity);
  mirror.feesPaidUsdt = addDecimal(mirror.feesPaidUsdt, input.fee);
  if (input.side === "buy") {
    mirror.availableBalanceUsdt = subtractDecimal(prior, addDecimal(notional, input.fee));
  } else {
    mirror.availableBalanceUsdt = addDecimal(prior, subtractDecimal(notional, input.fee));
  }
}

export function digestIdhpsAccountRiskMirror(mirror: IdhpsAccountRiskMirrorV1): string {
  return createHash("sha256").update(canonicalJsonString(mirror), "utf8").digest("hex");
}

export function updateIdhpsAccountRiskMirror(
  mirror: IdhpsAccountRiskMirrorV1,
  input: {
    openOrderCount: number;
    equity?: string | null;
    cash?: string | null;
    accountPeakHwm?: string | null;
    monthlyPeakHwm?: string | null;
    snapshot?: AccountRiskState | null;
  },
): void {
  mirror.openOrderCount = input.openOrderCount;
  if (input.equity !== undefined) mirror.equity = input.equity;
  if (input.cash !== undefined) mirror.cash = input.cash;
  if (input.accountPeakHwm !== undefined) mirror.accountPeakHwm = input.accountPeakHwm;
  if (input.monthlyPeakHwm !== undefined) mirror.monthlyPeakHwm = input.monthlyPeakHwm;
  if (input.snapshot !== undefined) mirror.lastRiskSnapshot = input.snapshot;
}

export function captureIdhpsAccountRiskMirror(
  mirror: IdhpsAccountRiskMirrorV1,
): IdhpsAccountRiskMirrorV1 {
  return structuredClone(mirror);
}

export function restoreIdhpsAccountRiskMirror(
  snapshot: IdhpsAccountRiskMirrorV1,
): IdhpsAccountRiskMirrorV1 {
  if (snapshot.schemaVersion !== IDHPS_ACCOUNT_RISK_MIRROR_SCHEMA_VERSION) {
    throw new Error("BLOCKED_BY_H_ARCH_1_IDHPS_SQLITE_MIRROR_MISMATCH: account-risk schema");
  }
  return structuredClone(snapshot);
}
