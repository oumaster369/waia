/**
 * Live operational result. This is not the billing fee base.
 * The canonical accounting engine is not used here: it needs inputs this
 * read model does not have for live fills. Close-leg `leg_pnl` already
 * includes the close-fee share, so only OPEN fees are subtracted.
 */

import type { AdminDataState } from "@/lib/trader/admin-console/contracts";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
  InvalidDecimalError,
} from "@/lib/trader/risk/numeric";

export type OperationalLeg = {
  kind: "OPEN" | "CLOSE";
  executedAt: string;
  legPnl: string;
  fee: string;
  feeAsset: string;
  price: string;
  baseAsset: string;
  quoteAsset: string;
  /** Only from a matching append-only lifecycle event for this exact close leg. */
  verifiedCloseFeeQuote?: string | null;
};

export type OperationalPnl = {
  state: AdminDataState;
  reasons: string[];
  realized: string | null;
  openFees: string | null;
  closeFees: string | null;
  tradingFees: string | null;
};

function inPeriod(at: string, start: string, end: string): boolean {
  return at >= start && at < end;
}

function feeInQuote(leg: OperationalLeg): { amount: string } | { reason: string } {
  if (leg.kind === "CLOSE" && leg.verifiedCloseFeeQuote != null)
    return { amount: leg.verifiedCloseFeeQuote };
  if (compareDecimal(leg.fee, "0") === 0) return { amount: "0" };
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
  const exact = (value: string) =>
    value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  try {
    return computeOperationalPnl(
      legs.map((leg) => ({
        ...leg,
        fee: exact(leg.fee),
        price: exact(leg.price),
        legPnl: exact(leg.legPnl),
      })),
      start,
      end,
    );
  } catch (error) {
    if (!(error instanceof InvalidDecimalError)) throw error;
    return {
      state: "unavailable",
      reasons: ["MONEY_PRECISION_UNSUPPORTED"],
      realized: null,
      openFees: null,
      closeFees: null,
      tradingFees: null,
    };
  }
}

function computeOperationalPnl(
  legs: readonly OperationalLeg[],
  start: string,
  end: string,
): OperationalPnl {
  let realized = "0";
  let openFees = "0";
  let closeFees = "0";
  const reasons: string[] = [];
  let state: AdminDataState = "ok";
  for (const leg of legs) {
    if (!inPeriod(leg.executedAt, start, end)) continue;
    const fee = feeInQuote(leg);
    if ("reason" in fee) {
      reasons.push(fee.reason);
      state = "partial";
      continue;
    }
    if (leg.kind === "CLOSE") {
      // The live lifecycle writer subtracts the stored fee from proceeds. A
      // non-quote close fee therefore lacks proof of a quote-denominated net
      // leg_pnl; do not silently reinterpret historical accounting records.
      if (
        compareDecimal(leg.fee, "0") !== 0 &&
        leg.feeAsset.toUpperCase() !== leg.quoteAsset.toUpperCase() &&
        leg.verifiedCloseFeeQuote == null
      ) {
        reasons.push("CLOSE_FEE_DENOMINATION_UNVERIFIED");
        state = "partial";
        continue;
      }
      realized = addDecimal(realized, leg.legPnl);
      closeFees = addDecimal(closeFees, fee.amount);
    } else openFees = addDecimal(openFees, fee.amount);
  }
  if (reasons.length > 0) {
    return {
      state,
      reasons: [...new Set(reasons)],
      realized: null,
      openFees: null,
      closeFees: null,
      tradingFees: null,
    };
  }
  return {
    state,
    reasons,
    realized: subtractDecimal(realized, openFees),
    openFees,
    closeFees,
    tradingFees: addDecimal(openFees, closeFees),
  };
}
