import type { ObservedTransfer } from "@/lib/waia-core/payment-watcher/watcher-cycle.types";

export type ChainAdapterResult<T> =
  | { ok: true; value: T; provider: "primary" | "secondary" }
  | { ok: false; error: string; provider: "primary" | "secondary" | null };

export type ChainAdapter = {
  getTipBlock(): Promise<ChainAdapterResult<string>>;
  getTransfersInRange(
    fromBlock: string,
    toBlock: string,
  ): Promise<ChainAdapterResult<ObservedTransfer[]>>;
  /** Returns false when the transaction is absent from the canonical chain. */
  getTransactionExists(txHash: string): Promise<ChainAdapterResult<boolean>>;
};
