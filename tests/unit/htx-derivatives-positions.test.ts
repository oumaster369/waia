import { describe, expect, it } from "vitest";
import { parseHtxDerivativesPositionsSnapshot } from "@/lib/trader/account-observation/derivatives/parser";
import type { HtxDerivativesAccountFamily } from "@/lib/trader/account-observation/derivatives/types";

const cases: readonly Readonly<{ family: HtxDerivativesAccountFamily; data: string }>[] = [
  { family: "usdt_isolated_perpetual", data: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT","direction":"buy","volume":"2.5","available":"2","frozen":"0.5","cost_open":"60000.00000000000001","cost_hold":"61000","profit_unreal":"-0.000000000000000001","profit_rate":"-0.0001","position_margin":"12.5","lever_rate":10,"last_price":"59000","liquidation_price":null}]}` },
  { family: "usdt_cross_shared", data: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","contract_code":"BTC-USDT-211217","margin_account":"USDT","margin_mode":"cross","margin_asset":"USDT","direction":"sell","volume":"1","available":"1","frozen":"0","cost_open":"50000","cost_hold":"51000","profit_unreal":"-12.5","position_margin":"100","lever_rate":5,"business_type":"futures","contract_type":"next_week"}]}` },
  { family: "coin_perpetual", data: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","volume":"0","available":"0","frozen":"0","cost_open":"0","cost_hold":"0","profit_unreal":"0","profit_rate":"0","position_margin":"0","lever_rate":20,"last_price":"0"}]}` },
  { family: "coin_delivery_futures", data: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","contract_code":"BTC201225","contract_type":"quarter","direction":"sell","volume":"1","available":"0.5","frozen":"0.5","cost_open":"14000","cost_hold":"13900","profit_unreal":"-1.2","position_margin":"0.1","lever_rate":10,"last_price":"13800"}]}` },
];

describe("HTX futures position parser", () => {
  it.each(cases)("preserves the documented $family position identity and decimals", ({ family, data }) => {
    const snapshot = parseHtxDerivativesPositionsSnapshot(family, data);
    expect(snapshot).toMatchObject({ schemaVersion: "htx-derivatives-positions/v1", family,
      responseGeneratedAtMs: 1780261200000 });
    expect(snapshot.positions).toHaveLength(1);
    const row = snapshot.positions[0]!;
    expect(row.direction).toMatch(/^(buy|sell)$/);
    if (family === "usdt_isolated_perpetual") {
      expect(row).toMatchObject({ contractCode: "BTC-USDT", marginAsset: "USDT", costOpen: "60000.00000000000001",
        unrealizedPnl: "-0.000000000000000001", liquidationPrice: null });
    }
    if (family === "usdt_cross_shared") expect(row).toMatchObject({ contractCode: "BTC-USDT-211217", contractType: "next_week", marginAsset: "USDT" });
    if (family === "coin_perpetual") expect(row).toMatchObject({ volume: "0", marginAsset: "BTC", lastPrice: "0" });
    if (family === "coin_delivery_futures") expect(row).toMatchObject({ contractCode: "BTC201225", contractType: "quarter", marginAsset: "BTC" });
  });

  it("distinguishes an empty open-position set from a zero-size position row", () => {
    expect(parseHtxDerivativesPositionsSnapshot("coin_perpetual", `{"status":"ok","data":[]}`).positions).toEqual([]);
    expect(parseHtxDerivativesPositionsSnapshot("coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","volume":"0"}]}`).positions[0]?.volume).toBe("0");
  });

  it.each([
    ["usdt_isolated_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"ETH-USDT","direction":"buy"}]}`],
    ["usdt_isolated_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"ETH-USDT","margin_asset":"USDT","direction":"buy"}]}`],
    ["usdt_isolated_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_mode":"cross","margin_asset":"USDT","direction":"buy"}]}`],
    ["usdt_isolated_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT-211217","margin_account":"BTC-USDT-211217","margin_mode":"isolated","margin_asset":"USDT","direction":"buy"}]}`],
    ["usdt_cross_shared", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT","direction":"sell"}]}`],
    ["usdt_cross_shared", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"USDT","margin_mode":"isolated","margin_asset":"USDT","direction":"sell"}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"ETH-USD","direction":"buy"}]}`],
    ["coin_delivery_futures", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"ETH201225","direction":"sell"}]}`],
    ["coin_delivery_futures", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC201225X","direction":"sell"}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"sideways","volume":"1"}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","volume":"NaN"}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","volume":"-1"}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","lever_rate":-5}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","last_price":"-1"}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy"},{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy"}]}`],
  ] as const)("rejects malformed or contradictory position identity %s", (family, data) => {
    expect(() => parseHtxDerivativesPositionsSnapshot(family, data)).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
  });

  it("rejects over-cap position arrays rather than truncating them", () => {
    const rows = Array.from({ length: 101 }, (_, index) =>
      `{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","volume":"${index + 1}"}`).join(",");
    expect(() => parseHtxDerivativesPositionsSnapshot("coin_perpetual", `{"status":"ok","data":[${rows}]}`))
      .toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
  });

  it("preserves negative PnL and profit rate as signed economic values", () => {
    const parsed = parseHtxDerivativesPositionsSnapshot("coin_perpetual",
      `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","profit_unreal":"-1.25","profit_rate":"-0.02"}]}`);
    expect(parsed.positions[0]).toMatchObject({ unrealizedPnl: "-1.25", profitRate: "-0.02" });
  });
});
