import { describe, expect, it } from "vitest";
import { HTX_V5_READ_ONLY_ROUTES, parseHtxV5Bills } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";

const bill = { id: "7071168", type: "15", currency: "USDT", amount: "-1", contract_code: "", margin_mode: "cross", created_time: "1767694969541" };
const response = (rows: unknown[] = [bill]) => JSON.stringify({ code: 200, message: "Success", data: rows, ts: 1767696593837 });

describe("unwired HTX V5 bills normalization", () => {
  it("accepts the official empty-contract transfer example without inventing a contract or amount sign", () => {
    expect(parseHtxV5Bills(response())).toEqual({
      rows: [{ id: "7071168", type: "15", category: "CONTRACT_TO_SPOT_TRANSFER", currency: "USDT", amount: "-1", contractCode: "", marginMode: "cross", createdTimeMs: 1767694969541 }],
      nextFrom: "7071168", completeness: "unknown", responseGeneratedAtMs: 1767696593837,
    });
    expect(Object.values(HTX_V5_READ_ONLY_ROUTES)).not.toContain("/v5/account/bills");
  });

  it("preserves numeric JSON IDs and amount lexemes beyond Number precision", () => {
    const raw = response().replace('"7071168"', "9223372036854775807").replace('"-1"', "-0.000000000000000000000000001");
    const row = parseHtxV5Bills(raw).rows[0]!;
    expect(row.id).toBe("9223372036854775807");
    expect(row.amount).toBe("-0.000000000000000000000000001");
  });

  it.each(["999", "00015", "999999999999999999999999999999999999"])("retains unknown numeric type %s", type => {
    expect(parseHtxV5Bills(response([{ ...bill, type }])).rows[0]).toMatchObject({ type, category: "UNKNOWN" });
  });

  it.each([
    ["3", "CLOSE_LONG"], ["5", "OPEN_FEE_TAKER"], ["30", "FUNDING_INCOME"],
    ["31", "FUNDING_EXPENDITURE"], ["141", "LIQUIDATION_FEE"],
  ])("labels documented type %s without changing raw sign", (type, category) => {
    for (const amount of ["-1.2500", "1.2500", "0e4"]) {
      expect(parseHtxV5Bills(response([{ ...bill, type, amount }])).rows[0]).toMatchObject({ type, category, amount });
    }
  });

  it.each([0, 1, 100])("never infers exhaustion or completeness from %i received rows", count => {
    const parsed = parseHtxV5Bills(response(Array.from({ length: count }, (_, i) => ({ ...bill, id: String(i) }))));
    expect(parsed.completeness).toBe("unknown");
    expect(parsed.nextFrom).toBe(count ? String(count - 1) : null);
    expect(Object.isFrozen(parsed.rows)).toBe(true);
  });

  it.each([
    { id: "9223372036854775808" }, { id: "1.5" }, { type: "fee" }, { type: "-1" },
    { type: "" }, { type: true }, { currency: "" }, { currency: "usdt" },
    { contract_code: null }, { contract_code: "BTC_USDT" }, { margin_mode: "unknown" },
    { amount: "NaN" }, { amount: "Infinity" }, { amount: " 1" }, { amount: null },
    { created_time: null }, { created_time: "" }, { created_time: "1.1" },
    { created_time: "9007199254740993" }, { created_time: "-1" },
  ])("refuses malformed required bill fields: %j", patch => {
    expect(() => parseHtxV5Bills(response([{ ...bill, ...patch }]))).toThrow("HTX_V5_INVALID_RESPONSE");
  });

  it("refuses missing required fields, duplicate IDs/JSON keys, non-success envelopes and oversized pages", () => {
    for (const key of Object.keys(bill)) {
      const row: Record<string, unknown> = { ...bill };
      delete row[key];
      expect(() => parseHtxV5Bills(response([row]))).toThrow("HTX_V5_INVALID_RESPONSE");
    }
    for (const raw of [
      response([bill, bill]), response(Array.from({ length: 101 }, (_, i) => ({ ...bill, id: String(i) }))),
      response().replace('"amount":"-1"', '"amount":"-1","amount":"2"'),
      response().replace('"code":200', '"code":200,"code":500'),
      response().replace('"code":200', '"code":500'), response() + "trailing",
    ]) expect(() => parseHtxV5Bills(raw)).toThrow("HTX_V5_INVALID_RESPONSE");
  });
});
