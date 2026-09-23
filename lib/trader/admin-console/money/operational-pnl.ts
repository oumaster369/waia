/**
 * Live operational result. This is not the billing fee base.
 * The canonical accounting engine is not used here: it needs inputs this
 * read model does not have for live fills. Close-leg `leg_pnl` already
 * includes the close-fee share, so only OPEN fees are subtracted.
 */

import type { AdminDataState } from "@/lib/trader/admin-console/contracts";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import { addDecimal, multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export type OperationalLeg = {
  kind: "OPEN" | "CLOSE";
  executedAt: string;
  legPnl: string;
  fee: string;
  feeAsset: string;
  price: string;
  baseAsset: string;
  quoteAsset: string;
};

export type OperationalPnl = {
  state: AdminDataState;
  reasons: string[];
  realized: string | null;
  openFees: string | null;
};

function inPeriod(at: string, start: string, end: string): boolean {
  return at >= start && at < end;
}

function feeInQuote(leg: OperationalLeg): { amount: string } | { reason: string } {
  const asset = leg.feeAsset.toUpperCase();
  if (asset === leg.quoteAsset.toUpperCase()) return { amount: leg.fee };
  if (asset === leg.baseAsset.toUpperCase()) return { amount: multiplyDecimal(leg.fee, leg.price) };
  return { reason: ADMIN_REASON.feeAssetUnconvertible };
}

export function operationalRealizedPnl(
  legs: readonly OperationalLeg[],
  start: string,
  end: string,
): OperationalPnl {
  let realized = "0";
  let openFees = "0";
  const reasons: string[] = [];
  let state: AdminDataState = "ok";
  for (const leg of legs) {
    if (!inPeriod(leg.executedAt, start, end)) continue;
    if (leg.kind === "CLOSE") {
      realized = addDecimal(realized, leg.legPnl);
      continue;
    }
    const fee = feeInQuote(leg);
    if ("reason" in fee) {
      reasons.push(fee.reason);
      state = "partial";
      continue;
    }
    openFees = addDecimal(openFees, fee.amount);
  }
  if (reasons.length > 0) {
    return { state, reasons: [...new Set(reasons)], realized: null, openFees: null };
  }
  return {
    state,
    reasons,
    realized: subtractDecimal(realized, openFees),
    openFees,
  };
}
