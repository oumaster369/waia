import { afterEach, describe, expect, it, vi } from "vitest";

import { createTronAdapter } from "@/lib/waia-core/payment-watcher/tron-adapter";
import { createTronRpcClient } from "@/lib/waia-core/payment-watcher/tron-rpc-client";
import { loadWatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";

describe("TronAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses contract Transfer events with consistent secondary failover on 429", async () => {
    const config = loadWatcherConfig({
      TRON_RPC_PRIMARY_URL: "https://primary.example",
      TRON_RPC_SECONDARY_URL: "https://secondary.example",
    });

    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "primary.example") return new Response("rate limited", { status: 429 });
      const data = url.pathname === "/wallet/getnowblock"
        ? { block_header: { raw_data: { number: 120, timestamp: Date.now() } } }
        : {
            success: true, meta: {},
            data: url.searchParams.get("block_number") === "110" ? [
              {
                block_number: 110,
                block_timestamp: Date.now(),
                transaction_id: "abc123",
                event_index: 0,
                event_name: "Transfer",
                contract_address: config.tronContractAddress,
                result: { to: "TDepositAddr", from: "TSender", value: "1500000" },
              },
            ] : [],
          };
      return new Response(JSON.stringify(data), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createTronRpcClient({
      primaryUrl: config.tronPrimaryUrl,
      secondaryUrl: config.tronSecondaryUrl,
      apiKey: "",
      secondaryApiKey: "",
      maxRetries: 1,
      timeoutMs: 5_000,
    });
    const adapter = createTronAdapter(config, client);

    const transfers = await adapter.getTransfersInRange("100", "115");
    expect(transfers.ok).toBe(true);
    if (transfers.ok) {
      expect(transfers.value).toHaveLength(1);
      expect(transfers.value[0]?.amountDecimal).toBe("1.500000");
      expect(transfers.provider).toBe("secondary");
    }

  });
});
