import { describe, expect, it } from "vitest";
import { htxV5BillBreakdown } from "@/lib/trader/account-observation/derivatives/htx-v5-bill-breakdown";

const bill = { id: "1", type: "5", currency: "USDT", amount: "-1", contract_code: "BTC-USDT", margin_mode: "cross", created_time: "1000" };
const page = (rows: unknown[]) => JSON.stringify({ code: 200, data: rows, ts: 2000 });
const breakdown = (payloads: string[]) => htxV5BillBreakdown({ payloads, windowStartMs: 1000, windowEndMs: 2000 });

describe("bounded observed bills breakdown, not daily PnL", () => {
  it("sums exact signed amounts separately per currency and exact documented or unknown type", () => {
    const result = breakdown([page([
      { ...bill, amount: "9007199254740993.000000000000000001" },
      { ...bill, id: "2", amount: "-9007199254740993" },
      { ...bill, id: "3", type: "6", amount: "-2" },
      { ...bill, id: "4", currency: "BTC", amount: "-0.000001" },
      { ...bill, id: "5", type: "999", amount: "3e-18", contract_code: "" },
      { ...bill, id: "6", type: "998", amount: "4e-18" },
    ])]);
    expect(result.groups).toEqual([
      { currency: "BTC", type: "5", category: "OPEN_FEE_TAKER", observedAmountSum: "-0.000001", recordCount: 1 },
      { currency: "USDT", type: "5", category: "OPEN_FEE_TAKER", observedAmountSum: "0.000000000000000001", recordCount: 2 },
      { currency: "USDT", type: "6", category: "OPEN_FEE_MAKER", observedAmountSum: "-2", recordCount: 1 },
      { currency: "USDT", type: "998", category: "UNKNOWN", observedAmountSum: "0.000000000000000004", recordCount: 1 },
      { currency: "USDT", type: "999", category: "UNKNOWN", observedAmountSum: "0.000000000000000003", recordCount: 1 },
    ]);
    expect(result).toMatchObject({ status: "OBSERVED_RECORDS_ONLY", completeness: "unknown", netPnl: null, dailyPnl: null, accountBinding: "NOT_ESTABLISHED_BY_BILLS_RESPONSE", amountSemantics: "RAW_SIGNED_AMOUNTS_NO_SIGN_CONVERSION", observedRecordCount: 6 });
    expect(result).not.toHaveProperty("total");
  });

  it.each([{ payloads: [] }, { payloads: [page([])] }])("has no fabricated zero categories/PnL for empty input", ({ payloads }) => {
    expect(breakdown(payloads)).toMatchObject({ status: "NO_OBSERVED_RECORDS", observedRecordCount: 0, groups: [], netPnl: null, dailyPnl: null, completeness: "unknown" });
  });

  it("allows observed exact zero from real cancelling records without zero-filling other categories", () => {
    const result = breakdown([page([{ ...bill, amount: "1e-128" }, { ...bill, id: "2", amount: "-1e-128" }])]);
    expect(result.groups).toEqual([{ currency: "USDT", type: "5", category: "OPEN_FEE_TAKER", observedAmountSum: "0", recordCount: 2 }]);
    expect(result.status).toBe("OBSERVED_RECORDS_ONLY");
  });

  it.each([
    ["1e128", "1" + "0".repeat(128)], ["-0.1200", "-0.12"], ["-0e5", "0"],
    ["-1e-128", "-0." + "0".repeat(127) + "1"],
  ])("normalizes only the exact sum of %s", (amount, expected) => {
    expect(breakdown([page([{ ...bill, amount }])]).groups[0]!.observedAmountSum).toBe(expected);
  });

  it("rejects duplicate IDs across pages rather than silently deduplicating or summing twice", () => {
    expect(() => breakdown([page([bill]), page([{ ...bill, amount: "2" }])])).toThrow("DUPLICATE_ID");
  });

  it("uses an explicit half-open window and refuses any received out-of-window row", () => {
    expect(breakdown([page([bill, { ...bill, id: "2", created_time: "1999" }])]).observedRecordCount).toBe(2);
    for (const created_time of ["999", "2000", "2001"]) {
      expect(() => breakdown([page([{ ...bill, created_time }])])).toThrow("OUTSIDE_WINDOW");
    }
  });

  it.each([
    [NaN, 2000], [1000, Infinity], [-1, 2000], [1000.1, 2000], [1000, 1000],
    [2000, 1000], [1000, 8.64e15 + 1], [1000, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects invalid window %s..%s", (windowStartMs, windowEndMs) => {
    expect(() => htxV5BillBreakdown({ payloads: [], windowStartMs, windowEndMs })).toThrow("INVALID_WINDOW");
  });

  it("bounds page count and decimal exponents without dropping malformed records", () => {
    expect(() => breakdown(Array.from({ length: 11 }, () => page([])))).toThrow("PAGE_BOUND");
    for (const amount of ["1e129", "1e-129", "1e10000"]) {
      expect(() => breakdown([page([{ ...bill, amount }])])).toThrow("UNSUPPORTED_AMOUNT");
    }
    for (const patch of [{ amount: "NaN" }, { type: "fee" }, { created_time: null }]) {
      expect(() => breakdown([page([{ ...bill, ...patch }])])).toThrow("HTX_V5_INVALID_RESPONSE");
    }
  });

  it("retains unknown completeness after ten full bounded pages and returns immutable groups", () => {
    const result = breakdown(Array.from({ length: 10 }, (_, p) => page(Array.from({ length: 100 }, (_, i) => ({ ...bill, id: String(p * 100 + i) })))));
    expect(result.observedRecordCount).toBe(1000);
    expect(result.completeness).toBe("unknown");
    expect(Object.isFrozen(result.groups)).toBe(true);
    expect(Object.isFrozen(result.groups[0])).toBe(true);
  });
});
