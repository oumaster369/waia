// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTronAdapter } from "@/lib/waia-core/payment-watcher/tron-adapter";
import { runWatcherCycle } from "@/lib/waia-core/payment-watcher/run-watcher-cycle";
import { loadWatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";
import type { WatcherDeps } from "@/lib/waia-core/payment-watcher/watcher-cycle.types";

const now = new Date("2026-09-26T10:00:00.000Z");
const org = "00000000-0000-4000-8000-000000001116";
const config = () => loadWatcherConfig({
  WATCHER_ENABLED: "true", WATCHER_CONFIRM_QUORUM: "false",
  WATCHER_MAX_BLOCKS_PER_CYCLE: "2", WATCHER_RESCAN_WINDOW: "1",
  WATCHER_RPC_MAX_RETRIES: "1", WATCHER_START_BLOCK: "100",
  TRON_RPC_PRIMARY_URL: "https://primary.invalid", TRON_RPC_SECONDARY_URL: "https://secondary.invalid",
  TRONGRID_API_KEY: "synthetic-primary", TRON_RPC_SECONDARY_API_KEY: "synthetic-secondary",
});
const event = (id = "transfer", block = 100, raw = "30000000") => ({
  block_number: block, block_timestamp: now.getTime(), transaction_id: id,
  event_index: 0, event_name: "Transfer", contract_address: config().tronContractAddress,
  result: { from: "TSender", to: "TOwned", value: raw },
});
const page = (data: unknown[] = [], fingerprint?: string) => ({
  success: true, data, meta: fingerprint === undefined ? {} : { fingerprint },
});
type Transport = (url: URL, init: RequestInit | undefined) => unknown;
function transport(handler: Transport) {
  const requests: URL[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(["primary.invalid", "secondary.invalid"]).toContain(url.hostname);
    requests.push(url);
    const response = handler(url, init);
    return response instanceof Response ? response : new Response(JSON.stringify(response));
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, requests };
}
function eventsOnly(handler: Transport): Transport {
  return (url, init) => url.pathname === "/wallet/getnowblock"
    ? { block_header: { raw_data: { number: 120 } } }
    : handler(url, init);
}
function harness(settings = config()) {
  let cursor = "100";
  const checkpoint = { network: "TRC-20", lastScannedBlock: cursor, lastScannedAt: now, leaseUntil: null };
  const checkpointRepository = {
    load: vi.fn(async () => ({ ...checkpoint, lastScannedBlock: cursor })),
    bootstrap: vi.fn(async () => checkpoint), tryAcquireLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => {}), recordError: vi.fn(async () => {}),
    saveProgress: vi.fn(async (_network: string, block: string) => { cursor = block; }),
  };
  const detectPayment = vi.fn(async () => ({ paymentId: "payment-1116", status: "DETECTED" }));
  const confirmPayment = vi.fn(async () => ({ status: "CONFIRMED" }));
  const failPayment = vi.fn(async () => {});
  const resolver = vi.fn(async (_network: string, address: string) => address === "TOwned" ? {
    organizationId: org, addressId: "address-1116", subjectModule: "trader", subjectRef: "account-1116", status: "ACTIVATED",
  } : null);
  const deps = {
    config: settings, chainAdapter: createTronAdapter(settings), checkpointRepository,
    paymentService: { detectPayment, confirmPayment, failPayment },
    inboundResolver: { resolveOwnerByDepositAddress: resolver },
    logger: { log: vi.fn() }, now: () => now, listDetectedInboundPayments: vi.fn(async () => []),
  } as unknown as WatcherDeps;
  return { deps, checkpointRepository, detectPayment, confirmPayment, failPayment, resolver, cursor: () => cursor };
}
function noEffects(h: ReturnType<typeof harness>) {
  expect(h.detectPayment).not.toHaveBeenCalled();
  expect(h.confirmPayment).not.toHaveBeenCalled();
  expect(h.failPayment).not.toHaveBeenCalled();
  expect(h.checkpointRepository.saveProgress).not.toHaveBeenCalled();
  expect(h.cursor()).toBe("100");
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("payment observation integrity through actual RPC, adapter and cycle", () => {
  it("reads every block/page before effects, deduplicates overlap and keeps query identity", async () => {
    const h = harness();
    const first = Array.from({ length: 200 }, (_, n) => ({ ...event(`unowned-${n}`), result: { from: "TSender", to: "TUnknown", value: "1" } }));
    const { requests } = transport(eventsOnly(url => {
      noEffects(h);
      expect(url.pathname).toBe(`/v1/contracts/${config().tronContractAddress}/events`);
      expect(Object.keys(Object.fromEntries(url.searchParams)).sort()).toEqual(
        url.searchParams.has("fingerprint") ? ["block_number", "event_name", "fingerprint", "limit", "only_confirmed"] : ["block_number", "event_name", "limit", "only_confirmed"],
      );
      expect(url.searchParams.get("event_name")).toBe("Transfer");
      expect(url.searchParams.get("limit")).toBe("200");
      expect(url.searchParams.get("only_confirmed")).toBe("true");
      if (url.searchParams.get("block_number") === "101") return page();
      if (!url.searchParams.has("fingerprint")) return page(first, "next /?&=");
      expect(url.searchParams.get("fingerprint")).toBe("next /?&=");
      return page([first[0], event()]);
    }));
    const result = await runWatcherCycle(h.deps);
    expect(result.outcome).toBe("success");
    expect(requests.filter(url => url.pathname.endsWith("/events"))).toHaveLength(3);
    expect(h.confirmPayment).toHaveBeenCalledTimes(1);
    expect(h.confirmPayment).toHaveBeenCalledWith({ organizationId: org }, expect.objectContaining({
      settlement: expect.objectContaining({ settlementAmount: "30.000000", settlementNetwork: "TRC-20", settlementTxHash: "transfer", transferIndex: 0 }),
    }));
    expect(h.detectPayment).toHaveBeenCalledWith({ organizationId: org }, expect.objectContaining({ idempotencyKey: "TRC-20:transfer:0" }));
    expect(h.cursor()).toBe("101");
  });

  it.each([
    ["HTTP error", () => new Response("unavailable", { status: 503 })],
    ["application error", () => ({ success: false, error: "failed", data: [event("untrusted")] })],
    ["missing success", () => ({ data: [] })],
    ["wrong success type", (): unknown => ({ success: "true", data: [], meta: {} })],
    ["missing rows", () => ({ success: true, meta: {} })],
    ["null rows", () => ({ success: true, data: null, meta: {} })],
    ["missing metadata", () => ({ success: true, data: [] })],
    ["null envelope", (): unknown => null],
    ["null row", () => page([null])],
    ["malformed metadata", () => ({ success: true, data: [], meta: [] })],
    ["invalid cursor", () => ({ success: true, data: [], meta: { fingerprint: 1 } })],
    ["next URL without cursor", () => ({ success: true, data: [], meta: { links: { next: "https://untrusted.invalid/" } } })],
    ["full page without continuation", () => page(Array.from({ length: 200 }, (_, n) => event(`full-${n}`)))],
    ["more than requested limit", () => page(Array.from({ length: 201 }, (_, n) => event(`large-${n}`)))],
    ["repeated cursor", () => page([event()], "page2")],
    ["cross block", () => page([event("other-block", 101)])],
    ["wrong contract", () => page([{ ...event(), contract_address: "TOtherContract" }])],
    ["conflicting same identity", () => page([event("first", 100, "1")])],
  ] as const)("refuses %s on later page without payment or cursor effects", async (_label, second) => {
    const h = harness();
    transport(eventsOnly(url => url.searchParams.has("fingerprint") ? second() : page([event("first")], "page2")));
    const result = await runWatcherCycle(h.deps);
    expect(result.outcome).toBe("noop_provider_error");
    noEffects(h);
    expect(h.checkpointRepository.recordError).toHaveBeenCalledOnce();
    expect(h.checkpointRepository.releaseLease).toHaveBeenCalledOnce();
  });

  it("refuses a later block failure after collecting an earlier valid block", async () => {
    const h = harness();
    transport(eventsOnly(url => url.searchParams.get("block_number") === "100" ? page([event()]) : { success: false }));
    expect((await runWatcherCycle(h.deps)).outcome).toBe("noop_provider_error");
    noEffects(h);
  });

  it("stops bounded pagination at 20 pages without exposing a partial range", async () => {
    const h = harness(); let pageNumber = 0;
    const { requests } = transport(eventsOnly(() => page([event(`p-${++pageNumber}`)], `cursor-${pageNumber}`)));
    const result = await runWatcherCycle(h.deps);
    expect(result).toMatchObject({ outcome: "noop_provider_error", errorMessage: "pagination_page_limit_exceeded" });
    expect(requests.filter(url => url.pathname.endsWith("/events"))).toHaveLength(20);
    noEffects(h);
  });

  it("never follows an arbitrary next URL or moves keys outside configured hosts", async () => {
    transport(eventsOnly((url, init) => {
      expect((init?.headers as Record<string, string>)["TRON-PRO-API-KEY"]).toBe("synthetic-primary");
      return url.searchParams.has("fingerprint") ? page([event()]) : {
        ...page([], "opaque"), meta: { fingerprint: "opaque", links: { next: "https://untrusted.invalid/steal?key=anything" } },
      };
    }));
    const result = await createTronAdapter(config()).getTransfersInRange("100", "100");
    expect(result.ok).toBe(true);
  });

  it.each(["tip-to-first-page", "later-page", "later-block", "outer-tip-to-inner-tip"])("refuses provider drift at %s", async stage => {
    const h = harness(); let tips = 0;
    transport((url) => {
      const primary = url.hostname === "primary.invalid";
      if (url.pathname === "/wallet/getnowblock") {
        if (primary) tips += 1;
        if (stage === "outer-tip-to-inner-tip" && tips > 1 && primary) return new Response("fail", { status: 503 });
        return { block_header: { raw_data: { number: 120 } } };
      }
      const changed = stage === "tip-to-first-page" || stage === "outer-tip-to-inner-tip"
        || (stage === "later-page" && url.searchParams.has("fingerprint"))
        || (stage === "later-block" && url.searchParams.get("block_number") === "101");
      if (changed && primary) return new Response("fail", { status: 503 });
      return stage === "later-page" && !url.searchParams.has("fingerprint") ? page([event()], "next") : page([event(`ok-${url.searchParams.get("block_number")}`, Number(url.searchParams.get("block_number")))]);
    });
    const result = await runWatcherCycle(h.deps);
    expect(result).toMatchObject({ outcome: "noop_provider_error", errorMessage: "observation_provider_changed" });
    noEffects(h);
  });

  it("retains whole-observation secondary failover when the primary is unavailable", async () => {
    const h = harness();
    transport(url => url.hostname === "primary.invalid" ? new Response("unavailable", { status: 503 })
      : eventsOnly(u => u.searchParams.get("block_number") === "100" ? page([event()]) : page())(url, undefined));
    expect(await runWatcherCycle(h.deps)).toMatchObject({ outcome: "success", provider: "secondary" });
    expect(h.confirmPayment).toHaveBeenCalledOnce();
  });

  it("accepts terminal page 20 and resets continuation state for the next block", async () => {
    const counts = new Map<string, number>();
    transport(eventsOnly(url => {
      const block = url.searchParams.get("block_number")!;
      const count = (counts.get(block) ?? 0) + 1; counts.set(block, count);
      expect(url.searchParams.get("fingerprint")).toBe(count === 1 ? null : `next-${count}`);
      return page([event(`${block}-${count}`, Number(block))], count < 20 ? `next-${count + 1}` : undefined);
    }));
    const result = await createTronAdapter(config()).getTransfersInRange("100", "101");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(40);
    expect([...counts.values()]).toEqual([20, 20]);
  });

  it("refuses a non-immediate cursor cycle even through empty pages", async () => {
    let n = 0;
    const { requests } = transport(eventsOnly(() => page([], ["A", "B", "A"][n++])));
    expect(await createTronAdapter(config()).getTransfersInRange("100", "100")).toMatchObject({ ok: false, error: "repeated_fingerprint" });
    expect(requests.filter(url => url.pathname.endsWith("/events"))).toHaveLength(3);
  });

  it.each([
    { transaction_id: "" }, { event_index: undefined }, { event_index: -1 }, { event_index: 0.5 },
    { block_number: "100" }, { block_number: 100.5 }, { contract_address: undefined },
    { event_name: "Approval" }, { block_timestamp: undefined }, { block_timestamp: "123" },
    { block_timestamp: 9_000_000_000_000_000 }, { result: null },
    { result: { to: 123, from: "TSender", value: "1" } },
  ])("refuses malformed event identity %j without partial effects", async patch => {
    const h = harness();
    transport(eventsOnly(() => page([event("first"), { ...event("malformed"), ...patch }])));
    expect((await runWatcherCycle(h.deps)).outcome).toBe("noop_provider_error"); noEffects(h);
  });

  it("snapshots query contract and work bound before awaiting the first response", async () => {
    const settings = config(); const contract = settings.tronContractAddress;
    const adapter = createTronAdapter(settings); let pages = 0;
    transport(eventsOnly(url => {
      settings.tronContractAddress = "changed-contract"; settings.maxBlocksPerCycle = 0;
      expect(url.pathname).toBe(`/v1/contracts/${contract}/events`);
      return ++pages === 1 ? page([event()], "next") : page();
    }));
    expect((await adapter.getTransfersInRange("100", "100")).ok).toBe(true);
    expect(pages).toBe(2);
  });

  it("retains disabled precedence with no RPC or checkpoint activity", async () => {
    const h = harness({ ...config(), enabled: false, confirmQuorum: true });
    const { fetch } = transport(eventsOnly(() => page()));
    expect((await runWatcherCycle(h.deps)).outcome).toBe("noop_disabled");
    expect(fetch).not.toHaveBeenCalled(); expect(h.checkpointRepository.load).not.toHaveBeenCalled(); noEffects(h);
  });

  it.each([
    ["0", "0.000000"], ["1", "0.000001"], ["30000000", "30.000000"],
    ["9007199254740991", "9007199254.740991"], ["9007199254740993", "9007199254.740993"],
    ["999999999999999999999999", "999999999999999999.999999"],
  ])("preserves atomic amount %s exactly through settlement evidence", async (raw, decimal) => {
    const h = harness();
    transport(eventsOnly(url => url.searchParams.get("block_number") === "100" ? page([event("amount", 100, raw)]) : page()));
    expect((await runWatcherCycle(h.deps)).outcome).toBe("success");
    expect(h.confirmPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      settlement: expect.objectContaining({ settlementAmount: decimal, valuedAmountUsd: decimal }),
    }));
  });

  it.each(["-1", "1.0", "1e6", "0x10", "", " 1 ", "+1", null, 1, undefined])("refuses malformed atomic amount %s", async raw => {
    const h = harness();
    transport(eventsOnly(() => page([{ ...event(), result: { from: "TSender", to: "TOwned", value: raw } }])));
    expect((await runWatcherCycle(h.deps)).outcome).toBe("noop_provider_error"); noEffects(h);
  });

  it.each([["-1", "100"], ["100x", "100"], ["101", "100"], ["100", "102"], ["9007199254740993", "9007199254740993"]])("rejects invalid/unbounded range %s..%s before RPC", async (from, to) => {
    const { fetch } = transport(eventsOnly(() => page()));
    expect((await createTronAdapter(config()).getTransfersInRange(from, to)).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses explicit unsupported quorum before even opening a checkpoint", async () => {
    const h = harness({ ...config(), confirmQuorum: true });
    const { fetch } = transport(eventsOnly(() => page([event()])));
    expect(await runWatcherCycle(h.deps)).toMatchObject({ outcome: "noop_unsupported_configuration", errorMessage: "WATCHER_CONFIRM_QUORUM_UNSUPPORTED" });
    noEffects(h); expect(fetch).not.toHaveBeenCalled(); expect(h.checkpointRepository.load).not.toHaveBeenCalled();
    expect(h.checkpointRepository.tryAcquireLease).not.toHaveBeenCalled();
  });

  it("preserves depth refusal and keeps unowned transfers outside the payment service", async () => {
    const h = harness({ ...config(), startBlock: "119" });
    transport(eventsOnly(url => url.searchParams.get("block_number") === "119" ? page([
      event("shallow", 119), { ...event("foreign", 119), result: { from: "TSender", to: "TUnknown", value: "1" } },
    ]) : page()));
    expect((await runWatcherCycle(h.deps)).outcome).toBe("success");
    expect(h.detectPayment).toHaveBeenCalledOnce(); expect(h.confirmPayment).not.toHaveBeenCalled();
    expect(h.detectPayment).toHaveBeenCalledWith({ organizationId: org }, expect.objectContaining({ idempotencyKey: "TRC-20:shallow:0" }));
  });
});
