import { describe, expect, it } from "vitest";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import type {
  AccountObservation,
  DerivativesAccountFamilyObservation,
  DerivativesAccountObservation,
  ObservationBinding,
  ObservationComponent,
} from "@/lib/trader/account-observation/types";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES } from "@/lib/trader/account-observation/derivatives/types";
import type { HtxDerivativesAccountFamily, HtxDerivativesAccountRow } from "@/lib/trader/account-observation/derivatives/types";

const binding: ObservationBinding = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "account-a",
  credentialRevision: "1",
  configurationRevision: "cfg-1",
};
const epoch = 1_800_000_000_000;
function component<T>(values: readonly T[]): ObservationComponent<T> {
  return { status: "COMPLETE", values, sourceAsOfMs: null, readStartedAtMs: epoch,
    readCompletedAtMs: epoch + 50, error: null };
}
function base(): AccountObservation {
  const balances = component([{ asset: "USDT", free: "1", locked: "0", total: "1" }]);
  return { schemaVersion: "account-observation/v1", observationId: "00000000-0000-4000-8000-000000000003",
    binding, collectionStartedAtMs: epoch, collectionCompletedAtMs: epoch + 100, status: "COMPLETE",
    balances, holdings: balances.values, openOrders: component([]),
    trades: [{ symbol: "BTCUSDT", component: component([]) }] };
}
function row(family: HtxDerivativesAccountFamily): HtxDerivativesAccountRow {
  const accountCode = family === "usdt_cross_shared" ? "USDT" :
    family === "usdt_isolated_perpetual" ? "BTC-USDT" :
      family === "coin_perpetual" ? "THETA-USD" : "BTC";
  const collateralAsset = family.startsWith("usdt_") ? "USDT" : family === "coin_perpetual" ? "THETA" : "BTC";
  return { accountCode, collateralAsset,
    marginMode: family === "usdt_cross_shared" ? "cross" : family === "usdt_isolated_perpetual" ? "isolated" : null,
    marginBalance: "0", marginAvailable: family === "usdt_cross_shared" ? null : "0",
    withdrawAvailable: family === "usdt_cross_shared" ? "0" : null,
    marginPosition: null, marginFrozen: null, marginStatic: null,
    realizedPnl: null, unrealizedPnl: "-0.000000000000000001", riskRate: null, liquidationPrice: null, leverage: null };
}
function family(family: HtxDerivativesAccountFamily): DerivativesAccountFamilyObservation {
  return { family, status: "COMPLETE", accounts: [row(family)], readStartedAtMs: epoch + 10,
    readCompletedAtMs: epoch + 40, responseGeneratedAtMs: epoch + 30, error: null };
}
function v2(overrides: Partial<DerivativesAccountObservation> = {}): AccountObservation {
  const derivatives: DerivativesAccountObservation = {
    schemaVersion: "htx-derivatives-observation/v1",
    families: HTX_DERIVATIVES_ACCOUNT_FAMILIES.map(family),
    ...overrides,
  };
  return { ...base(), schemaVersion: "account-observation/v2", derivatives };
}

describe("saved derivatives observation projection", () => {
  it("continues to accept strict legacy v1 spot observations", () => {
    const parsed = parseAccountObservation(base());
    expect(parsed.schemaVersion).toBe("account-observation/v1");
    expect("derivatives" in parsed).toBe(false);
  });

  it("accepts all four independent persisted v2 families with exact decimal strings", () => {
    const parsed = parseAccountObservation(v2());
    expect(parsed.schemaVersion).toBe("account-observation/v2");
    if (parsed.schemaVersion !== "account-observation/v2") throw new Error("expected v2");
    expect(parsed.derivatives!.families.map(item => item.family)).toEqual(HTX_DERIVATIVES_ACCOUNT_FAMILIES);
    expect(parsed.derivatives!.families.map(item => item.accounts?.[0]?.unrealizedPnl)).toEqual(
      Array(4).fill("-0.000000000000000001"),
    );
    expect(parsed.derivatives!.families.map(item => item.accounts?.[0]?.marginBalance)).toEqual(Array(4).fill("0"));
  });

  it("keeps NOT_CONFIGURED distinct from empty and error; rejects unsafe family identity and timing", () => {
    const unconfigured: DerivativesAccountFamilyObservation[] = HTX_DERIVATIVES_ACCOUNT_FAMILIES.map(family => ({
      family, status: "NOT_CONFIGURED", accounts: null, readStartedAtMs: null,
      readCompletedAtMs: null, responseGeneratedAtMs: null, error: null,
    }));
    const empty = unconfigured.map((item, index) => index === 0 ? { ...item, status: "COMPLETE" as const,
      accounts: [], readStartedAtMs: epoch + 10, readCompletedAtMs: epoch + 20 } : item);
    const errorState = unconfigured.map((item, index) => index === 0 ? { ...item, status: "ERROR" as const,
      accounts: null, readStartedAtMs: epoch + 10, readCompletedAtMs: epoch + 20, error: "READ_FAILED" as const } : item);
    const make = (families: readonly DerivativesAccountFamilyObservation[]) => {
      const value = v2({ families });
      return families.some(item => item.status === "PARTIAL" || item.status === "ERROR")
        ? { ...value, status: "PARTIAL" as const }
        : value;
    };
    expect(parseAccountObservation(make(unconfigured)).schemaVersion).toBe("account-observation/v2");
    expect(parseAccountObservation(make(empty)).schemaVersion).toBe("account-observation/v2");
    expect(parseAccountObservation(make(errorState)).schemaVersion).toBe("account-observation/v2");
    expect(() => parseAccountObservation(make(unconfigured.slice(1)))).toThrow();
    const wrongCurrency = HTX_DERIVATIVES_ACCOUNT_FAMILIES.map(f => family(f));
    wrongCurrency[0] = { ...wrongCurrency[0]!, accounts: [row("usdt_isolated_perpetual"), {
      ...row("usdt_isolated_perpetual"), collateralAsset: "ETH",
    }] };
    expect(() => parseAccountObservation(make(wrongCurrency))).toThrow();
    const duplicateFamily = HTX_DERIVATIVES_ACCOUNT_FAMILIES.map(f => family(f));
    duplicateFamily[3] = { ...duplicateFamily[3]!, family: duplicateFamily[2]!.family };
    expect(() => parseAccountObservation(make(duplicateFamily))).toThrow();
    const futureRead = HTX_DERIVATIVES_ACCOUNT_FAMILIES.map(f => family(f));
    futureRead[0] = { ...futureRead[0]!, readCompletedAtMs: epoch + 101 };
    expect(() => parseAccountObservation(make(futureRead))).toThrow();
  });
});
