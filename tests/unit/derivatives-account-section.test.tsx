import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DerivativesAccountSection,
} from "@/components/trader/account-observation/derivatives-account-section";
import type { HtxDerivativesAccountFamily, HtxDerivativesAccountRow } from "@/lib/trader/account-observation/derivatives/types";
import type { DerivativesAccountFamilyObservation, DerivativesAccountObservation } from "@/lib/trader/account-observation/types";

afterEach(cleanup);

const account = (patch: Partial<HtxDerivativesAccountRow> = {}): HtxDerivativesAccountRow => ({
  accountCode: "BTC-USDT",
  collateralAsset: "USDT",
  marginMode: "isolated",
  marginBalance: "0",
  marginAvailable: null,
  withdrawAvailable: null,
  marginPosition: null,
  marginFrozen: "0.125000000000000001",
  marginStatic: null,
  realizedPnl: null,
  unrealizedPnl: "-0.000000000000000001",
  riskRate: null,
  liquidationPrice: null,
  leverage: null,
  ...patch,
});

const family = (family: HtxDerivativesAccountFamily, patch: Partial<DerivativesAccountFamilyObservation> = {}): DerivativesAccountFamilyObservation => ({
  family,
  status: "COMPLETE",
  readStartedAtMs: 1_800_000_000_000,
  readCompletedAtMs: 1_800_000_000_010,
  responseGeneratedAtMs: 1_800_000_000_005,
  accounts: [account()],
  error: null,
  ...patch,
});
const projection = (families: readonly DerivativesAccountFamilyObservation[]): DerivativesAccountObservation => ({
  schemaVersion: "htx-derivatives-observation/v1", families,
});
const nowMs = 1_800_000_000_100;

describe("futures account presentation", () => {
  it("keeps observed zero, missing value, exact precision and negative PnL distinct", () => {
    render(<DerivativesAccountSection nowMs={nowMs} projection={projection([family("usdt_isolated_perpetual")])} />);
    const section = screen.getByRole("region", { name: "USDT perpetual · isolated accounts" });
    expect(within(section).getByText("0", { selector: "dd" })).toBeTruthy();
    expect(within(section).getByText("Unavailable", { selector: "dd" })).toBeTruthy();
    expect(within(section).getByText("0.125000000000000001", { selector: "dd" })).toBeTruthy();
    expect(within(section).getByText("-0.000000000000000001", { selector: "dd" })).toBeTruthy();
    expect(within(section).getByText("Read completed")).toBeTruthy();
    expect(within(section).getByText("Response generated")).toBeTruthy();
  });

  it("displays shared cross-pool totals once without adding nested perpetual or delivery detail", () => {
    const shared = family("usdt_cross_shared", {
      family: "usdt_cross_shared",
      accounts: [account({ accountCode: "USDT", collateralAsset: "USDT", marginMode: "cross",
        marginBalance: "10000.000000000000000000", marginAvailable: null, withdrawAvailable: "9000.000000000000000001" })],
    });
    render(<DerivativesAccountSection nowMs={nowMs} projection={projection([shared])} />);
    const section = screen.getByRole("region", { name: "USDT cross · shared derivatives pool" });
    expect(within(section).getByText(/Shared USDT pool for perpetual and delivery contracts/)).toBeTruthy();
    expect(within(section).getAllByText("10000.000000000000000000")).toHaveLength(1);
    expect(within(section).getByText("9000.000000000000000001")).toBeTruthy();
    expect(within(section).getByText("Available to transfer")).toBeTruthy();
    expect(within(section).queryByText("Available margin")).toBeNull();
  });

  it("shows stale retained values and partial rows with safe fixed errors", () => {
    render(<DerivativesAccountSection nowMs={nowMs} stale projection={projection([
      family("usdt_isolated_perpetual"),
      family("coin_perpetual", { family: "coin_perpetual", status: "PARTIAL", error: null,
        accounts: [account({ accountCode: "THETA-USD", collateralAsset: "THETA", marginBalance: null })] }),
      family("coin_delivery_futures", { family: "coin_delivery_futures", status: "ERROR", error: "READ_FAILED", accounts: null }),
      family("usdt_cross_shared", { family: "usdt_cross_shared", status: "NOT_CONFIGURED", accounts: null,
        readStartedAtMs: null, readCompletedAtMs: null, responseGeneratedAtMs: null }),
    ])} />);
    expect(screen.getAllByText("Showing the last received account read; it may be out of date.")).toHaveLength(2);
    expect(screen.getByText("Some account values are unavailable in this read.")).toBeTruthy();
    expect(screen.queryByText("The account read timed out.")).toBeNull();
    expect(screen.getByText("The account could not be read.")).toBeTruthy();
    expect(screen.queryByText("sensitive raw error detail")).toBeNull();
    const partial = screen.getByRole("region", { name: "Coin-margined perpetual accounts" });
    expect(within(partial).getAllByText("Unavailable", { selector: "dd" })).toHaveLength(2);
  });

  it("distinguishes a successful empty family from failed and not-yet-observed families", () => {
    render(<DerivativesAccountSection nowMs={nowMs} projection={projection([
      family("usdt_cross_shared", { family: "usdt_cross_shared", accounts: [] }),
      family("coin_delivery_futures", { family: "coin_delivery_futures", status: "NOT_CONFIGURED", accounts: null,
        readStartedAtMs: null, readCompletedAtMs: null, responseGeneratedAtMs: null }),
      family("coin_perpetual", { family: "coin_perpetual", status: "ERROR", error: "PERMISSION_DENIED", accounts: null }),
      family("usdt_isolated_perpetual"),
    ])} />);
    expect(screen.getByText("No accounts were returned for this family.")).toBeTruthy();
    expect(screen.getByText("This account family is not configured for collection.")).toBeTruthy();
    expect(screen.getByText("This account family is not available for display.")).toBeTruthy();
  });
});
