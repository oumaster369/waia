import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";

import { settlementExceptionReasons } from "@/lib/trader/settlement/settlement.types";

export type ValuationPolicyInput = {
  settlementNetwork: string | null;
  settlementAsset: string | null;
  onChainAmount: string | null;
};

export type ValuationPolicyResult =
  | {
      ok: true;
      valuedAmount: string;
      valuationCurrency: string;
      valuationBasis: string;
    }
  | { ok: false; reason: string };

export type SettlementValuationPolicy = (input: ValuationPolicyInput) => ValuationPolicyResult;

/** Canonical USDT TRC-20 valued 1:1 to USD (ADR-0015 / ADL-8). */
export const parityUsdtUsdValuation: SettlementValuationPolicy = (input) => {
  if (input.settlementNetwork !== CANONICAL_NETWORK || input.settlementAsset !== "USDT") {
    return { ok: false, reason: settlementExceptionReasons.unsupportedAssetOrNetwork };
  }
  if (!input.onChainAmount?.trim()) {
    return { ok: false, reason: settlementExceptionReasons.missingOnChainAmount };
  }

  return {
    ok: true,
    valuedAmount: input.onChainAmount,
    valuationCurrency: "USD",
    valuationBasis: "stablecoin_par:1:1",
  };
};
