// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  HTX_V5_READ_ONLY_ROUTES,
  buildHtxV5AlgoOrdersRequest,
  buildHtxV5AssetModeRequest,
  buildHtxV5BalanceRequest,
  buildHtxV5FillsRequest,
  buildHtxV5OpenOrdersRequest,
  buildHtxV5PositionsRequest,
  parseHtxV5AlgoOrders,
  parseHtxV5AssetMode,
  parseHtxV5Balance,
  parseHtxV5Fills,
  parseHtxV5OpenOrders,
  parseHtxV5Positions,
} from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";

const ts = 1_780_261_200_000;

function envelope(data: string, generatedAt = ts): string {
  return `{"code":200,"message":"Success","data":${data},"ts":${generatedAt}}`;
}

const balancePayload = envelope(`{
  "state":"normal","equity":"900.25","initial_margin":"100.2","maintenance_margin":"20.1",
  "maintenance_margin_rate":"0.02","profit_unreal":"-0.001","available_margin":"800.05","voucher_value":"0",
  "created_time":1755246156916,"updated_time":1766390998717,
  "details":[{"currency":"USDT","equity":113.540541233146082524,"isolated_equity":"0.5",
    "available":"113.540541233146082524","isolated_available":"30.00","withdraw_available":"113.54",
    "profit_unreal":"0","isolated_profit_unreal":"0","initial_margin":"0","maintenance_margin":"0",
    "maintenance_margin_rate":"0","initial_margin_rate":"0","voucher":"0","voucher_value":"0",
    "created_time":1755261041303,"updated_time":1767771949096}]
}`);

const positionRow = `{"contract_code":"BTC-USDT","position_side":"long","direction":"buy","margin_mode":"cross",
  "open_avg_price":"60000.10","volume":"0.100000000000000001","available":"0.09","lever_rate":10,
  "adl_risk_percent":1,"liquidation_price":"45000.5","initial_margin":"10","maintenance_margin":"2",
  "margin":"10","profit_unreal":"0.000000000000000001","profit_rate":"0.0001","margin_rate":"0.02",
  "margin_currency":"USDT","last_price":"60000","mark_price":60000.01,"contract_type":"swap",
  "created_time":1755261041303,"updated_time":1767771949096}`;

const orderRow = `{"id":"9007199254740993","contract_code":"BTC-USDT","side":"sell","position_side":"long",
  "type":"limit","order_id":"123456789012345678","client_order_id":"client_1","margin_mode":"cross",
  "price":"65000","volume":"0.1","lever_rate":10,"state":"new","order_source":"api","reduce_only":true,
  "time_in_force":"gtc","tp_trigger_price":"70000","tp_order_price":"","tp_type":"market",
  "tp_trigger_price_type":"mark","sl_trigger_price":"55000","sl_order_price":"","sl_type":"market",
  "sl_trigger_price_type":"last","trade_avg_price":"0","trade_volume":"0","trade_turnover":"0",
  "fee_currency":"USDT","fee":"0","price_protect":false,"profit":"0","contract_type":"swap",
  "created_time":1755261041303,"updated_time":1767771949096}`;

const algoRow = (
  type: string,
) => `{"id":"102","algo_id":"algo_1","algo_client_order_id":"client_algo",
  "contract_code":"BTC-USDT","volume":"0.1","type":"${type}","state":"active","position_side":"long",
  "margin_mode":"cross","side":"sell","tp_trigger_price":"70000","tp_order_price":"",
  "tp_type":"market","tp_trigger_price_type":"mark","sl_trigger_price":"55000","sl_order_price":"",
  "sl_type":"market","sl_trigger_price_type":"last","reduce_only":true,
  "created_time":1755261041303,"updated_time":1767771949096}`;

const fillRow = `{"id":"1124147771","contract_code":"BTC-USDT","order_id":"1343541341268738048",
  "trade_id":"100000032538647","side":"sell","position_side":"short","order_type":"1","margin_mode":"cross",
  "type":"limit","role":"TAKER","trade_price":"31400","trade_volume":"1","trade_turnover":"31.4",
  "created_time":1740366817564,"updated_time":1740366817564,"order_source":"api","fee_currency":"USDT",
  "trade_fee":"0.01884","deduction_price":"","profit":"0","contract_type":"swap"}`;

describe("HTX V5 read-only request contract", () => {
  it("exposes only the seven fixed GET paths and no mode setter or trading route", () => {
    expect(Object.values(HTX_V5_READ_ONLY_ROUTES)).toEqual([
      "/v5/account/asset_mode",
      "/v5/account/balance",
      "/v5/trade/position/opens",
      "/v5/trade/order/opens",
      "/v5/algo/order/opens",
      "/v5/trade/order/details",
      "/v5/account/bills",
    ]);
    expect(buildHtxV5AssetModeRequest()).toEqual({
      method: "GET",
      path: "/v5/account/asset_mode",
      query: {},
    });
    expect(buildHtxV5BalanceRequest()).toEqual({
      method: "GET",
      path: "/v5/account/balance",
      query: {},
    });
    expect(buildHtxV5PositionsRequest({ contractCode: "BTC-USDT" }).query).toEqual({
      contract_code: "BTC-USDT",
    });
  });

  it("bounds ordinary/algo pages and accepts only documented algo type filters", () => {
    expect(buildHtxV5OpenOrdersRequest({ from: "9007199254740993", limit: 50 }).query).toEqual({
      limit: "50",
      direct: "next",
      from: "9007199254740993",
    });
    expect(buildHtxV5AlgoOrdersRequest({ type: "sl", contractCode: "BTC-USDT" }).query).toEqual({
      type: "sl",
      limit: "100",
      direct: "next",
      contract_code: "BTC-USDT",
    });
    expect(() => buildHtxV5OpenOrdersRequest({ limit: 101 })).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
    expect(() => buildHtxV5OpenOrdersRequest({ from: "9007199254740993x" })).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
    expect(() => buildHtxV5OpenOrdersRequest({ from: "9223372036854775808" })).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
    expect(() => buildHtxV5OpenOrdersRequest({ orderId: "" })).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
    expect(() => buildHtxV5OpenOrdersRequest({ contractCode: 42 as unknown as string })).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
    expect(() => buildHtxV5PositionsRequest({ contractCode: "/v5/trade/order" })).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
    expect(() => buildHtxV5AlgoOrdersRequest({ type: "cancel" as never })).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
  });

  it("requires a contract and caps fills requests to the documented 48-hour span", () => {
    const start = ts - 60_000;
    const req = buildHtxV5FillsRequest({
      contractCode: "BTC-USDT",
      startTimeMs: start,
      endTimeMs: ts,
    });
    expect(req).toEqual({
      method: "GET",
      path: "/v5/trade/order/details",
      query: {
        contract_code: "BTC-USDT",
        start_time: String(start),
        end_time: String(ts),
        limit: "100",
        direct: "next",
      },
    });
    expect(() =>
      buildHtxV5FillsRequest({
        contractCode: "BTC-USDT",
        startTimeMs: ts - 172_800_001,
        endTimeMs: ts,
      }),
    ).toThrow("HTX_V5_INVALID_READ_REQUEST");
  });

  it("rejects hostile builder inputs without invoking proxy or accessor hooks", () => {
    let proxyHookInvoked = false;
    const hostileProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          proxyHookInvoked = true;
          throw new Error("proxy hook ran");
        },
        ownKeys() {
          proxyHookInvoked = true;
          throw new Error("proxy hook ran");
        },
      },
    );
    expect(() => buildHtxV5OpenOrdersRequest(hostileProxy as never)).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
    expect(proxyHookInvoked).toBe(false);

    let getterInvoked = false;
    const accessorInput = Object.defineProperty({}, "contractCode", {
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error("getter ran");
      },
    });
    expect(() => buildHtxV5PositionsRequest(accessorInput as never)).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
    expect(getterInvoked).toBe(false);

    const customPrototype = Object.assign(Object.create({ inherited: true }), { limit: 10 });
    expect(() => buildHtxV5OpenOrdersRequest(customPrototype as never)).toThrow(
      "HTX_V5_INVALID_READ_REQUEST",
    );
  });

  it("rejects non-string contract identifiers without coercion", () => {
    let toStringInvoked = false;
    const hostileIdentifier = {
      toString() {
        toStringInvoked = true;
        throw new Error("coercion ran");
      },
    };
    expect(() =>
      buildHtxV5PositionsRequest({ contractCode: hostileIdentifier as unknown as string }),
    ).toThrow("HTX_V5_INVALID_READ_REQUEST");
    expect(toStringInvoked).toBe(false);
  });
});

describe("HTX V5 response projections", () => {
  it("retains the exact asset mode enum without mapping it to API capability", () => {
    expect(parseHtxV5AssetMode(envelope('{"asset_mode":0}'))).toEqual({
      assetMode: "0",
      responseGeneratedAtMs: ts,
    });
    expect(parseHtxV5AssetMode(envelope('{"asset_mode":1}'))).toEqual({
      assetMode: "1",
      responseGeneratedAtMs: ts,
    });
    expect(parseHtxV5AssetMode(envelope('{"asset_mode":2}'))).toEqual({
      assetMode: "2",
      responseGeneratedAtMs: ts,
    });
    expect(() => parseHtxV5AssetMode(envelope('{"asset_mode":3}'))).toThrow(
      "HTX_V5_INVALID_RESPONSE",
    );
  });

  it("keeps USD account aggregates distinct from exact per-currency amounts", () => {
    const parsed = parseHtxV5Balance(balancePayload);
    expect(parsed.account.equityUsd).toBe("900.25");
    expect(parsed.details[0]?.currency).toBe("USDT");
    expect(parsed.details[0]?.equity).toBe("113.540541233146082524");
    expect(parsed.details[0]?.isolatedAvailable).toBe("30.00");
    expect(parsed.responseGeneratedAtMs).toBe(ts);
  });

  it("rejects duplicate currency rows instead of double-counting a collateral asset", () => {
    const duplicate = balancePayload.replace(/"details":\[(\{.*?\})\]/s, '"details":[$1,$1]');
    expect(() => parseHtxV5Balance(duplicate)).toThrow("HTX_V5_INVALID_RESPONSE");
  });

  it("projects contract quantities and never invents a position pagination cursor", () => {
    const parsed = parseHtxV5Positions(envelope(`[${positionRow}]`));
    expect(parsed.rows[0]?.volume).toBe("0.100000000000000001");
    expect(parsed.rows[0]?.positionSide).toBe("long");
    expect(parsed.nextFrom).toBeNull();
    expect(parsed.completeness).toBe("unknown");
    const modeDistinct = parseHtxV5Positions(
      envelope(`[${positionRow},${positionRow.replace('"cross"', '"isolated"')}]`),
    );
    expect(modeDistinct.rows).toHaveLength(2);
    const nullable = parseHtxV5Positions(
      envelope(
        `[${positionRow.replace('"45000.5"', '""').replace('"10","maintenance_margin"', '"","maintenance_margin"')}]`,
      ),
    );
    expect(nullable.rows[0]?.liquidationPrice).toBeNull();
    expect(nullable.rows[0]?.initialMargin).toBeNull();
  });

  it("preserves large source cursors on orders and keeps page completeness unknown", () => {
    const parsed = parseHtxV5OpenOrders(envelope(`[${orderRow}]`));
    expect(parsed.rows[0]?.id).toBe("9007199254740993");
    expect(parsed.rows[0]?.reduceOnly).toBe(true);
    expect(parsed.nextFrom).toBe("9007199254740993");
    expect(parsed.completeness).toBe("unknown");
    const noReduceOnly = parseHtxV5OpenOrders(
      envelope(`[${orderRow.replace(',"reduce_only":true', "")}]`),
    );
    expect(noReduceOnly.rows[0]?.reduceOnly).toBeNull();
  });

  it("validates the required algo query's returned type and exposes only active orders", () => {
    expect(parseHtxV5AlgoOrders(envelope(`[${algoRow("sl")}]`), "sl").rows[0]?.slTriggerPrice).toBe(
      "55000",
    );
    expect(() => parseHtxV5AlgoOrders(envelope(`[${algoRow("tp")}]`), "sl")).toThrow(
      "HTX_V5_INVALID_RESPONSE",
    );
    expect(() =>
      parseHtxV5AlgoOrders(envelope(`[${algoRow("sl").replace('"active"', '"canceled"')}]`), "sl"),
    ).toThrow("HTX_V5_INVALID_RESPONSE");
  });

  it("binds each fill page to one requested contract and preserves venue fill IDs", () => {
    const parsed = parseHtxV5Fills(envelope(`[${fillRow}]`), "BTC-USDT");
    expect(parsed.rows[0]?.tradeId).toBe("100000032538647");
    expect(parsed.rows[0]?.tradeVolume).toBe("1");
    expect(parsed.nextFrom).toBe("1124147771");
    expect(() =>
      parseHtxV5Fills(envelope(`[${fillRow.replace("BTC-USDT", "ETH-USDT")}]`), "BTC-USDT"),
    ).toThrow("HTX_V5_INVALID_RESPONSE");
  });

  it("rejects non-string expected fill contracts without coercion", () => {
    let toStringInvoked = false;
    const hostileIdentifier = {
      toString() {
        toStringInvoked = true;
        throw new Error("coercion ran");
      },
    };
    expect(() => parseHtxV5Fills(envelope(`[${fillRow}]`), hostileIdentifier as never)).toThrow(
      "HTX_V5_INVALID_RESPONSE",
    );
    expect(toStringInvoked).toBe(false);
    expect(() => parseHtxV5Fills(envelope(`[${fillRow}]`), 7 as never)).toThrow(
      "HTX_V5_INVALID_RESPONSE",
    );
  });

  it("rejects duplicate JSON keys and duplicate page cursors without exposing payload values", () => {
    expect(() =>
      parseHtxV5AssetMode('{"code":200,"data":{"asset_mode":1,"asset_mode":2}}'),
    ).toThrow("HTX_V5_INVALID_RESPONSE");
    expect(() => parseHtxV5OpenOrders(envelope(`[${orderRow},${orderRow}]`))).toThrow(
      "HTX_V5_INVALID_RESPONSE",
    );
  });
});
