import type { ChainAdapter } from "@/lib/waia-core/payment-watcher/chain-adapter.port";
import type { ObservedTransfer } from "@/lib/waia-core/payment-watcher/watcher-cycle.types";
import {
  createTronRpcClient,
  type TronRpcClient,
} from "@/lib/waia-core/payment-watcher/tron-rpc-client";
import type { WatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";

type TronBlockResponse = {
  block_header?: {
    raw_data?: {
      number?: number;
      timestamp?: number;
    };
  };
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
};

type TronTransactionResponse = {
  txID?: string;
  ret?: Array<{ contractRet?: string }>;
};

const USDT_DECIMALS_DIVISOR = 10 ** 6;

function pickAddress(
  result: Record<string, string> | undefined,
  hexKey: string,
  namedKey: string,
): string {
  if (!result) {
    return "";
  }
  const named = result[namedKey];
  if (named && named.startsWith("T")) {
    return named;
  }
  const hex = result[hexKey];
  if (hex && hex.startsWith("T")) {
    return hex;
  }
  return named ?? hex ?? "";
}

function formatUsdtAmount(raw: string): string {
  const value = BigInt(raw || "0");
  const whole = Number(value) / USDT_DECIMALS_DIVISOR;
  return whole.toFixed(6);
}

function mapEventToTransfer(
  event: TronEventRow,
  tipBlock: number,
  contractAddress: string,
): ObservedTransfer | null {
  if (!event.transaction_id || event.block_number === undefined) {
    return null;
  }
  if (event.contract_address && event.contract_address !== contractAddress) {
    return null;
  }
  const toAddress = pickAddress(event.result, "1", "to");
  const fromAddress = pickAddress(event.result, "0", "from");
  const amountRaw = event.result?.value ?? event.result?.["2"] ?? "0";
  if (!toAddress) {
    return null;
  }
  const blockHeight = String(event.block_number);
  const confirmationsObserved = Math.max(1, tipBlock - event.block_number + 1);
  return {
    txHash: event.transaction_id,
    transferIndex: event.event_index ?? 0,
    toAddress,
    fromAddress,
    contractAddress,
    amountRaw,
    amountDecimal: formatUsdtAmount(amountRaw),
    blockHeight,
    blockTimestamp: new Date(event.block_timestamp ?? Date.now()),
    confirmationsObserved,
  };
}

export function createTronAdapter(config: WatcherConfig, rpcClient?: TronRpcClient): ChainAdapter {
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
      if (!rpc.ok) {
        return { ok: false, error: rpc.error, provider: rpc.provider };
      }
      const number = rpc.data.block_header?.raw_data?.number;
      if (number === undefined) {
        return {
          ok: false,
          error: "missing block number in getnowblock response",
          provider: rpc.provider,
        };
      }
      return { ok: true, value: String(number), provider: rpc.provider };
    },

    async getTransfersInRange(fromBlock, toBlock) {
      const tipResult = await this.getTipBlock();
      if (!tipResult.ok) {
        return tipResult;
      }
      const tipBlock = Number.parseInt(tipResult.value, 10);
      const query = new URLSearchParams({
        event_name: "Transfer",
        only_confirmed: "true",
        min_block_number: fromBlock,
        max_block_number: toBlock,
        limit: "200",
      });
      const rpc = await client.request<TronEventsResponse>(
        `/v1/contracts/${config.tronContractAddress}/events?${query.toString()}`,
        { method: "GET" },
      );
      if (!rpc.ok) {
        return { ok: false, error: rpc.error, provider: rpc.provider };
      }
      const transfers = (rpc.data.data ?? [])
        .map((event) => mapEventToTransfer(event, tipBlock, config.tronContractAddress))
        .filter((row): row is ObservedTransfer => row !== null);
      return { ok: true, value: transfers, provider: rpc.provider };
    },

    async getTransactionExists(txHash) {
      const rpc = await client.request<TronTransactionResponse>(`/wallet/gettransactionbyid`, {
        method: "POST",
        body: JSON.stringify({ value: txHash }),
      });
      if (!rpc.ok) {
        return { ok: false, error: rpc.error, provider: rpc.provider };
      }
      const exists = Boolean(rpc.data.txID);
      return { ok: true, value: exists, provider: rpc.provider };
    },
  };
}
