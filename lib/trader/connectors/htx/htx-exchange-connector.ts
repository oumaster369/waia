import "server-only";

import { ConnectorNotSupportedError } from "@/lib/trader/connectors/errors";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type {
  AccountInfo,
  Balance,
  ConnectorCredentialInput,
  CredentialValidationResult,
  GetOpenOrdersFilter,
  GetTradeHistoryFilter,
  MarketDataEvent,
  Order,
  PlaceOrderInput,
  Position,
  Trade,
  UserDataEvent,
} from "@/lib/trader/connectors/types";
import {
  HtxApiError,
  HtxRestClient,
  type HtxClientConfig,
} from "@/lib/trader/connectors/htx/client";
import {
  HTX_ENDPOINTS,
  HTX_TRADE_HISTORY_MAX_WINDOW_MS,
  htxHostFromUrl,
  resolveHtxRestHost,
} from "@/lib/trader/connectors/htx/config";
import { buildSignedPostQueryString } from "@/lib/trader/connectors/htx/signing";
import {
  HTX_PERMISSION_PROBE_WARNING,
  HTX_TRADE_PERMISSION_WARNING,
  assertHtxSpotSymbolAllowed,
  internalSymbolToHtx,
  mapHtxBalances,
  mapHtxBalancesToPositions,
  mapHtxMarketTick,
  mapHtxMatchResult,
  mapHtxOrder,
  mapHtxPermissionsToAccountScopes,
  permissionIncludesTrade,
  permissionIncludesWithdraw,
  placeOrderInputToHtxType,
} from "@/lib/trader/connectors/htx/mappers";

export type HtxExchangeConnectorConfig = HtxClientConfig;

class HtxPlacementFailUnknownError extends Error {
  readonly rawVenueObservation: Readonly<Record<string, unknown>>;

  constructor(message: string, rawVenueObservation: Readonly<Record<string, unknown>>) {
    super(`[trader] HTX placement is fail-unknown: ${message}`);
    this.name = "HtxPlacementFailUnknownError";
    this.rawVenueObservation = Object.freeze({ ...rawVenueObservation });
  }
}

async function readRawHtxResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * HTX spot connector (DEE-195 read path, DEE-211 write foundation).
 * Credentials are caller-supplied and never persisted.
 * Live execution remains blocked in execution-service until a later P8 gate slice.
 */
export class HtxExchangeConnector implements ExchangeConnector {
  readonly venueId = "htx" as const;
  readonly marketType = "spot" as const;

  private readonly client: HtxRestClient;
  private readonly placementApiKey: string;
  private readonly placementApiSecret: string;
  private readonly placementRestHost: string;
  private readonly placementHost: string;
  private readonly placementFetch: typeof fetch;
  private validated = false;
  private spotAccountId: string | null = null;
  private permissionString: string | null = null;

  constructor(config: HtxExchangeConnectorConfig) {
    this.client = new HtxRestClient(config);
    this.placementApiKey = config.apiKey;
    this.placementApiSecret = config.apiSecret;
    this.placementRestHost = resolveHtxRestHost(config.restHost);
    this.placementHost = htxHostFromUrl(this.placementRestHost);
    this.placementFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async validateCredentials(input: ConnectorCredentialInput): Promise<CredentialValidationResult> {
    const apiKey = input.apiKey.trim();
    const apiSecret = input.apiSecret.trim();
    if (!apiKey || !apiSecret) {
      this.resetSession();
      return {
        valid: false,
        errorCode: "INVALID_CREDENTIALS",
        errorMessage: "HTX requires apiKey and apiSecret",
      };
    }

    try {
      const accounts = await this.client.getAccounts();
      const spotAccount = accounts.find((row) => row.type === "spot" && row.state === "working");
      if (!spotAccount) {
        this.resetSession();
        return {
          valid: false,
          errorCode: "SPOT_ACCOUNT_NOT_FOUND",
          errorMessage: "HTX spot account not found for supplied credentials",
        };
      }

      const warnings: string[] = [];
      let permissionString: string | null = null;

      try {
        const uid = await this.client.getUserUid();
        const apiKeyRow = await this.client.getUserApiKey(uid);
        if (apiKeyRow?.permission) {
          permissionString = apiKeyRow.permission;
          if (permissionIncludesWithdraw(apiKeyRow.permission)) {
            this.resetSession();
            return {
              valid: false,
              errorCode: "FORBIDDEN_PERMISSION",
              errorMessage: "HTX API key has withdraw permission which is forbidden",
            };
          }
          if (permissionIncludesTrade(apiKeyRow.permission)) {
            warnings.push(HTX_TRADE_PERMISSION_WARNING);
          }
        } else {
          warnings.push(HTX_PERMISSION_PROBE_WARNING);
        }
      } catch {
        warnings.push(HTX_PERMISSION_PROBE_WARNING);
      }

      this.validated = true;
      this.spotAccountId = String(spotAccount.id);
      this.permissionString = permissionString;

      return {
        valid: true,
        accountId: this.spotAccountId,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      this.resetSession();
      if (error instanceof HtxApiError) {
        return {
          valid: false,
          errorCode: error.code,
          errorMessage: error.message,
        };
      }
      return {
        valid: false,
        errorCode: "VALIDATION_FAILED",
        errorMessage: error instanceof Error ? error.message : "HTX credential validation failed",
      };
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    this.assertValidated();
    return {
      accountId: this.spotAccountId!,
      venue: "htx",
      marketType: "spot",
      permissions: this.permissionString
        ? mapHtxPermissionsToAccountScopes(this.permissionString)
        : ["read"],
    };
  }

  async getBalances(): Promise<Balance[]> {
    this.assertValidated();
    const data = await this.client.getAccountBalance(this.spotAccountId!);
    return mapHtxBalances(data);
  }

  async getPositions(): Promise<Position[]> {
    const balances = await this.getBalances();
    return mapHtxBalancesToPositions(balances);
  }

  async getOpenOrders(filter?: GetOpenOrdersFilter): Promise<Order[]> {
    this.assertValidated();
    if (!filter?.symbol) {
      throw new Error("[trader] HTX getOpenOrders requires filter.symbol");
    }
    assertHtxSpotSymbolAllowed(filter.symbol);
    const rows = await this.client.getOpenOrders({
      accountId: this.spotAccountId!,
      symbol: internalSymbolToHtx(filter.symbol),
    });
    return rows.map(mapHtxOrder);
  }

  async getOrder(orderId: string): Promise<Order | null> {
    this.assertValidated();
    const row = await this.client.getOrder(orderId);
    if (!row) {
      return null;
    }
    const order = mapHtxOrder(row);
    assertHtxSpotSymbolAllowed(order.symbol);
    return order;
  }

  async placeOrder(input: PlaceOrderInput): Promise<Order> {
    this.assertValidated();
    assertHtxSpotSymbolAllowed(input.symbol);
    if (input.type === "limit" && !input.price) {
      throw new Error("[trader] HTX placeOrder requires price for limit orders");
    }
    if (!input.clientOrderId.trim()) {
      throw new Error("[trader] HTX placeOrder requires clientOrderId");
    }

    const body: Record<string, string | number> = {
      "account-id": this.spotAccountId!,
      symbol: internalSymbolToHtx(input.symbol),
      type: placeOrderInputToHtxType(input),
      amount: input.quantity,
      source: "spot-api",
      "client-order-id": input.clientOrderId,
    };
    if (input.type === "limit") body.price = input.price!;
    const query = buildSignedPostQueryString({
      accessKeyId: this.placementApiKey,
      secret: this.placementApiSecret,
      host: this.placementHost,
      path: HTX_ENDPOINTS.placeOrder,
    });
    const url = `${this.placementRestHost}${HTX_ENDPOINTS.placeOrder}?${query}`;
    let response: Response;
    try {
      // Execution V2 permits exactly one network submission. The generic HTX
      // client retries POSTs, so this effect path deliberately bypasses it.
      response = await this.placementFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new HtxPlacementFailUnknownError("transport result unknown", {
        venueResponseObserved: false,
        transportError: error instanceof Error
          ? Object.freeze({ name: error.name, message: error.message })
          : String(error),
      });
    }
    const responseBody = await readRawHtxResponse(response);
    // HTX's placement acknowledgement contains only an order id. It cannot
    // prove the exact client identity, mechanics, quantity, price, or fills,
    // and no follow-up lookup is ratified. Preserve it and reconcile.
    throw new HtxPlacementFailUnknownError("acknowledgement requires reconciliation", {
      venueResponseObserved: true,
      httpStatus: response.status,
      httpOk: response.ok,
      responseBody,
    });
  }

  async cancelOrder(orderId: string): Promise<Order> {
    this.assertValidated();
    const existing = await this.getOrder(orderId);
    if (!existing) {
      throw new Error(`[trader] HTX cancelOrder: order not found: ${orderId}`);
    }
    const row = await this.client.cancelOrder(orderId);
    return mapHtxOrder(row);
  }

  async getTradeHistory(filter?: GetTradeHistoryFilter): Promise<Trade[]> {
    this.assertValidated();
    if (!filter?.symbol) {
      throw new Error("[trader] HTX getTradeHistory requires filter.symbol");
    }
    assertHtxSpotSymbolAllowed(filter.symbol);

    const endTime = Date.now();
    const startTime = endTime - HTX_TRADE_HISTORY_MAX_WINDOW_MS;
    const rows = await this.client.getMatchResults({
      symbol: internalSymbolToHtx(filter.symbol),
      startTime,
      endTime,
      size: filter.limit ?? 100,
    });

    let trades = rows.map(mapHtxMatchResult);
    if (filter.limit !== undefined && filter.limit >= 0) {
      trades = trades.slice(0, filter.limit);
    }
    return trades;
  }

  async *streamMarketData(symbols: readonly string[]): AsyncIterable<MarketDataEvent> {
    this.assertValidated();
    for (const symbol of symbols) {
      assertHtxSpotSymbolAllowed(symbol);
      const response = await this.client.getMarketDetailMerged(internalSymbolToHtx(symbol));
      if (response.status !== "ok" || !response.tick) {
        throw new HtxApiError("market-data-error", `HTX market snapshot failed for ${symbol}`);
      }
      yield mapHtxMarketTick({ symbol, tick: response.tick, ts: response.ts });
    }
  }

  async *streamUserData(): AsyncIterable<UserDataEvent> {
    this.assertValidated();
    // No private HTX WebSocket in DEE-195 — intentionally yields nothing.
  }

  async getFuturesBalances(): Promise<Balance[]> {
    throw new ConnectorNotSupportedError("futures balances");
  }

  async getFuturesPositions(): Promise<Position[]> {
    throw new ConnectorNotSupportedError("futures positions");
  }

  async placeFuturesOrder(input: PlaceOrderInput): Promise<Order> {
    void input;
    throw new ConnectorNotSupportedError("futures order placement");
  }

  private assertValidated(): void {
    if (!this.validated || !this.spotAccountId) {
      throw new Error("[trader] HTX connector requires validateCredentials before use");
    }
  }

  private resetSession(): void {
    this.validated = false;
    this.spotAccountId = null;
    this.permissionString = null;
  }
}
