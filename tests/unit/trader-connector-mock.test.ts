import { describe, expect, it } from "vitest";

import {
  ConnectorNotSupportedError,
  MockExchangeConnector,
  UnknownConnectorVenueError,
  createExchangeConnector,
  createExchangeConnectorFromId,
} from "@/lib/trader/connectors";

const VALID_CREDS = {
  apiKey: "mock-key-valid",
  apiSecret: "mock-secret",
};

async function validatedMock(): Promise<MockExchangeConnector> {
  const connector = new MockExchangeConnector();
  const result = await connector.validateCredentials(VALID_CREDS);
  expect(result.valid).toBe(true);
  return connector;
}

describe("trader connector registry (DEE-194)", () => {
  it("createExchangeConnector resolves mock", () => {
    const connector = createExchangeConnector("mock");
    expect(connector.venueId).toBe("mock");
    expect(connector.marketType).toBe("spot");
  });

  it("createExchangeConnectorFromId rejects unknown venue", () => {
    expect(() => createExchangeConnectorFromId("binance")).toThrow(UnknownConnectorVenueError);
  });

  it("createExchangeConnectorFromId requires credentials for htx", () => {
    expect(() => createExchangeConnectorFromId("htx")).toThrow(/requires credentials/);
  });
});

describe("MockExchangeConnector credentials (DEE-194)", () => {
  it("accepts synthetic valid credentials", async () => {
    const connector = new MockExchangeConnector();
    const result = await connector.validateCredentials(VALID_CREDS);
    expect(result.valid).toBe(true);
    expect(result.accountId).toBe("mock-account-1");
  });

  it("rejects invalid synthetic credentials", async () => {
    const connector = new MockExchangeConnector();
    const result = await connector.validateCredentials({
      apiKey: "invalid-key",
      apiSecret: "x",
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("requires validation before reads", async () => {
    const connector = new MockExchangeConnector();
    await expect(connector.getBalances()).rejects.toThrow(/requires validateCredentials/);
  });
});

describe("MockExchangeConnector reads (DEE-194)", () => {
  it("returns deterministic balances and positions after validation", async () => {
    const connector = await validatedMock();
    const balances = await connector.getBalances();
    expect(balances.some((b) => b.asset === "USDT" && b.free === "10000.00")).toBe(true);

    const positions = await connector.getPositions();
    expect(positions[0]?.symbol).toBe("BTC/USDT");
  });

  it("returns account info with spot permissions", async () => {
    const connector = await validatedMock();
    const info = await connector.getAccountInfo();
    expect(info.venue).toBe("mock");
    expect(info.marketType).toBe("spot");
    expect(info.permissions).toContain("trade");
  });
});

describe("MockExchangeConnector orders (DEE-194)", () => {
  it("places and retrieves a limit order", async () => {
    const connector = await validatedMock();
    const placed = await connector.placeOrder({
      clientOrderId: "client-limit-1",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "64000.00",
      quantity: "0.01",
    });

    expect(placed.status).toBe("open");
    expect(placed.clientOrderId).toBe("client-limit-1");

    const fetched = await connector.getOrder(placed.orderId);
    expect(fetched?.orderId).toBe(placed.orderId);

    const open = await connector.getOpenOrders({ symbol: "BTC/USDT" });
    expect(open.some((o) => o.orderId === placed.orderId)).toBe(true);
  });

  it("is idempotent for duplicate clientOrderId", async () => {
    const connector = await validatedMock();
    const first = await connector.placeOrder({
      clientOrderId: "client-dup-1",
      symbol: "BTC/USDT",
      side: "sell",
      type: "limit",
      price: "70000.00",
      quantity: "0.02",
    });
    const second = await connector.placeOrder({
      clientOrderId: "client-dup-1",
      symbol: "BTC/USDT",
      side: "sell",
      type: "limit",
      price: "70000.00",
      quantity: "0.02",
    });
    expect(second.orderId).toBe(first.orderId);
  });

  it("fills market orders and appends trade history", async () => {
    const connector = await validatedMock();
    const placed = await connector.placeOrder({
      clientOrderId: "client-market-1",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "0.01",
    });

    expect(placed.status).toBe("filled");
    expect(placed.filledQuantity).toBe("0.01");

    const trades = await connector.getTradeHistory({ symbol: "BTC/USDT" });
    expect(trades.some((t) => t.clientOrderId === "client-market-1")).toBe(true);
  });

  it("cancels an open limit order", async () => {
    const connector = await validatedMock();
    const placed = await connector.placeOrder({
      clientOrderId: "client-cancel-1",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "63000.00",
      quantity: "0.01",
    });

    const canceled = await connector.cancelOrder(placed.orderId);
    expect(canceled.status).toBe("canceled");

    const open = await connector.getOpenOrders();
    expect(open.some((o) => o.orderId === placed.orderId)).toBe(false);
  });
});

describe("MockExchangeConnector streams (DEE-194)", () => {
  it("streams deterministic market data ticks", async () => {
    const connector = await validatedMock();
    const events = [];
    for await (const event of connector.streamMarketData(["BTC/USDT"])) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.symbol).toBe("BTC/USDT");
    expect(events[0]?.lastPrice).toBe("65250.00");
  });

  it("streams user data snapshots after activity", async () => {
    const connector = await validatedMock();
    await connector.placeOrder({
      clientOrderId: "client-stream-1",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "0.01",
    });

    const kinds: string[] = [];
    for await (const event of connector.streamUserData()) {
      kinds.push(event.kind);
    }
    expect(kinds).toContain("balance_update");
    expect(kinds).toContain("order_update");
    expect(kinds).toContain("trade");
  });
});

describe("MockExchangeConnector futures stubs (DEE-194)", () => {
  it("throws ConnectorNotSupportedError for futures methods", async () => {
    const connector = await validatedMock();
    await expect(connector.getFuturesBalances()).rejects.toBeInstanceOf(ConnectorNotSupportedError);
    await expect(connector.getFuturesPositions()).rejects.toBeInstanceOf(
      ConnectorNotSupportedError,
    );
    await expect(
      connector.placeFuturesOrder({
        clientOrderId: "futures-1",
        symbol: "BTC/USDT",
        side: "buy",
        type: "market",
        quantity: "0.01",
      }),
    ).rejects.toBeInstanceOf(ConnectorNotSupportedError);
  });
});
