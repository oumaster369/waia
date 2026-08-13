import type { TronRpcClient } from "@/lib/waia-core/payment-watcher/tron-rpc-client";
import { createTronRpcClient } from "@/lib/waia-core/payment-watcher/tron-rpc-client";
import type { TreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher/config";
import type {
  TreasuryChainAdapter,
  TreasuryChainAdapterResult,
} from "@/lib/waia-core/treasury/watcher/chain-adapter.port";
import type { TreasuryObservedTransfer } from "@/lib/waia-core/treasury/watcher/types";
import { requireBigint } from "@/lib/waia-core/treasury/money";

type TronBlockResponse = {
  block_header?: { raw_data?: { number?: number } };
};

type TronEventRow = {
  block_number?: number;
  block_timestamp?: number;
  transaction_id?: string;
  event_index?: number;
  contract_address?: string;
  result?: Record<string, string>;
};

type TronEventsResponse = {
  data?: TronEventRow[];
  success?: boolean;
  meta?: { fingerprint?: string };
};

type TronTransactionResponse = {
  txID?: string;
};

function pickAddress(
  result: Record<string, string> | undefined,
  hexKey: string,
  namedKey: string,
): string {
  if (!result) return "";
  const named = result[namedKey];
  if (named && named.startsWith("T")) return named;
  const hex = result[hexKey];
  if (hex && hex.startsWith("T")) return hex;
  return named ?? hex ?? "";
}

function parseAtomicAmount(raw: string | undefined): bigint {
  return requireBigint(BigInt(raw || "0"), "nativeAmountAtomic");
}

function mapEvent(event: TronEventRow, contractAddress: string): TreasuryObservedTransfer | null {
  if (!event.transaction_id || event.block_number === undefined) return null;
  if (event.contract_address && event.contract_address !== contractAddress) return null;
  const toAddress = pickAddress(event.result, "1", "to");
  const fromAddress = pickAddress(event.result, "0", "from");
  if (!toAddress || !fromAddress) return null;
  return {
    txHash: event.transaction_id,
    transferIndex: event.event_index ?? 0,
    fromAddress,
    toAddress,
    tokenContract: contractAddress,
    nativeAmountAtomic: parseAtomicAmount(event.result?.value ?? event.result?.["2"]),
    blockHeight: String(event.block_number),
    blockTimestamp: event.block_timestamp ? new Date(event.block_timestamp) : null,
  };
}

/**
 * TronGrid v1 `/v1/contracts/{address}/events` with documented query:
 * event_name, block_number (single block), limit, fingerprint pagination.
 * Does not send undocumented min_block_number / max_block_number.
 * Does not force only_confirmed=true so OBSERVED (unconfirmed) events can appear.
 */
export function createTreasuryTronAdapter(
  config: TreasuryWatcherConfig,
  rpcClient?: TronRpcClient,
): TreasuryChainAdapter {
  const client =
    rpcClient ??
    createTronRpcClient({
      primaryUrl: config.tronPrimaryUrl,
      secondaryUrl: config.tronSecondaryUrl,
      apiKey: config.tronGridApiKey,
      secondaryApiKey: config.tronSecondaryApiKey,
      maxRetries: config.rpcMaxRetries,
      timeoutMs: 15_000,
    });

  return {
    async getTipBlock() {
      const rpc = await client.request<TronBlockResponse>("/wallet/getnowblock", {
        method: "POST",
        body: "{}",
      });
      if (!rpc.ok) return { ok: false, error: rpc.error, provider: rpc.provider };
      const number = rpc.data.block_header?.raw_data?.number;
      if (number === undefined) {
        return { ok: false, error: "missing block number in getnowblock", provider: rpc.provider };
      }
      return { ok: true, value: String(number), provider: rpc.provider };
    },

    async getTransfersForBlock(blockNumber) {
      const collected: TreasuryObservedTransfer[] = [];
      const seenFingerprints = new Set<string>();
      let fingerprint: string | undefined;
      let provider: "primary" | "secondary" = "primary";

      for (let page = 0; page < config.maxPagesPerBlock; page += 1) {
        const query = new URLSearchParams({
          event_name: "Transfer",
          block_number: blockNumber,
          limit: "200",
        });
        if (fingerprint) {
          query.set("fingerprint", fingerprint);
        }
        const rpc = await client.request<TronEventsResponse>(
          `/v1/contracts/${config.tokenContract}/events?${query.toString()}`,
          { method: "GET" },
        );
        if (!rpc.ok) {
          return { ok: false, error: rpc.error, provider: rpc.provider };
        }
        provider = rpc.provider;
        const rows = rpc.data.data ?? [];
        for (const event of rows) {
          const mapped = mapEvent(event, config.tokenContract);
          if (mapped) collected.push(mapped);
        }
        const next = rpc.data.meta?.fingerprint;
        if (!next) {
          return { ok: true, value: collected, provider };
        }
        if (seenFingerprints.has(next) || next === fingerprint) {
          return {
            ok: false,
            error: "repeated_fingerprint",
            provider,
          };
        }
        seenFingerprints.add(next);
        fingerprint = next;
      }
      return {
        ok: false,
        error: "pagination_page_limit_exceeded",
        provider,
      };
    },

    async getTransactionExists(txHash) {
      const rpc = await client.request<TronTransactionResponse>("/wallet/gettransactionbyid", {
        method: "POST",
        body: JSON.stringify({ value: txHash }),
      });
      if (!rpc.ok) return { ok: false, error: rpc.error, provider: rpc.provider };
      return { ok: true, value: Boolean(rpc.data.txID), provider: rpc.provider };
    },

    async getConsolidatedBalanceAtBlock(): Promise<
      TreasuryChainAdapterResult<{ supported: false } | { supported: true; atomic: bigint }>
    > {
      return { ok: true, value: { supported: false }, provider: "primary" };
    },
  };
}
