import { describe, expect, it } from "vitest";

import {
  ConnectorNotSupportedError,
  HtxExchangeConnector,
  createExchangeConnector,
  createExchangeConnectorFromId,
} from "@/lib/trader/connectors";
import { HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";
import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";
import {
  HTX_PERMISSION_PROBE_WARNING,
  HTX_TRADE_PERMISSION_WARNING,
} from "@/lib/trader/connectors/htx/mappers";

const VALID_CREDS = {
  apiKey: "test-access-key",
  apiSecret: "test-secret-key",
};

const SPOT_ACCOUNT_ID = 100009;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(
  handlers: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>,
) {
  const sortedPatterns = Object.keys(handlers).sort((a, b) => b.length - a.length);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    for (const pattern of sortedPatterns) {
      if (url.pathname.includes(pattern) || url.pathname === pattern) {
        return handlers[pattern]!(url, init);
      }
    }
    throw new Error(`Unhandled HTX mock fetch: ${url.toString()} method=${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

function defaultHandlers(
  overrides: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>> = {},
) {
  const canceledOrderIds = new Set<string>();
  const base: Record<string, (url: URL, init?: RequestInit) => Response> = {
    "/v1/account/accounts": () =>
      jsonResponse({
        status: "ok",
        data: [{ id: SPOT_ACCOUNT_ID, type: "spot", state: "working" }],
      }),
    "/v2/user/uid": () => jsonResponse({ code: 200, data: 63628520 }),
    "/v2/user/api-key": () =>
      jsonResponse({
        code: 200,
        data: [
          {
            accessKey: VALID_CREDS.apiKey,
            permission: "readOnly",
            status: "normal",
          },
        ],
      }),
    "/v1/account/accounts/": (url) => {
      if (url.pathname.endsWith("/balance")) {
        return jsonResponse({
          status: "ok",
          data: {
            id: SPOT_ACCOUNT_ID,
            type: "spot",
            state: "working",
            list: [
              { currency: "usdt", type: "trade", balance: "1000" },
              { currency: "usdt", type: "frozen", balance: "50" },
              { currency: "btc", type: "trade", balance: "0.5" },
            ],
          },
        });
      }
      return jsonResponse({ status: "error", "err-code": "not-found", "err-msg": "missing" }, 404);
    },
    "/v1/order/openOrders": () =>
      jsonResponse({
        status: "ok",
        data: [
          {
            id: 357630527817871,
            symbol: "btcusdt",
            price: "65000",
            amount: "0.01",
            "created-at": 1630633835224,
            type: "buy-limit",
            "filled-amount": "0",
            state: "submitted",
            "client-order-id": "client-1",
          },
        ],
      }),
    "/v1/order/orders/place": (url, init) => {
      expect(init?.method).toBe("POST");
      expect(url.searchParams.get("SignatureMethod")).toBe("HmacSHA256");
      expect(url.searchParams.get("SignatureVersion")).toBe("2");
      expect(url.searchParams.has("Signature")).toBe(true);
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      expect(body.source).toBe("spot-api");
      expect(body["account-id"]).toBe(String(SPOT_ACCOUNT_ID));
      return jsonResponse({ status: "ok", data: 357630527817872 });
    },
    "/v1/order/orders/": (url, init) => {
      if (url.pathname.endsWith("/submitcancel")) {
        expect(init?.method).toBe("POST");
        const orderId = url.pathname.split("/").slice(-2)[0]!;
        canceledOrderIds.add(orderId);
        return jsonResponse({ status: "ok", data: Number(orderId) });
      }
      const orderId = url.pathname.split("/").pop()!;
      return jsonResponse({
        status: "ok",
        data: {
          id: Number(orderId),
          symbol: "btcusdt",
          price: "65000",
          amount: "0.01",
          "created-at": 1630633835224,
          type: "buy-limit",
          "filled-amount": "0",
          state: canceledOrderIds.has(orderId) ? "canceled" : "submitted",
          "client-order-id": "client-1",
        },
      });
    },
    "/v1/order/matchresults": (url) => {
      const start = Number(url.searchParams.get("start-time"));
      const end = Number(url.searchParams.get("end-time"));
      expect(end - start).toBeLessThanOrEqual(48 * 60 * 60 * 1000 + 1);
      return jsonResponse({
        status: "ok",
        data: [
          {
            id: 313288753120940,
            symbol: "btcusdt",
            "order-id": 345487249132375,
            "trade-id": 1085,
            price: "65000",
            "created-at": end - 1000,
            type: "buy-market",
            "filled-amount": "0.01",
            "filled-fees": "0.1",
            "fee-currency": "usdt",
          },
        ],
      });
    },
    "/market/detail/merged": () =>
      jsonResponse({
        status: "ok",
        ts: 1629788763750,
        tick: { close: 49820.92, bid: [49819.48, 2.58], ask: [49819.49, 0.002] },
      }),
  };

  return createMockFetch({ ...base, ...overrides });
}

function createHtxConnector(fetchImpl: typeof fetch): HtxExchangeConnector {
  return new HtxExchangeConnector({
    apiKey: VALID_CREDS.apiKey,
    apiSecret: VALID_CREDS.apiSecret,
    restHost: HTX_DEFAULT_REST_HOST,
    fetchImpl,
  });
}

async function validatedHtx(fetchImpl: typeof fetch): Promise<HtxExchangeConnector> {
  const connector = createHtxConnector(fetchImpl);
  const result = await connector.validateCredentials(VALID_CREDS);
  expect(result.valid).toBe(true);
  return connector;
}

describe("trader connector registry HTX (DEE-195)", () => {
  it("createExchangeConnector resolves htx with credentials", () => {
    const connector = createExchangeConnector("htx", {
      credentials: VALID_CREDS,
      fetchImpl: createMockFetch({}),
    });
    expect(connector.venueId).toBe("htx");
  });

  it("createExchangeConnectorFromId resolves htx with credentials", () => {
    const connector = createExchangeConnectorFromId("htx", {
      credentials: VALID_CREDS,
      fetchImpl: createMockFetch({}),
    });
    expect(connector.venueId).toBe("htx");
  });

  it("requires credentials for htx factory", () => {
    expect(() => createExchangeConnector("htx", {} as never)).toThrow(/requires credentials/);
  });
});

describe("HtxExchangeConnector credentials (DEE-195)", () => {
  it("validates credentials against accounts + permission probe", async () => {
    const connector = createHtxConnector(defaultHandlers());
    const result = await connector.validateCredentials(VALID_CREDS);
    expect(result.valid).toBe(true);
    expect(result.accountId).toBe(String(SPOT_ACCOUNT_ID));
  });

  it("rejects withdraw permission", async () => {
    const connector = createHtxConnector(
      defaultHandlers({
        "/v2/user/api-key": () =>
          jsonResponse({
            code: 200,
            data: [
              { accessKey: VALID_CREDS.apiKey, permission: "readOnly,withdraw", status: "normal" },
            ],
          }),
      }),
    );
    const result = await connector.validateCredentials(VALID_CREDS);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("FORBIDDEN_PERMISSION");
  });

  it("warns when trade permission is present", async () => {
    const connector = createHtxConnector(
      defaultHandlers({
        "/v2/user/api-key": () =>
          jsonResponse({
            code: 200,
            data: [
              { accessKey: VALID_CREDS.apiKey, permission: "readOnly,trade", status: "normal" },
            ],
          }),
      }),
    );
    const result = await connector.validateCredentials(VALID_CREDS);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain(HTX_TRADE_PERMISSION_WARNING);
  });

  it("returns safe-default warning when permission probe fails", async () => {
    const connector = createHtxConnector(
      defaultHandlers({
        "/v2/user/uid": () => jsonResponse({ code: 500, message: "fail" }),
      }),
    );
    const result = await connector.validateCredentials(VALID_CREDS);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain(HTX_PERMISSION_PROBE_WARNING);
  });

  it("fails cleanly on auth error", async () => {
    const connector = createHtxConnector(
      defaultHandlers({
        "/v1/account/accounts": () =>
          jsonResponse({
            status: "error",
            "err-code": "login-required",
            "err-msg": "login required",
          }),
      }),
    );
    const result = await connector.validateCredentials(VALID_CREDS);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("login-required");
  });

  it("ignores passphrase in credential input", async () => {
    const connector = createHtxConnector(defaultHandlers());
    const result = await connector.validateCredentials({ ...VALID_CREDS, passphrase: "ignored" });
    expect(result.valid).toBe(true);
  });
});

describe("HtxExchangeConnector reads (DEE-195)", () => {
  it("maps balances and account info", async () => {
    const connector = await validatedHtx(defaultHandlers());
    const balances = await connector.getBalances();
    expect(balances.find((b) => b.asset === "USDT")?.total).toBe("1050");
    expect(balances.find((b) => b.asset === "BTC")?.free).toBe("0.5");

    const info = await connector.getAccountInfo();
    expect(info.venue).toBe("htx");
    expect(info.permissions).toContain("read");
  });

  it("maps open orders and requires symbol filter", async () => {
    const connector = await validatedHtx(defaultHandlers());
    await expect(connector.getOpenOrders()).rejects.toThrow(/requires filter.symbol/);

    const orders = await connector.getOpenOrders({ symbol: "BTC/USDT" });
    expect(orders[0]?.symbol).toBe("BTC/USDT");
    expect(orders[0]?.side).toBe("buy");
    expect(orders[0]?.status).toBe("open");
  });

  it("maps order by id", async () => {
    const connector = await validatedHtx(defaultHandlers());
    const order = await connector.getOrder("357630527817871");
    expect(order?.orderId).toBe("357630527817871");
    expect(order?.symbol).toBe("BTC/USDT");
  });

  it("fails unknown on a missing venue order identity and preserves the raw row", async () => {
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/": () => jsonResponse({
        status: "ok",
        data: {
          symbol: "btcusdt",
          price: "65000",
          amount: "0.01",
          "created-at": 1630633835224,
          type: "buy-limit",
          "filled-amount": "0",
          state: "submitted",
          "client-order-id": "client-1",
        },
      }),
    }));
    await expect(connector.getOrder("357630527817871")).rejects.toMatchObject({
      name: "HtxUnknownVenueIdentityError",
      rawVenueObservation: { symbol: "btcusdt", state: "submitted" },
    });
  });

  it.each(["amount", "filled-amount"])(
    "fails unknown rather than inventing missing order %s evidence",
    async (missingField) => {
      const row: Record<string, unknown> = {
        id: 357630527817871,
        symbol: "btcusdt",
        price: "65000",
        amount: "0.01",
        "created-at": 1630633835224,
        type: "buy-limit",
        "filled-amount": "0",
        state: "submitted",
        "client-order-id": "client-1",
      };
      delete row[missingField];
      const connector = await validatedHtx(defaultHandlers({
        "/v1/order/orders/": () => jsonResponse({ status: "ok", data: row }),
      }));
      await expect(connector.getOrder("357630527817871")).rejects.toMatchObject({
        name: "HtxUnknownOrderEvidenceError",
        rawVenueObservation: { id: 357630527817871, state: "submitted" },
      });
    },
  );

  it("maps trade history within 48h window", async () => {
    const connector = await validatedHtx(defaultHandlers());
    await expect(connector.getTradeHistory()).rejects.toThrow(/requires filter.symbol/);

    const trades = await connector.getTradeHistory({ symbol: "BTC/USDT", limit: 10 });
    expect(trades[0]?.tradeId).toBe("1085");
    expect(trades[0]?.symbol).toBe("BTC/USDT");
  });

  it("fails unknown rather than inventing missing trade fee evidence", async () => {
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/matchresults": () => jsonResponse({
        status: "ok",
        data: [{
          id: 313288753120940,
          symbol: "btcusdt",
          "order-id": 345487249132375,
          "trade-id": 1085,
          price: "65000",
          "created-at": 1630633835224,
          type: "buy-market",
          "filled-amount": "0.01",
        }],
      }),
    }));
    await expect(connector.getTradeHistory({ symbol: "BTC/USDT" })).rejects.toMatchObject({
      name: "HtxUnknownTradeEvidenceError",
      rawVenueObservation: { "trade-id": 1085, "order-id": 345487249132375 },
    });
  });

  it("streams public market data snapshots", async () => {
    const connector = await validatedHtx(defaultHandlers());
    const events = [];
    for await (const event of connector.streamMarketData(["BTC/USDT"])) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.lastPrice).toBe("49820.92");
  });
});

describe("HtxExchangeConnector write foundation (DEE-211)", () => {
  it("submits exactly one signed POST, performs no lookup, and preserves the raw acknowledgement", async () => {
    let placementPosts = 0;
    let orderGets = 0;
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/place": (url, init) => {
        placementPosts += 1;
        expect(init?.method).toBe("POST");
        expect(url.searchParams.has("Signature")).toBe(true);
        return jsonResponse({ status: "ok", data: 357630527817872 });
      },
      "/v1/order/orders/": () => {
        orderGets += 1;
        return jsonResponse({ status: "ok", data: null });
      },
    }));
    await expect(connector.placeOrder({
      clientOrderId: "client-new-1",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.01",
    })).rejects.toMatchObject({
      name: "HtxPlacementFailUnknownError",
      rawVenueObservation: {
        venueResponseObserved: true,
        httpStatus: 200,
        responseBody: { status: "ok", data: 357630527817872 },
      },
    });
    expect(placementPosts).toBe(1);
    expect(orderGets).toBe(0);
  });

  it("fails unknown on an unrecognized HTX state and preserves the raw row", async () => {
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/": (url) => {
        const orderId = url.pathname.split("/").pop()!;
        return jsonResponse({
          status: "ok",
          data: {
            id: Number(orderId),
            symbol: "btcusdt",
            price: "65000",
            amount: "0.01",
            "created-at": 1630633835224,
            type: "buy-limit",
            "filled-amount": "0",
            state: "venue-state-not-in-contract",
            "client-order-id": "client-1",
          },
        });
      },
    }));
    await expect(connector.getOrder("357630527817872")).rejects.toMatchObject({
      name: "HtxUnknownOrderStateError",
      rawVenueObservation: {
        state: "venue-state-not-in-contract",
        id: 357630527817872,
      },
    });
  });

  it("fails unknown on undocumented HTX order mechanics and preserves the raw row", async () => {
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/": (url) => {
        const orderId = url.pathname.split("/").pop()!;
        return jsonResponse({
          status: "ok",
          data: {
            id: Number(orderId),
            symbol: "btcusdt",
            price: "65000",
            amount: "0.01",
            "created-at": 1630633835224,
            type: "buy-stop-limit",
            "filled-amount": "0",
            state: "submitted",
            "client-order-id": "client-1",
          },
        });
      },
    }));
    await expect(connector.getOrder("357630527817872")).rejects.toMatchObject({
      name: "HtxUnknownOrderMechanicsError",
      rawVenueObservation: {
        type: "buy-stop-limit",
        id: 357630527817872,
      },
    });
  });

  it.each([429, 503])("never retries an HTX placement HTTP %i response", async (status) => {
    let placementPosts = 0;
    let orderGets = 0;
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/place": () => {
        placementPosts += 1;
        return jsonResponse({ status: "error", "err-code": `http-${status}` }, status);
      },
      "/v1/order/orders/": () => {
        orderGets += 1;
        return jsonResponse({ status: "ok", data: null });
      },
    }));
    await expect(connector.placeOrder({
      clientOrderId: `client-http-${status}`,
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.01",
    })).rejects.toMatchObject({
      name: "HtxPlacementFailUnknownError",
      rawVenueObservation: { venueResponseObserved: true, httpStatus: status },
    });
    expect(placementPosts).toBe(1);
    expect(orderGets).toBe(0);
  });

  it("redacts echoed signed request credentials while retaining a response digest", async () => {
    let signature = "";
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/place": (url) => {
        signature = url.searchParams.get("Signature") ?? "";
        return jsonResponse({
          status: "error",
          message: `proxy echoed ${url.toString()}`,
          AccessKeyId: VALID_CREDS.apiKey,
          nested: {
            Signature: signature,
            secret: VALID_CREDS.apiSecret,
            [`echo-${VALID_CREDS.apiKey}-${signature}`]: "credential-bearing property name",
          },
        }, 502);
      },
    }));
    let captured: unknown;
    try {
      await connector.placeOrder({
        clientOrderId: "client-echo-redaction",
        symbol: "BTC/USDT",
        side: "buy",
        type: "limit",
        price: "65000",
        quantity: "0.01",
      });
    } catch (error) {
      captured = error;
    }
    const serialized = JSON.stringify(captured);
    expect(signature).not.toBe("");
    expect(serialized).not.toContain(VALID_CREDS.apiKey);
    expect(serialized).not.toContain(VALID_CREDS.apiSecret);
    expect(serialized).not.toContain(signature);
    expect(serialized).toContain("[REDACTED]");
    expect(captured).toMatchObject({
      rawVenueObservation: {
        venueResponseObserved: true,
        httpStatus: 502,
        responseBodyDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
  });

  it("fails unknown after one transport attempt without claiming a venue response", async () => {
    let placementPosts = 0;
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/place": () => {
        placementPosts += 1;
        throw new TypeError(
          "https://api.huobi.pro/v1/order/orders/place?AccessKeyId=secret&Signature=secret",
        );
      },
    }));
    let captured: unknown;
    try {
      await connector.placeOrder({
        clientOrderId: "client-timeout",
        symbol: "BTC/USDT",
        side: "buy",
        type: "limit",
        price: "65000",
        quantity: "0.01",
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({
      name: "HtxPlacementFailUnknownError",
      rawVenueObservation: {
        venueResponseObserved: false,
        transportFailure: "NETWORK_REQUEST_FAILED",
      },
    });
    expect(placementPosts).toBe(1);
    expect(JSON.stringify(captured)).not.toContain("AccessKeyId");
    expect(JSON.stringify(captured)).not.toContain("Signature");
  });

  it("preserves observed HTTP status when response body reading fails", async () => {
    let placementPosts = 0;
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/place": () => {
        placementPosts += 1;
        return {
          status: 503,
          ok: false,
          text: async () => { throw new Error("body stream failed"); },
        } as unknown as Response;
      },
    }));
    await expect(connector.placeOrder({
      clientOrderId: "client-body-read-failure",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.01",
    })).rejects.toMatchObject({
      name: "HtxPlacementFailUnknownError",
      rawVenueObservation: {
        venueResponseObserved: true,
        httpStatus: 503,
        httpOk: false,
        responseBodyRead: "FAILED",
      },
    });
    expect(placementPosts).toBe(1);
  });

  it("bounds an unresponsive placement by the sealed timeout and fails unknown", async () => {
    let placementPosts = 0;
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/place": () => {
        placementPosts += 1;
        return new Promise<Response>(() => undefined);
      },
    }));
    await expect(connector.placeOrder({
      clientOrderId: "client-policy-timeout",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.01",
      timeoutMs: 10,
    })).rejects.toMatchObject({
      name: "HtxPlacementFailUnknownError",
      rawVenueObservation: {
        venueResponseObserved: false,
        transportFailure: "NETWORK_TIMEOUT",
        timeoutMs: 10,
      },
    });
    expect(placementPosts).toBe(1);
  });

  it("bounds an unresponsive response body by the same sealed timeout", async () => {
    let placementPosts = 0;
    const connector = await validatedHtx(defaultHandlers({
      "/v1/order/orders/place": () => {
        placementPosts += 1;
        return {
          status: 202,
          ok: true,
          text: () => new Promise<string>(() => undefined),
        } as unknown as Response;
      },
    }));
    await expect(connector.placeOrder({
      clientOrderId: "client-policy-body-timeout",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.01",
      timeoutMs: 10,
    })).rejects.toMatchObject({
      name: "HtxPlacementFailUnknownError",
      rawVenueObservation: {
        venueResponseObserved: true,
        httpStatus: 202,
        httpOk: true,
        responseBodyRead: "TIMED_OUT",
        transportFailure: "NETWORK_TIMEOUT",
        timeoutMs: 10,
      },
    });
    expect(placementPosts).toBe(1);
  });

  it("cancels an order via signed POST", async () => {
    const connector = await validatedHtx(defaultHandlers());
    const canceled = await connector.cancelOrder("357630527817871");
    expect(canceled.orderId).toBe("357630527817871");
    expect(canceled.status).toBe("canceled");
  });

  it("rejects disallowed symbols for writes", async () => {
    const connector = await validatedHtx(defaultHandlers());
    await expect(
      connector.placeOrder({
        clientOrderId: "x",
        symbol: "SOL/USDT",
        side: "buy",
        type: "limit",
        price: "1",
        quantity: "1",
      }),
    ).rejects.toBeInstanceOf(HtxConnectorValidationError);
  });

  it("rejects disallowed symbols for reads", async () => {
    const connector = await validatedHtx(defaultHandlers());
    await expect(connector.getOpenOrders({ symbol: "SOL/USDT" })).rejects.toBeInstanceOf(
      HtxConnectorValidationError,
    );
  });

  it("requires clientOrderId for placeOrder", async () => {
    const connector = await validatedHtx(defaultHandlers());
    await expect(
      connector.placeOrder({
        clientOrderId: "  ",
        symbol: "ETH/USDT",
        side: "sell",
        type: "market",
        quantity: "0.1",
      }),
    ).rejects.toThrow(/requires clientOrderId/);
  });

  it("throws ConnectorNotSupportedError for futures stubs", async () => {
    const connector = await validatedHtx(defaultHandlers());
    await expect(connector.getFuturesBalances()).rejects.toBeInstanceOf(ConnectorNotSupportedError);
    await expect(connector.getFuturesPositions()).rejects.toBeInstanceOf(
      ConnectorNotSupportedError,
    );
  });
});

describe("HtxExchangeConnector streamUserData stub (DEE-195)", () => {
  it("yields no events (no private websocket)", async () => {
    const connector = await validatedHtx(defaultHandlers());
    const events = [];
    for await (const event of connector.streamUserData()) {
      events.push(event);
    }
    expect(events).toHaveLength(0);
  });
});

// Optional live smoke: set HTX_LIVE_INTEGRATION=1 with real credentials locally (never in CI).
