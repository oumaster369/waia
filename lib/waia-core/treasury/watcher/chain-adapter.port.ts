import type { TreasuryObservedTransfer } from "@/lib/waia-core/treasury/watcher/types";

export type TreasuryChainAdapterResult<T> =
  | { ok: true; value: T; provider: "primary" | "secondary" }
  | { ok: false; error: string; provider: "primary" | "secondary" | null };

export type TreasuryChainAdapter = {
  getTipBlock(): Promise<TreasuryChainAdapterResult<string>>;
  /**
   * Official TronGrid v1 contract-events: event_name=Transfer, block_number=<one block>,
   * fingerprint pagination, limit<=200. Confirmed and unconfirmed events included
   * (do not force only_confirmed=true).
   */
  getTransfersForBlock(
    blockNumber: string,
  ): Promise<TreasuryChainAdapterResult<TreasuryObservedTransfer[]>>;
  getTransactionExists(txHash: string): Promise<TreasuryChainAdapterResult<boolean>>;
  /**
   * Optional exact historical token-balance capability. Default adapters return
   * `{ supported: false }` so reconciliation fails closed to UNAVAILABLE.
   */
  getConsolidatedBalanceAtBlock?(input: {
    addresses: string[];
    asOfBlock: string;
    tokenContract: string;
  }): Promise<
    TreasuryChainAdapterResult<{ supported: false } | { supported: true; atomic: bigint }>
  >;
};
