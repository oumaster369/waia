// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHtxDerivativesAccountTransport,
  HTX_DERIVATIVES_READ_ONLY_POST_PATHS,
} from "@/lib/trader/account-observation/derivatives/htx-account-transport";
import { parseHtxDerivativesFillsPage } from "@/lib/trader/account-observation/derivatives/parser";
import { createHtxDerivativesObservationReader } from "@/lib/trader/account-observation/derivatives/reader";
import {
  HTX_DERIVATIVES_FILL_LOOKBACK_MS,
  HTX_DERIVATIVES_FILL_MAX_PAGES,
  HTX_DERIVATIVES_FILL_MAX_ROWS,
  type HtxDerivativesAccountFamily,
  type HtxDerivativesFillContract,
} from "@/lib/trader/account-observation/derivatives/types";
import type { HtxObservationCredentialHandle } from "@/lib/trader/account-observation/htx-reader-opener";
import type { ObservationBinding, ObservationClock } from "@/lib/trader/account-observation/types";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES } from "@/lib/trader/account-observation/derivatives/types";

const now = 1_780_261_200_000;
const fillAt = now - 60_000;
const binding: ObservationBinding = Object.freeze({
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "123",
  credentialRevision: "7",
  configurationRevision: "config-v1",
});
const key = "synthetic_fill_key";
const secret = "synthetic-fill-secret";
const clock: ObservationClock = {
  now: () => now,
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const abort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }),
};
const signal = () => new AbortController().signal;

const accountPayloads: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: `{"status":"ok","ts":${now},"data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT","margin_mode":"isolated","margin_balance":"10.25","margin_available":"9.75"}]}`,
  usdt_cross_shared: `{"status":"ok","ts":${now},"data":[{"margin_account":"USDT","margin_asset":"USDT","margin_mode":"cross","margin_balance":"20.5","withdraw_available":"18"}]}`,
  coin_perpetual: `{"status":"ok","ts":${now},"data":[{"symbol":"THETA","contract_code":"THETA-USD","margin_balance":"0.25","margin_available":"0.2"}]}`,
  coin_delivery_futures: `{"status":"ok","ts":${now},"data":[{"symbol":"BTC","margin_balance":"0.5","margin_available":"0.4"}]}`,
};
const positionPayloads: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT","direction":"buy","volume":"1","available":"1","frozen":"0","cost_open":"10","cost_hold":"10","profit_unreal":"0","position_margin":"1","lever_rate":2}]}`,
  usdt_cross_shared: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"USDT","margin_asset":"USDT","direction":"sell","volume":"1","available":"1","frozen":"0","cost_open":"10","cost_hold":"10","profit_unreal":"0","position_margin":"1","lever_rate":2}]}`,
  coin_perpetual: `{"status":"ok","data":[{"symbol":"THETA","contract_code":"THETA-USD","direction":"buy","volume":"1","available":"1","frozen":"0","cost_open":"10","cost_hold":"10","profit_unreal":"0","position_margin":"1","lever_rate":2}]}`,
  coin_delivery_futures: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC201225","contract_type":"quarter","direction":"sell","volume":"1","available":"1","frozen":"0","cost_open":"10","cost_hold":"10","profit_unreal":"0","position_margin":"1","lever_rate":2}]}`,
};
const accountPaths: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: "/linear-swap-api/v1/swap_account_info",
  usdt_cross_shared: "/linear-swap-api/v1/swap_cross_account_info",
  coin_perpetual: "/swap-api/v1/swap_account_info",
  coin_delivery_futures: "/api/v1/contract_account_info",
};
const positionPaths: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: "/linear-swap-api/v1/swap_position_info",
  usdt_cross_shared: "/linear-swap-api/v1/swap_cross_position_info",
  coin_perpetual: "/swap-api/v1/swap_position_info",
  coin_delivery_futures: "/api/v1/contract_position_info",
};
const fillPaths: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: "/linear-swap-api/v3/swap_matchresults",
  usdt_cross_shared: "/linear-swap-api/v3/swap_cross_matchresults",
  coin_perpetual: "/swap-api/v3/swap_matchresults",
  coin_delivery_futures: "/api/v3/contract_matchresults",
};

function venueRow(
  family: HtxDerivativesAccountFamily,
  contract: string,
  patch: Record<string, unknown> = {},
) {
  const symbol =
    family === "coin_delivery_futures" ? contract.slice(0, -6) : contract.split("-")[0]!;
  return {
    id: `${contract}-1`,
    match_id: "100",
    order_id_str: "200",
    symbol,
    contract_code: contract,
    contract_type: family === "coin_delivery_futures" ? "quarter" : "swap",
    direction: "buy",
    offset: "open",
    trade_volume: "1",
    trade_price: "60000.1",
    trade_fee: "-0.01",
    fee_asset: family.startsWith("usdt_") ? "USDT" : symbol,
    real_profit: "0",
    offset_profitloss: "0E-18",
    create_date: fillAt,
    order_source: "api",
    query_id: 10,
    ...(family === "usdt_isolated_perpetual"
      ? { margin_mode: "isolated", margin_account: contract }
      : {}),
    ...(family === "usdt_cross_shared" ? { margin_mode: "cross", margin_account: "USDT" } : {}),
    ...patch,
  };
}
function page(rows: readonly Record<string, unknown>[], ts: number | null = now) {
  return JSON.stringify(ts === null ? { code: 200, data: rows } : { code: 200, ts, data: rows });
}
const emptyPage = page([]);

function setup(
  options: {
    families?: readonly HtxDerivativesAccountFamily[];
    fillContracts?: readonly HtxDerivativesFillContract[];
    pages?: Readonly<Record<string, readonly string[]>>;
    verify?: (
      binding: ObservationBinding,
      keyDigest: string,
      signal: AbortSignal,
    ) => Promise<boolean>;
    fillResponse?: (url: string, init: RequestInit | undefined, call: number) => Response;
  } = {},
) {
  const families = options.families ?? [...HTX_DERIVATIVES_ACCOUNT_FAMILIES];
  const fillContracts =
    options.fillContracts ??
    families.map((family) => ({
      family,
      contract:
        family === "usdt_isolated_perpetual"
          ? "BTC-USDT"
          : family === "usdt_cross_shared"
            ? "ETH-USDT"
            : family === "coin_perpetual"
              ? "THETA-USD"
              : "BTC201225",
    }));
  const calls = new Map<string, number>();
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    const family = HTX_DERIVATIVES_ACCOUNT_FAMILIES.find(
      (item) =>
        accountPaths[item] === pathname ||
        positionPaths[item] === pathname ||
        fillPaths[item] === pathname,
    );
    if (!family) return new Response("not found", { status: 404 });
    if (pathname === accountPaths[family]) return new Response(accountPayloads[family]);
    if (pathname === positionPaths[family]) return new Response(positionPayloads[family]);
    const call = (calls.get(pathname) ?? 0) + 1;
    calls.set(pathname, call);
    if (options.fillResponse) return options.fillResponse(String(url), init, call);
    const contract = fillContracts.find((item) => item.family === family)?.contract ?? "";
    const script = options.pages?.[family] ?? [page([venueRow(family, contract)]), emptyPage];
    return new Response(script[call - 1] ?? emptyPage);
  });
  const verifyReadOnlyAdmission = options.verify ?? vi.fn(async () => true);
  const credential = { binding: { ...binding }, apiKey: key, apiSecret: secret, dispose: vi.fn() };
  const reader = createHtxDerivativesObservationReader({
    credential: credential as HtxObservationCredentialHandle,
    families,
    fillContracts,
    clock,
    fetchImpl,
    timeoutMs: 1_000,
    maxResponseBytes: 200_000,
    verifyReadOnlyAdmission,
  });
  return { reader, fetchImpl, verifyReadOnlyAdmission, fillContracts, credential };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HTX derivatives match-results allowlist", () => {
  it("exposes exactly the twelve read-only POST routes", () => {
    expect([...HTX_DERIVATIVES_READ_ONLY_POST_PATHS].sort()).toEqual([
      "/api/v1/contract_account_info",
      "/api/v1/contract_position_info",
      "/api/v3/contract_matchresults",
      "/linear-swap-api/v1/swap_account_info",
      "/linear-swap-api/v1/swap_cross_account_info",
      "/linear-swap-api/v1/swap_cross_position_info",
      "/linear-swap-api/v1/swap_position_info",
      "/linear-swap-api/v3/swap_cross_matchresults",
      "/linear-swap-api/v3/swap_matchresults",
      "/swap-api/v1/swap_account_info",
      "/swap-api/v1/swap_position_info",
      "/swap-api/v3/swap_matchresults",
    ]);
    expect(HTX_DERIVATIVES_READ_ONLY_POST_PATHS.join(" ")).not.toMatch(
      /order|transfer|hisorders|openorders|exact/i,
    );
  });

  it("sends the closed match-results template and rejects an over-wide window", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(emptyPage);
    });
    const transport = createHtxDerivativesAccountTransport({
      binding: {
        organizationId: binding.organizationId,
        credentialId: binding.credentialId,
        credentialRevision: "7",
      },
      accessKey: key,
      secret,
      host: "api.hbdm.com",
      timeoutMs: 1_000,
      maxResponseBytes: 20_000,
      clock,
      fetchImpl,
      verifyReadAdmission: async () => true,
    });
    await expect(
      transport.readFills(
        "usdt_isolated_perpetual",
        "BTC-USDT",
        now - HTX_DERIVATIVES_FILL_LOOKBACK_MS - 1,
        now,
        undefined,
        signal(),
      ),
    ).rejects.toThrow("INVALID_RESPONSE");
    expect(fetchImpl).not.toHaveBeenCalled();
    await transport.readFills(
      "coin_delivery_futures",
      "BTC201225",
      now - 1_000,
      now,
      undefined,
      signal(),
    );
    await transport.readFills(
      "usdt_isolated_perpetual",
      "BTC-USDT",
      now - 1_000,
      now,
      "15",
      signal(),
    );
    expect(JSON.parse(bodies[0]!)).toEqual({
      contract: "BTC201225",
      trade_type: 0,
      start_time: now - 1_000,
      end_time: now,
      direct: "next",
      symbol: "BTC",
    });
    expect(JSON.parse(bodies[1]!)).toEqual({
      contract: "BTC-USDT",
      trade_type: 0,
      start_time: now - 1_000,
      end_time: now,
      direct: "next",
      from_id: 15,
    });
    expect(bodies.join(" ")).not.toMatch(/"pair"/);
    await expect(
      transport.readFills("usdt_isolated_perpetual", "BTC-USDT", now - 1_000, now, "01", signal()),
    ).rejects.toThrow("INVALID_RESPONSE");
    await transport.settled();
  });
});

describe("HTX derivatives fill parser", () => {
  it("keys on id, keeps duplicate match ids, and preserves signed decimals", () => {
    const parsed = parseHtxDerivativesFillsPage(
      "usdt_isolated_perpetual",
      "BTC-USDT",
      page([
        venueRow("usdt_isolated_perpetual", "BTC-USDT", {
          id: "fill-a",
          match_id: "55",
          trade_fee: "-1.25",
          real_profit: "-3.5",
          offset_profitloss: "0E-18",
        }),
        venueRow("usdt_isolated_perpetual", "BTC-USDT", {
          id: "fill-b",
          match_id: "55",
          query_id: 11,
          trade_fee: "0",
        }),
      ]),
    );
    expect(parsed.fills.map((row) => row.id)).toEqual(["fill-a", "fill-b"]);
    expect(parsed.fills.map((row) => row.matchId)).toEqual(["55", "55"]);
    expect(parsed.fills[0]).toMatchObject({
      fee: "-1.25",
      realizedPnl: "-3.5",
      offsetPnl: "0E-18",
      feeAsset: "USDT",
      executedAtMs: fillAt,
    });
    expect(parsed.fills[1]?.fee).toBe("0");
    expect(parsed.nextFromId).toBe("11");
  });

  it("treats a missing fee as null and rejects a duplicate id", () => {
    const missing = parseHtxDerivativesFillsPage(
      "coin_perpetual",
      "THETA-USD",
      page([venueRow("coin_perpetual", "THETA-USD", { trade_fee: undefined, fee_asset: "THETA" })]),
    );
    expect(missing.fills[0]?.fee).toBeNull();
    expect(missing.fills[0]?.feeAsset).toBe("THETA");
    const explicitNull = parseHtxDerivativesFillsPage(
      "coin_perpetual",
      "THETA-USD",
      page([venueRow("coin_perpetual", "THETA-USD", { trade_fee: null })]),
    );
    expect(explicitNull.fills[0]?.fee).toBeNull();
    const repeated = parseHtxDerivativesFillsPage(
      "usdt_cross_shared",
      "BTC-USDT",
      page([
        venueRow("usdt_cross_shared", "BTC-USDT", { id: "same" }),
        venueRow("usdt_cross_shared", "BTC-USDT", { id: "same", query_id: 12 }),
      ]),
    );
    expect(repeated.fills.map((row) => row.id)).toEqual(["same"]);
    expect(repeated.nextFromId).toBe("12");
    expect(() =>
      parseHtxDerivativesFillsPage(
        "usdt_cross_shared",
        "BTC-USDT",
        page([
          venueRow("usdt_cross_shared", "BTC-USDT", { id: "same" }),
          venueRow("usdt_cross_shared", "BTC-USDT", {
            id: "same",
            trade_volume: "9",
            query_id: 12,
          }),
        ]),
      ),
    ).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
    expect(() =>
      parseHtxDerivativesFillsPage(
        "usdt_isolated_perpetual",
        "BTC-USDT",
        page([venueRow("usdt_isolated_perpetual", "BTC-USDT", { contract_code: "ETH-USDT" })]),
      ),
    ).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
    expect(() =>
      parseHtxDerivativesFillsPage(
        "usdt_isolated_perpetual",
        "BTC-USDT",
        page([venueRow("usdt_isolated_perpetual", "BTC-USDT", { margin_mode: "cross" })]),
      ),
    ).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
    expect(() =>
      parseHtxDerivativesFillsPage(
        "coin_delivery_futures",
        "BTC201225",
        `{"status":"ok","data":[]}`,
      ),
    ).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
  });
});

describe("HTX derivatives fill reader", () => {
  it.each(HTX_DERIVATIVES_ACCOUNT_FAMILIES)(
    "reads %s fills on the existing family path",
    async (family) => {
      const f = setup({ families: [family] });
      const result = await f.reader.readDerivativesAccount(family, signal());
      expect(result.snapshot.accounts).toHaveLength(1);
      expect(result.executions.status).toBe("COMPLETE");
      expect(result.executions.values).toHaveLength(1);
      expect(result.executions.values?.[0]?.contractCode).toBe(f.fillContracts[0]?.contract);
      expect(result.executions.windowEndMs! - result.executions.windowStartMs!).toBe(
        HTX_DERIVATIVES_FILL_LOOKBACK_MS,
      );
      const paths = vi.mocked(f.fetchImpl).mock.calls.map(([url]) => new URL(String(url)).pathname);
      expect(paths).toEqual([
        accountPaths[family],
        positionPaths[family],
        fillPaths[family],
        fillPaths[family],
      ]);
      expect(paths.every((path) => HTX_DERIVATIVES_READ_ONLY_POST_PATHS.includes(path))).toBe(true);
      await f.reader.settled();
    },
  );

  it("does not call match-results when no contract set is configured", async () => {
    const f = setup({ families: ["usdt_cross_shared"], fillContracts: [] });
    const result = await f.reader.readDerivativesAccount("usdt_cross_shared", signal());
    expect(result.executions).toMatchObject({
      status: "NOT_CONFIGURED",
      coverage: "NOT_CONFIGURED",
      values: null,
    });
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    await f.reader.settled();
  });

  it("keeps one cross collateral row while reading two configured contracts", async () => {
    const contracts = [
      { family: "usdt_cross_shared" as const, contract: "BTC-USDT" },
      { family: "usdt_cross_shared" as const, contract: "ETH-USDT-211217" },
    ];
    const f = setup({
      families: ["usdt_cross_shared"],
      fillContracts: contracts,
      pages: {
        usdt_cross_shared: [
          page([venueRow("usdt_cross_shared", "BTC-USDT", { id: "cross-btc" })]),
          emptyPage,
          page([
            venueRow("usdt_cross_shared", "ETH-USDT-211217", {
              id: "cross-eth",
              symbol: "ETH",
              query_id: 20,
            }),
          ]),
          emptyPage,
        ],
      },
    });
    const result = await f.reader.readDerivativesAccount("usdt_cross_shared", signal());
    expect(result.snapshot.accounts).toEqual([
      expect.objectContaining({ accountCode: "USDT", marginBalance: "20.5" }),
    ]);
    expect(result.executions.status).toBe("COMPLETE");
    expect(result.executions.contracts).toEqual(["BTC-USDT", "ETH-USDT-211217"]);
    expect(result.executions.values?.map((row) => row.id)).toEqual(["cross-btc", "cross-eth"]);
    expect(result.snapshot.accounts).toHaveLength(1);
    await f.reader.settled();
  });

  it("dedups an overlapping identical id and rejects a conflicting id", async () => {
    const same = venueRow("usdt_isolated_perpetual", "BTC-USDT", { id: "fill-a", query_id: 10 });
    const overlap = setup({
      families: ["usdt_isolated_perpetual"],
      pages: {
        usdt_isolated_perpetual: [
          page([same]),
          page([
            same,
            venueRow("usdt_isolated_perpetual", "BTC-USDT", { id: "fill-b", query_id: 11 }),
          ]),
          emptyPage,
        ],
      },
    });
    const overlapped = await overlap.reader.readDerivativesAccount(
      "usdt_isolated_perpetual",
      signal(),
    );
    expect(overlapped.executions.status).toBe("COMPLETE");
    expect(overlapped.executions.values?.map((row) => row.id)).toEqual(["fill-a", "fill-b"]);
    await overlap.reader.settled();

    const conflict = setup({
      families: ["usdt_isolated_perpetual"],
      pages: {
        usdt_isolated_perpetual: [
          page([same]),
          page([
            venueRow("usdt_isolated_perpetual", "BTC-USDT", {
              id: "fill-a",
              trade_volume: "9",
              query_id: 12,
            }),
          ]),
        ],
      },
    });
    const conflicted = await conflict.reader.readDerivativesAccount(
      "usdt_isolated_perpetual",
      signal(),
    );
    expect(conflicted.snapshot.accounts[0]?.marginBalance).toBe("10.25");
    expect(conflicted.executions).toMatchObject({
      status: "ERROR",
      values: null,
      error: "INVALID_RESPONSE",
    });
    await conflict.reader.settled();
  });

  it("marks a page or row cap PARTIAL and keeps verified rows", async () => {
    const pages = Array.from({ length: HTX_DERIVATIVES_FILL_MAX_PAGES }, (_, index) =>
      page([venueRow("coin_perpetual", "THETA-USD", { id: `page-${index}`, query_id: index + 1 })]),
    );
    const capped = setup({ families: ["coin_perpetual"], pages: { coin_perpetual: pages } });
    const cappedResult = await capped.reader.readDerivativesAccount("coin_perpetual", signal());
    expect(cappedResult.executions.status).toBe("PARTIAL");
    expect(cappedResult.executions.values).toHaveLength(HTX_DERIVATIVES_FILL_MAX_PAGES);
    await capped.reader.settled();

    const first = Array.from({ length: HTX_DERIVATIVES_FILL_MAX_ROWS }, (_, index) =>
      venueRow("coin_delivery_futures", "BTC201225", { id: `row-${index}`, query_id: index + 1 }),
    );
    const overflow = setup({
      families: ["coin_delivery_futures"],
      pages: {
        coin_delivery_futures: [
          page(first),
          page([venueRow("coin_delivery_futures", "BTC201225", { id: "overflow", query_id: 500 })]),
        ],
      },
    });
    const overflowResult = await overflow.reader.readDerivativesAccount(
      "coin_delivery_futures",
      signal(),
    );
    expect(overflowResult.executions.status).toBe("PARTIAL");
    expect(overflowResult.executions.values).toHaveLength(HTX_DERIVATIVES_FILL_MAX_ROWS);
    expect(overflowResult.executions.values?.some((row) => row.id === "overflow")).toBe(false);
    await overflow.reader.settled();
  });

  it("keeps an explicit zero and marks a missing fee partial", async () => {
    const zero = setup({
      families: ["usdt_isolated_perpetual"],
      pages: {
        usdt_isolated_perpetual: [
          page([venueRow("usdt_isolated_perpetual", "BTC-USDT", { trade_fee: "0" })]),
          emptyPage,
        ],
      },
    });
    const zeroResult = await zero.reader.readDerivativesAccount(
      "usdt_isolated_perpetual",
      signal(),
    );
    expect(zeroResult.executions.status).toBe("COMPLETE");
    expect(zeroResult.executions.values?.[0]?.fee).toBe("0");
    await zero.reader.settled();

    const missing = setup({
      families: ["usdt_isolated_perpetual"],
      pages: {
        usdt_isolated_perpetual: [
          page([venueRow("usdt_isolated_perpetual", "BTC-USDT", { trade_fee: undefined })]),
          emptyPage,
        ],
      },
    });
    const missingResult = await missing.reader.readDerivativesAccount(
      "usdt_isolated_perpetual",
      signal(),
    );
    expect(missingResult.executions.status).toBe("PARTIAL");
    expect(missingResult.executions.values?.[0]?.fee).toBeNull();
    await missing.reader.settled();
  });

  it("isolates a venue failure and refuses publication when admission is revoked", async () => {
    const limited = setup({
      families: ["coin_perpetual"],
      fillResponse: () => new Response("slow down", { status: 429 }),
    });
    const limitedResult = await limited.reader.readDerivativesAccount("coin_perpetual", signal());
    expect(limitedResult.snapshot.accounts[0]?.marginBalance).toBe("0.25");
    expect(limitedResult.positions.status).toBe("COMPLETE");
    expect(limitedResult.executions).toMatchObject({
      status: "ERROR",
      values: null,
      error: "RATE_LIMITED",
    });
    await limited.reader.settled();

    const before = setup({
      families: ["usdt_isolated_perpetual"],
      verify: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });
    await expect(
      before.reader.readDerivativesAccount("usdt_isolated_perpetual", signal()),
    ).rejects.toThrow("PERMISSION_DENIED");
    expect(before.fetchImpl).toHaveBeenCalledTimes(2);
    await before.reader.settled();

    const after = setup({
      families: ["usdt_isolated_perpetual"],
      verify: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });
    await expect(
      after.reader.readDerivativesAccount("usdt_isolated_perpetual", signal()),
    ).rejects.toThrow("PERMISSION_DENIED");
    expect(after.fetchImpl).toHaveBeenCalledTimes(3);
    await after.reader.settled();
  });

  it("rejects a contract outside the configured family before any request", () => {
    expect(() =>
      setup({
        families: ["usdt_isolated_perpetual"],
        fillContracts: [{ family: "usdt_cross_shared", contract: "BTC-USDT" }],
      }),
    ).toThrow("PERMISSION_DENIED");
  });
});

describe("saved fill projection", () => {
  const epoch = 1_800_000_000_000;
  const component = {
    status: "COMPLETE" as const,
    values: [] as const,
    sourceAsOfMs: null,
    readStartedAtMs: epoch,
    readCompletedAtMs: epoch + 50,
    error: null,
  };
  const account = (family: HtxDerivativesAccountFamily) => ({
    accountCode:
      family === "usdt_cross_shared"
        ? "USDT"
        : family === "usdt_isolated_perpetual"
          ? "BTC-USDT"
          : family === "coin_perpetual"
            ? "THETA-USD"
            : "BTC",
    collateralAsset: family.startsWith("usdt_")
      ? "USDT"
      : family === "coin_perpetual"
        ? "THETA"
        : "BTC",
    marginMode:
      family === "usdt_cross_shared"
        ? ("cross" as const)
        : family === "usdt_isolated_perpetual"
          ? ("isolated" as const)
          : null,
    marginBalance: "0",
    marginAvailable: family === "usdt_cross_shared" ? null : "0",
    withdrawAvailable: family === "usdt_cross_shared" ? "0" : null,
    marginPosition: null,
    marginFrozen: null,
    marginStatic: null,
    realizedPnl: null,
    unrealizedPnl: "0",
    riskRate: null,
    liquidationPrice: null,
    leverage: null,
  });
  const fill = {
    id: "fill-1",
    matchId: "55",
    orderId: "200",
    symbol: "BTC",
    contractCode: "BTC-USDT",
    contractType: "swap",
    direction: "buy" as const,
    offset: "open" as const,
    volume: "1",
    price: "10",
    fee: "0",
    feeAsset: "USDT",
    realizedPnl: "-1.5",
    offsetPnl: "0E-18",
    executedAtMs: epoch + 20,
    orderSource: "api",
  };
  function observation(executions: unknown, status: "COMPLETE" | "PARTIAL" = "COMPLETE"): unknown {
    return {
      schemaVersion: "account-observation/v2",
      observationId: "00000000-0000-4000-8000-000000000003",
      binding,
      collectionStartedAtMs: epoch,
      collectionCompletedAtMs: epoch + 100,
      status,
      balances: { ...component, values: [{ asset: "USDT", free: "1", locked: "0", total: "1" }] },
      holdings: [{ asset: "USDT", free: "1", locked: "0", total: "1" }],
      openOrders: component,
      trades: [{ symbol: "BTCUSDT", component }],
      derivatives: {
        schemaVersion: "htx-derivatives-observation/v1",
        families: HTX_DERIVATIVES_ACCOUNT_FAMILIES.map((family) => ({
          family,
          status: "COMPLETE" as const,
          accounts: [account(family)],
          readStartedAtMs: epoch + 10,
          readCompletedAtMs: epoch + 40,
          responseGeneratedAtMs: epoch + 30,
          error: null,
          ...(family === "usdt_isolated_perpetual" ? { executions } : {}),
        })),
      },
    };
  }
  it("accepts a legacy v2 family with no executions and a complete explicit-zero fill", () => {
    expect(parseAccountObservation(observation(undefined)).schemaVersion).toBe(
      "account-observation/v2",
    );
    const parsed = parseAccountObservation(
      observation({
        status: "COMPLETE",
        coverage: "CONFIGURED_CONTRACTS",
        values: [fill],
        contracts: ["BTC-USDT"],
        readStartedAtMs: epoch + 15,
        readCompletedAtMs: epoch + 35,
        responseGeneratedAtMs: epoch + 30,
        windowStartMs: epoch + 15 - 1_000,
        windowEndMs: epoch + 30,
        error: null,
      }),
    );
    expect(parsed.schemaVersion).toBe("account-observation/v2");
    if (parsed.schemaVersion !== "account-observation/v2" || parsed.derivatives === undefined)
      throw new Error("expected v2");
    expect(parsed.derivatives.families[0]?.executions?.values?.[0]?.offsetPnl).toBe("0E-18");
  });
  it("rejects a complete fill with a null fee and a not-configured family that carries executions", () => {
    expect(() =>
      parseAccountObservation(
        observation({
          status: "COMPLETE",
          coverage: "CONFIGURED_CONTRACTS",
          values: [{ ...fill, fee: null }],
          contracts: ["BTC-USDT"],
          readStartedAtMs: epoch + 15,
          readCompletedAtMs: epoch + 35,
          responseGeneratedAtMs: null,
          windowStartMs: epoch + 10,
          windowEndMs: epoch + 30,
          error: null,
        }),
      ),
    ).toThrow("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
    const notConfigured = observation(undefined) as {
      derivatives: { schemaVersion: string; families: Record<string, unknown>[] };
    };
    if (notConfigured.derivatives.schemaVersion !== "htx-derivatives-observation/v1")
      throw new Error("expected derivatives");
    notConfigured.derivatives.families[0] = {
      family: "usdt_isolated_perpetual",
      status: "NOT_CONFIGURED",
      accounts: null,
      readStartedAtMs: null,
      readCompletedAtMs: null,
      responseGeneratedAtMs: null,
      error: null,
      executions: {
        status: "NOT_CONFIGURED",
        coverage: "NOT_CONFIGURED",
        values: null,
        contracts: [],
        readStartedAtMs: epoch,
        readCompletedAtMs: epoch,
        responseGeneratedAtMs: null,
        windowStartMs: null,
        windowEndMs: null,
        error: null,
      },
    };
    expect(() => parseAccountObservation(notConfigured)).toThrow(
      "ACCOUNT_OBSERVATION_INVALID_PAYLOAD",
    );
  });
});
