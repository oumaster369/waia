import { describe, expect, it } from "vitest";

import type {
  TronRpcClient,
  TronRpcResponse,
} from "@/lib/waia-core/payment-watcher/tron-rpc-client";
import { USDT_TRC20_CONTRACT } from "@/lib/waia-core/payment-watcher/watcher-config";
import { createTreasuryTronAdapter } from "@/lib/waia-core/treasury/watcher/tron-adapter";
import { HUGE_ATOMIC, watcherConfig } from "@/tests/unit/helpers/treasury-wp3";

type EventRow = {
  block_number: number;
  transaction_id: string;
  event_index: number;
  contract_address: string;
  result: { from: string; to: string; value: string };
};

function eventRow(index: number, value = "1000000"): EventRow {
  return {
    block_number: 105,
    transaction_id: `tx-${index}`,
    event_index: index,
    contract_address: USDT_TRC20_CONTRACT,
    result: { from: "TFrom", to: "TTo", value },
  };
}

function ok<T>(data: T): TronRpcResponse<T> {
  return { ok: true, data, provider: "primary" };
}

function createFakeRpc(handler: (path: string) => TronRpcResponse<unknown>): TronRpcClient {
  return {
    async request(path) {
      return handler(path) as TronRpcResponse<never>;
    },
  };
}

describe("DEE-606 WP-3 TronGrid adapter pagination and amounts", () => {
  it("16-17. exact raw event amount survives > Number.MAX_SAFE_INTEGER as bigint", async () => {
    const adapter = createTreasuryTronAdapter(
      watcherConfig(),
      createFakeRpc(() =>
        ok({
          data: [eventRow(0, HUGE_ATOMIC.toString(10))],
          meta: {},
        }),
      ),
    );
    const page = await adapter.getTransfersForBlock("105");
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value[0]?.nativeAmountAtomic).toBe(HUGE_ATOMIC);
    expect(typeof page.value[0]?.nativeAmountAtomic).toBe("bigint");
    expect(page.value[0]?.nativeAmountAtomic.toString(10)).toBe("9007199254740993");
    expect(BigInt(Number(page.value[0]!.nativeAmountAtomic.toString(10)))).not.toBe(HUGE_ATOMIC);
  });

  it("18. does not force only_confirmed=true", async () => {
    const paths: string[] = [];
    const adapter = createTreasuryTronAdapter(
      watcherConfig(),
      createFakeRpc((path) => {
        paths.push(path);
        return ok({ data: [], meta: {} });
      }),
    );
    await adapter.getTransfersForBlock("105");
    expect(paths[0]).toContain("event_name=Transfer");
    expect(paths[0]).toContain("block_number=105");
    expect(paths[0]).not.toContain("only_confirmed");
    expect(paths[0]).not.toContain("min_block_number");
    expect(paths[0]).not.toContain("max_block_number");
  });

  it("19. provider error fails closed", async () => {
    const adapter = createTreasuryTronAdapter(
      watcherConfig(),
      createFakeRpc(() => ({ ok: false, error: "rpc_down", provider: "primary", retryable: true })),
    );
    const page = await adapter.getTransfersForBlock("105");
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.error).toBe("rpc_down");
  });

  it("20. <=200 single page completes without fingerprint continuation", async () => {
    const paths: string[] = [];
    const adapter = createTreasuryTronAdapter(
      watcherConfig(),
      createFakeRpc((path) => {
        paths.push(path);
        return ok({ data: Array.from({ length: 3 }, (_, i) => eventRow(i)), meta: {} });
      }),
    );
    const page = await adapter.getTransfersForBlock("105");
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value).toHaveLength(3);
    expect(paths).toHaveLength(1);
    expect(paths[0]).not.toContain("fingerprint=");
  });

  it("21-23. >200 multi-page forwards fingerprint and keeps filters unchanged", async () => {
    const paths: string[] = [];
    const first = Array.from({ length: 200 }, (_, i) => eventRow(i));
    const second = Array.from({ length: 50 }, (_, i) => eventRow(200 + i));
    const adapter = createTreasuryTronAdapter(
      watcherConfig(),
      createFakeRpc((path) => {
        paths.push(path);
        const query = new URLSearchParams(path.split("?")[1] ?? "");
        if (!query.get("fingerprint")) {
          return ok({ data: first, meta: { fingerprint: "fp-2" } });
        }
        expect(query.get("fingerprint")).toBe("fp-2");
        expect(query.get("event_name")).toBe("Transfer");
        expect(query.get("block_number")).toBe("105");
        expect(query.get("limit")).toBe("200");
        return ok({ data: second, meta: {} });
      }),
    );
    const page = await adapter.getTransfersForBlock("105");
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value).toHaveLength(250);
    expect(paths).toHaveLength(2);
    expect(paths[1]).toContain("fingerprint=fp-2");
    expect(paths[1]).toContain("event_name=Transfer");
    expect(paths[1]).toContain("block_number=105");
    expect(paths[1]).toContain("limit=200");
  });

  it("24. overlapping page result is collected then ingest-idempotent at higher layer", async () => {
    const overlap = [eventRow(0), eventRow(1)];
    const adapter = createTreasuryTronAdapter(
      watcherConfig(),
      createFakeRpc((path) => {
        const query = new URLSearchParams(path.split("?")[1] ?? "");
        if (!query.get("fingerprint")) {
          return ok({ data: [...overlap, eventRow(2)], meta: { fingerprint: "fp-2" } });
        }
        return ok({ data: overlap, meta: {} });
      }),
    );
    const page = await adapter.getTransfersForBlock("105");
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value).toHaveLength(5);
    expect(page.value.filter((row) => row.txHash === "tx-0")).toHaveLength(2);
  });

  it("25. repeated fingerprint is detected and fails closed", async () => {
    const adapter = createTreasuryTronAdapter(
      watcherConfig({ maxPagesPerBlock: 5 }),
      createFakeRpc(() => ok({ data: [eventRow(0)], meta: { fingerprint: "loop" } })),
    );
    const page = await adapter.getTransfersForBlock("105");
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.error).toBe("repeated_fingerprint");
  });

  it("26. later-page failure prevents treating pagination as complete", async () => {
    let calls = 0;
    const adapter = createTreasuryTronAdapter(
      watcherConfig(),
      createFakeRpc(() => {
        calls += 1;
        if (calls === 1) {
          return ok({ data: [eventRow(0)], meta: { fingerprint: "fp-2" } });
        }
        return { ok: false, error: "page_2_failed", provider: "primary", retryable: true };
      }),
    );
    const page = await adapter.getTransfersForBlock("105");
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.error).toBe("page_2_failed");
  });

  it("53 capability: historical balance is unsupported on the Tron adapter", async () => {
    const adapter = createTreasuryTronAdapter(
      watcherConfig(),
      createFakeRpc(() => ok({})),
    );
    const balance = await adapter.getConsolidatedBalanceAtBlock?.({
      addresses: ["T1"],
      asOfBlock: "110",
      tokenContract: USDT_TRC20_CONTRACT,
    });
    expect(balance?.ok).toBe(true);
    if (!balance?.ok) return;
    expect(balance.value.supported).toBe(false);
  });
});
