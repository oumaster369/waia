import type { ChainAdapter } from "@/lib/waia-core/payment-watcher/chain-adapter.port";
import type { ObservedTransfer } from "@/lib/waia-core/payment-watcher/watcher-cycle.types";
import {
  createTronRpcClient,
  type TronRpcClient,
} from "@/lib/waia-core/payment-watcher/tron-rpc-client";
import type { WatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";

type TronTransactionResponse = {
  txID?: string;
  ret?: Array<{ contractRet?: string }>;
};

const USDT_DECIMALS_DIVISOR = 1_000_000n;
const EVENTS_PER_PAGE = 200;
// Operational bound only: exhaustion refuses the entire observation, never a partial range.
const MAX_PAGES_PER_BLOCK = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function parseBlock(value: string): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const block = Number(value);
  return isNonnegativeInteger(block) ? block : null;
}

function parseEventsPage(value: unknown): { rows: unknown[]; fingerprint?: string } {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.data)
    || !isRecord(value.meta) || value.data.length > EVENTS_PER_PAGE) {
    throw new Error("invalid_events_response");
  }
  const fingerprint = value.meta.fingerprint;
  if (fingerprint !== undefined && !isNonemptyString(fingerprint)) {
    throw new Error("invalid_pagination_fingerprint");
  }
  const links = value.meta.links;
  if (links !== undefined && (!isRecord(links)
    || (links.next !== undefined && !isNonemptyString(links.next)))) {
    throw new Error("invalid_pagination_metadata");
  }
  // A full page with no continuation is ambiguous; never infer completeness from the limit.
  if (fingerprint === undefined && (value.data.length === EVENTS_PER_PAGE
    || (isRecord(links) && links.next !== undefined))) {
    throw new Error("incomplete_pagination");
  }
  return { rows: value.data, fingerprint };
}

function pickAddress(
  result: Record<string, unknown>,
  hexKey: string,
  namedKey: string,
): string {
  const named = result[namedKey];
  if (isNonemptyString(named) && named.startsWith("T")) {
    return named;
  }
  const hex = result[hexKey];
  if (isNonemptyString(hex) && hex.startsWith("T")) {
    return hex;
  }
  const address = named ?? hex;
  if (!isNonemptyString(address)) throw new Error("invalid_transfer_address");
  return address;
}

function formatUsdtAmount(raw: string): string {
  const value = BigInt(raw);
  return `${value / USDT_DECIMALS_DIVISOR}.${(value % USDT_DECIMALS_DIVISOR).toString().padStart(6, "0")}`;
}

function mapEventToTransfer(
  event: unknown,
  queriedBlock: number,
  tipBlock: number,
  contractAddress: string,
): ObservedTransfer {
  if (!isRecord(event) || !isNonemptyString(event.transaction_id)
    || !isNonnegativeInteger(event.block_number) || event.block_number !== queriedBlock
    || !isNonnegativeInteger(event.event_index) || event.contract_address !== contractAddress
    || event.event_name !== "Transfer" || !isRecord(event.result)
    || !isNonnegativeInteger(event.block_timestamp)
    || !Number.isFinite(new Date(event.block_timestamp).getTime())) {
    throw new Error("invalid_transfer_identity");
  }
  const toAddress = pickAddress(event.result, "1", "to");
  const fromAddress = pickAddress(event.result, "0", "from");
  const amountRaw = event.result.value ?? event.result["2"];
  if (typeof amountRaw !== "string" || !/^\d+$/.test(amountRaw)) {
    throw new Error("invalid_transfer_atomic_amount");
  }
  const blockHeight = String(event.block_number);
  const confirmationsObserved = Math.max(1, tipBlock - event.block_number + 1);
  return {
    txHash: event.transaction_id,
    transferIndex: event.event_index,
    toAddress,
    fromAddress,
    contractAddress,
    amountRaw,
    amountDecimal: formatUsdtAmount(amountRaw),
    blockHeight,
    blockTimestamp: new Date(event.block_timestamp),
    confirmationsObserved,
  };
}

export function createTronAdapter(input: WatcherConfig, rpcClient?: TronRpcClient): ChainAdapter {
  // Continuation requests must not inherit a caller mutation between asynchronous pages.
  const config = { ...input };
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
      const rpc = await client.request<unknown>("/wallet/getnowblock", {
        method: "POST",
        body: "{}",
      });
      if (!rpc.ok) {
        return { ok: false, error: rpc.error, provider: rpc.provider };
      }
      const header = isRecord(rpc.data) ? rpc.data.block_header : undefined;
      const raw = isRecord(header) ? header.raw_data : undefined;
      const number = isRecord(raw) ? raw.number : undefined;
      if (!isNonnegativeInteger(number)) {
        return {
          ok: false,
          error: "missing block number in getnowblock response",
          provider: rpc.provider,
        };
      }
      return { ok: true, value: String(number), provider: rpc.provider };
    },

    async getTransfersInRange(fromBlock, toBlock) {
      const from = parseBlock(fromBlock);
      const to = parseBlock(toBlock);
      if (from === null || to === null || to < from
        || !Number.isSafeInteger(config.maxBlocksPerCycle) || config.maxBlocksPerCycle < 1
        || to - from + 1 > config.maxBlocksPerCycle) {
        return { ok: false, error: "invalid_observation_range", provider: null };
      }
      const tipResult = await this.getTipBlock();
      if (!tipResult.ok) {
        return tipResult;
      }
      const tipBlock = Number(tipResult.value);
      if (to > tipBlock) {
        return { ok: false, error: "observation_range_above_tip", provider: tipResult.provider };
      }
      const transfers = new Map<string, ObservedTransfer>();
      try {
        // TronGrid documents block_number, not min/max_block_number. Each block must finish.
        for (let block = from; block <= to; block += 1) {
          const seenFingerprints = new Set<string>();
          let fingerprint: string | undefined;
          for (let page = 0; page < MAX_PAGES_PER_BLOCK; page += 1) {
            const query = new URLSearchParams({
              event_name: "Transfer", only_confirmed: "true", block_number: String(block),
              limit: String(EVENTS_PER_PAGE),
            });
            if (fingerprint !== undefined) query.set("fingerprint", fingerprint);
            const rpc = await client.request<unknown>(
              `/v1/contracts/${encodeURIComponent(config.tronContractAddress)}/events?${query.toString()}`,
              { method: "GET" },
            );
            if (!rpc.ok) return { ok: false, error: rpc.error, provider: rpc.provider };
            if (rpc.provider !== tipResult.provider) throw new Error("observation_provider_changed");
            const parsed = parseEventsPage(rpc.data);
            for (const row of parsed.rows) {
              const transfer = mapEventToTransfer(row, block, tipBlock, config.tronContractAddress);
              const key = JSON.stringify([transfer.txHash, transfer.transferIndex]);
              const prior = transfers.get(key);
              if (prior && JSON.stringify(prior) !== JSON.stringify(transfer)) {
                throw new Error("conflicting_transfer_identity");
              }
              transfers.set(key, transfer);
            }
            if (parsed.fingerprint === undefined) break;
            if (seenFingerprints.has(parsed.fingerprint)) throw new Error("repeated_fingerprint");
            seenFingerprints.add(parsed.fingerprint);
            fingerprint = parsed.fingerprint;
            if (page + 1 === MAX_PAGES_PER_BLOCK) throw new Error("pagination_page_limit_exceeded");
          }
        }
        return { ok: true, value: [...transfers.values()], provider: tipResult.provider };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "invalid_observation", provider: tipResult.provider };
      }
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
