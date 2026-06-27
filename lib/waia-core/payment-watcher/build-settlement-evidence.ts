import type { SettlementEvidence } from "@/lib/waia-core/payments/payment-events.types";
import type { ObservedTransfer } from "@/lib/waia-core/payment-watcher/watcher-cycle.types";
import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";

export function buildSettlementEvidence(
  transfer: ObservedTransfer,
  confirmationsRequired: number,
  confirmedAt: Date,
): SettlementEvidence {
  const observedAt = transfer.blockTimestamp;
  return {
    settlementNetwork: CANONICAL_NETWORK,
    settlementAsset: "USDT",
    settlementAmount: transfer.amountDecimal,
    settlementTxHash: transfer.txHash,
    transferIndex: transfer.transferIndex,
    confirmationsRequired,
    confirmationsObserved: transfer.confirmationsObserved,
    blockHeight: transfer.blockHeight,
    observedAt,
    confirmedAt,
    valuedAmountUsd: transfer.amountDecimal,
    valuationSource: "stablecoin_par",
    valuationAt: observedAt,
    evidenceRef: `watcher://${CANONICAL_NETWORK}/${transfer.txHash}/${transfer.transferIndex}`,
  };
}
