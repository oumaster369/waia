import { describe, expect, it } from "vitest";

import {
  TreasuryValidationError,
  accountingMicrosFromUsdtNominal,
  computeCanonicalCashEffect,
  requireBigint,
  USDT_NOMINAL_USD_POLICY_V1,
  type TreasuryTxDirection,
  type TreasuryTxKind,
} from "@/lib/waia-core/treasury";

const A = 1_000_000n;

describe("treasury cash-effect engine (DEE-606 WP-2)", () => {
  it("OPENING_BALANCE -> +A", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "OPENING_BALANCE",
        direction: "INFLOW",
        accountingAmountMicros: A,
      }).cashEffectMicros,
    ).toBe(A);
  });

  it("CONTRIBUTION -> +A", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "CONTRIBUTION",
        direction: "INFLOW",
        accountingAmountMicros: A,
      }).cashEffectMicros,
    ).toBe(A);
  });

  it("EXTERNAL_INFLOW -> +A", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "EXTERNAL_INFLOW",
        direction: "INFLOW",
        accountingAmountMicros: A,
      }).cashEffectMicros,
    ).toBe(A);
  });

  it("EXPENSE -> -A", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "EXPENSE",
        direction: "OUTFLOW",
        accountingAmountMicros: A,
      }).cashEffectMicros,
    ).toBe(-A);
  });

  it("EXTERNAL_OUTFLOW -> -A", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "EXTERNAL_OUTFLOW",
        direction: "OUTFLOW",
        accountingAmountMicros: A,
      }).cashEffectMicros,
    ).toBe(-A);
  });

  it("INTERNAL_TRANSFER -> 0", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "INTERNAL_TRANSFER",
        direction: "INTERNAL",
        accountingAmountMicros: A,
      }).cashEffectMicros,
    ).toBe(0n);
  });

  it("REFUND sign follows direction", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "REFUND",
        direction: "INFLOW",
        accountingAmountMicros: A,
      }).cashEffectMicros,
    ).toBe(A);
    expect(
      computeCanonicalCashEffect({
        kind: "REFUND",
        direction: "OUTFLOW",
        accountingAmountMicros: A,
      }).cashEffectMicros,
    ).toBe(-A);
  });

  it("CORRECTION positive sign/direction is valid", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "CORRECTION",
        direction: "INFLOW",
        accountingAmountMicros: A,
        signedCashEffectMicros: A,
      }).cashEffectMicros,
    ).toBe(A);
  });

  it("CORRECTION negative sign/direction is valid", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "CORRECTION",
        direction: "OUTFLOW",
        accountingAmountMicros: A,
        signedCashEffectMicros: -A,
      }).cashEffectMicros,
    ).toBe(-A);
  });

  it("rejects zero CORRECTION", () => {
    expect(() =>
      computeCanonicalCashEffect({
        kind: "CORRECTION",
        direction: "INFLOW",
        accountingAmountMicros: 0n,
        signedCashEffectMicros: 0n,
      }),
    ).toThrow(TreasuryValidationError);
  });

  it("rejects kind/direction mismatches", () => {
    const cases: Array<{ kind: TreasuryTxKind; direction: TreasuryTxDirection }> = [
      { kind: "OPENING_BALANCE", direction: "OUTFLOW" },
      { kind: "CONTRIBUTION", direction: "INTERNAL" },
      { kind: "EXTERNAL_INFLOW", direction: "OUTFLOW" },
      { kind: "EXPENSE", direction: "INFLOW" },
      { kind: "EXTERNAL_OUTFLOW", direction: "INTERNAL" },
      { kind: "INTERNAL_TRANSFER", direction: "INFLOW" },
      { kind: "REFUND", direction: "INTERNAL" },
      { kind: "CORRECTION", direction: "INTERNAL" },
      { kind: "BALANCE_ADJUSTMENT", direction: "INTERNAL" },
    ];
    for (const row of cases) {
      expect(() =>
        computeCanonicalCashEffect({
          ...row,
          accountingAmountMicros: A,
        }),
      ).toThrow(TreasuryValidationError);
    }
  });

  it("rejects non-positive A where A > 0 is required", () => {
    for (const kind of ["OPENING_BALANCE", "CONTRIBUTION", "EXPENSE", "REFUND"] as const) {
      const direction = kind === "EXPENSE" ? "OUTFLOW" : "INFLOW";
      expect(() =>
        computeCanonicalCashEffect({
          kind,
          direction,
          accountingAmountMicros: 0n,
        }),
      ).toThrow(TreasuryValidationError);
    }
  });

  it("maps USDT_NOMINAL_USD_POLICY_V1 exactly as native atomic", () => {
    expect(
      accountingMicrosFromUsdtNominal({
        nativeAmountAtomic: 42n,
        nativeDecimals: 6,
        nativeAsset: "USDT",
      }),
    ).toBe(42n);
    expect(USDT_NOMINAL_USD_POLICY_V1).toBe("USDT_NOMINAL_USD_POLICY_V1");
  });

  it("refuses JS Number as financial authority", () => {
    expect(() => requireBigint(1_000_000, "amount")).toThrow(TreasuryValidationError);
  });
});
