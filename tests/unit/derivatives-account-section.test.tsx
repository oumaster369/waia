import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DerivativesAccountSection } from "@/components/trader/account-observation/derivatives-account-section";
import type {
  HtxDerivativesAccountFamily,
  HtxDerivativesAccountRow,
} from "@/lib/trader/account-observation/derivatives/types";
import type {
  DerivativesAccountFamilyObservation,
  DerivativesAccountObservation,
} from "@/lib/trader/account-observation/types";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";

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

const family = (
  family: HtxDerivativesAccountFamily,
  patch: Partial<DerivativesAccountFamilyObservation> = {},
): DerivativesAccountFamilyObservation => ({
  family,
  status: "COMPLETE",
  readStartedAtMs: 1_800_000_000_000,
  readCompletedAtMs: 1_800_000_000_010,
  responseGeneratedAtMs: 1_800_000_000_005,
  accounts: [account()],
  error: null,
  ...patch,
});
const position = (
  patch: Partial<
    import("@/lib/trader/account-observation/derivatives/types").HtxDerivativesPositionRow
  > = {},
) => ({
  symbol: "BTC",
  contractCode: "BTC-USDT",
  contractType: "swap",
  direction: "buy" as const,
  volume: "0.000000000000000013",
  available: "0.000000000000000011",
  frozen: "0.000000000000000002",
  costOpen: "100.000000000000000001",
  costHold: "99.000000000000000009",
  unrealizedPnl: "-0.000000000000000007",
  profitRate: "-0.000000000000000003",
  positionMargin: "3.125000000000000001",
  marginAsset: "USDT",
  leverage: "5",
  lastPrice: "101.000000000000000003",
  liquidationPrice: null,
  ...patch,
});
const positionRead = (
  patch: Partial<NonNullable<DerivativesAccountFamilyObservation["positions"]>> = {},
) => ({
  status: "COMPLETE" as const,
  values: [position()],
  readStartedAtMs: nowMs,
  readCompletedAtMs: nowMs,
  responseGeneratedAtMs: nowMs,
  error: null,
  ...patch,
});
const projection = (
  families: readonly DerivativesAccountFamilyObservation[],
): DerivativesAccountObservation => ({
  schemaVersion: "htx-derivatives-observation/v1",
  families,
});
const nowMs = 1_800_000_000_100;

describe("futures account presentation", () => {
  it("keeps observed zero, missing value, exact precision and negative PnL distinct", () => {
    render(
      <DerivativesAccountSection
        nowMs={nowMs}
        projection={projection([family("usdt_isolated_perpetual")])}
      />,
    );
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
      accounts: [
        account({
          accountCode: "USDT",
          collateralAsset: "USDT",
          marginMode: "cross",
          marginBalance: "10000.000000000000000000",
          marginAvailable: null,
          withdrawAvailable: "9000.000000000000000001",
        }),
      ],
    });
    render(<DerivativesAccountSection nowMs={nowMs} projection={projection([shared])} />);
    const section = screen.getByRole("region", { name: "USDT cross · shared derivatives pool" });
    expect(
      within(section).getByText(/Shared USDT pool for perpetual and delivery contracts/),
    ).toBeTruthy();
    expect(within(section).getAllByText("10000.000000000000000000")).toHaveLength(1);
    expect(within(section).getByText("9000.000000000000000001")).toBeTruthy();
    expect(within(section).getByText("Available to transfer")).toBeTruthy();
    expect(within(section).queryByText("Available margin")).toBeNull();
  });

  it("shows stale retained values and partial rows with safe fixed errors", () => {
    render(
      <DerivativesAccountSection
        nowMs={nowMs}
        stale
        projection={projection([
          family("usdt_isolated_perpetual"),
          family("coin_perpetual", {
            family: "coin_perpetual",
            status: "PARTIAL",
            error: null,
            accounts: [
              account({ accountCode: "THETA-USD", collateralAsset: "THETA", marginBalance: null }),
            ],
          }),
          family("coin_delivery_futures", {
            family: "coin_delivery_futures",
            status: "ERROR",
            error: "READ_FAILED",
            accounts: null,
          }),
          family("usdt_cross_shared", {
            family: "usdt_cross_shared",
            status: "NOT_CONFIGURED",
            accounts: null,
            readStartedAtMs: null,
            readCompletedAtMs: null,
            responseGeneratedAtMs: null,
          }),
        ])}
      />,
    );
    expect(
      screen.getAllByText("Showing the last received account read; it may be out of date."),
    ).toHaveLength(2);
    expect(screen.getByText("Some account values are unavailable in this read.")).toBeTruthy();
    expect(screen.queryByText("The account read timed out.")).toBeNull();
    expect(screen.getByText("The account could not be read.")).toBeTruthy();
    expect(screen.queryByText("sensitive raw error detail")).toBeNull();
    const partial = screen.getByRole("region", { name: "Coin-margined perpetual accounts" });
    expect(within(partial).getAllByText("Unavailable", { selector: "dd" })).toHaveLength(2);
  });

  it("distinguishes a successful empty family from failed and not-yet-observed families", () => {
    render(
      <DerivativesAccountSection
        nowMs={nowMs}
        projection={projection([
          family("usdt_cross_shared", { family: "usdt_cross_shared", accounts: [] }),
          family("coin_delivery_futures", {
            family: "coin_delivery_futures",
            status: "NOT_CONFIGURED",
            accounts: null,
            readStartedAtMs: null,
            readCompletedAtMs: null,
            responseGeneratedAtMs: null,
          }),
          family("coin_perpetual", {
            family: "coin_perpetual",
            status: "ERROR",
            error: "PERMISSION_DENIED",
            accounts: null,
          }),
          family("usdt_isolated_perpetual"),
        ])}
      />,
    );
    expect(screen.getByText("No accounts were returned for this family.")).toBeTruthy();
    expect(screen.getByText("This account family is not configured for collection.")).toBeTruthy();
    expect(screen.getByText("This account family is not available for display.")).toBeTruthy();
  });

  it("shows exact HTX position values separately from balances without combining rows", () => {
    const rows = [
      position(),
      position({
        symbol: "ETH",
        contractCode: "ETH-USDT",
        direction: "sell",
        volume: "2.000000000000000001",
        unrealizedPnl: "0.000000000000000009",
      }),
    ];
    render(
      <DerivativesAccountSection
        nowMs={nowMs}
        projection={projection([
          family("usdt_isolated_perpetual", {
            accounts: [account({ marginBalance: "500.000000000000000000" })],
            positions: positionRead({ values: rows }),
          }),
        ])}
      />,
    );

    const section = screen.getByRole("region", { name: "USDT perpetual · isolated accounts" });
    expect(within(section).getByText("Open positions")).toBeTruthy();
    expect(within(section).getByText("BTC · BTC-USDT")).toBeTruthy();
    expect(within(section).getByText("ETH · ETH-USDT")).toBeTruthy();
    expect(within(section).getByText("Long · swap")).toBeTruthy();
    expect(within(section).getByText("Short · swap")).toBeTruthy();
    expect(within(section).getByText("-0.000000000000000007")).toBeTruthy();
    expect(within(section).getByText("0.000000000000000009")).toBeTruthy();
    expect(within(section).getAllByText("3.125000000000000001")).toHaveLength(2);
    expect(within(section).getAllByText("USDT")).toHaveLength(2);
    expect(within(section).getByText("500.000000000000000000")).toBeTruthy();
    expect(
      within(section).queryByText("No open positions were returned for this family."),
    ).toBeNull();
  });

  it("distinguishes unobserved, empty-success, partial-stale, and failed positions", () => {
    render(
      <DerivativesAccountSection
        nowMs={nowMs}
        projection={projection([
          family("usdt_isolated_perpetual", { positions: undefined }),
          family("usdt_cross_shared", {
            family: "usdt_cross_shared",
            positions: positionRead({ values: [] }),
          }),
          family("coin_perpetual", {
            family: "coin_perpetual",
            positions: positionRead({
              status: "PARTIAL",
              readCompletedAtMs: nowMs - ACCOUNT_OBSERVATION_STALE_AFTER_MS,
            }),
          }),
          family("coin_delivery_futures", {
            family: "coin_delivery_futures",
            positions: positionRead({
              status: "ERROR",
              values: null,
              error: "RATE_LIMITED",
            }),
          }),
        ])}
      />,
    );

    const unobserved = screen.getByRole("region", { name: "USDT perpetual · isolated accounts" });
    expect(within(unobserved).getByText("Not collected in this observation.")).toBeTruthy();
    expect(within(unobserved).queryByTestId("positions-status-usdt_isolated_perpetual")).toBeNull();

    const empty = screen.getByRole("region", { name: "USDT cross · shared derivatives pool" });
    expect(
      within(empty).getByText("No open positions were returned for this family."),
    ).toBeTruthy();
    expect(within(empty).getByTestId("positions-status-usdt_cross_shared").textContent).toBe(
      "CURRENT",
    );

    const partial = screen.getByRole("region", { name: "Coin-margined perpetual accounts" });
    expect(
      within(partial).getByText("Some position values are unavailable in this read."),
    ).toBeTruthy();
    expect(within(partial).getByTestId("positions-status-coin_perpetual").textContent).toBe(
      "STALE · PARTIAL",
    );
    expect(
      within(partial).getByText("Showing the last received position read; it may be out of date."),
    ).toBeTruthy();

    const failed = screen.getByRole("region", { name: "Coin-margined delivery futures accounts" });
    expect(within(failed).getByTestId("positions-status-coin_delivery_futures").textContent).toBe(
      "ERROR",
    );
    expect(
      within(failed).getByText("The exchange temporarily limited account reads."),
    ).toBeTruthy();
    expect(
      within(failed).queryByText("No open positions were returned for this family."),
    ).toBeNull();
  });

  it("keeps executed fills separate from balances and open positions", () => {
    const fill = {
      id: "fill-eth-1",
      matchId: "42",
      orderId: "99",
      symbol: "ETH",
      contractCode: "ETH-USDT",
      contractType: "swap",
      direction: "sell" as const,
      offset: "close" as const,
      volume: "2",
      price: "3000.5",
      fee: "-0.010000000000000001",
      feeAsset: "USDT",
      realizedPnl: "-1.5",
      offsetPnl: "0E-18",
      executedAtMs: nowMs - 1_000,
      orderSource: "api",
    };
    render(
      <DerivativesAccountSection
        nowMs={nowMs}
        projection={projection([
          family("usdt_isolated_perpetual", {
            accounts: [account({ marginBalance: "500" })],
            positions: positionRead(),
            executions: {
              status: "COMPLETE",
              coverage: "CONFIGURED_CONTRACTS",
              values: [fill],
              contracts: ["ETH-USDT"],
              readStartedAtMs: nowMs,
              readCompletedAtMs: nowMs,
              responseGeneratedAtMs: nowMs,
              windowStartMs: nowMs - 86_400_000,
              windowEndMs: nowMs,
              error: null,
            },
          }),
          family("usdt_cross_shared", {
            family: "usdt_cross_shared",
            accounts: [
              account({
                accountCode: "USDT",
                marginBalance: "10000",
                marginMode: "cross",
                withdrawAvailable: "9000",
              }),
            ],
            executions: {
              status: "PARTIAL",
              coverage: "CONFIGURED_CONTRACTS",
              values: [{ ...fill, id: "fill-cross-1", contractCode: "ETH-USDT" }],
              contracts: ["ETH-USDT", "BTC-USDT"],
              readStartedAtMs: nowMs,
              readCompletedAtMs: nowMs,
              responseGeneratedAtMs: null,
              windowStartMs: nowMs - 86_400_000,
              windowEndMs: nowMs,
              error: null,
            },
          }),
          family("coin_perpetual", {
            family: "coin_perpetual",
            executions: {
              status: "NOT_CONFIGURED",
              coverage: "NOT_CONFIGURED",
              values: null,
              contracts: [],
              readStartedAtMs: nowMs,
              readCompletedAtMs: nowMs,
              responseGeneratedAtMs: null,
              windowStartMs: null,
              windowEndMs: null,
              error: null,
            },
          }),
          family("coin_delivery_futures", {
            family: "coin_delivery_futures",
            executions: {
              status: "ERROR",
              coverage: "CONFIGURED_CONTRACTS",
              values: null,
              contracts: ["BTC201225"],
              readStartedAtMs: nowMs,
              readCompletedAtMs: nowMs,
              responseGeneratedAtMs: null,
              windowStartMs: nowMs - 86_400_000,
              windowEndMs: nowMs,
              error: "TIMEOUT",
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText(/Seeing this display does not permit futures trading\./)).toBeTruthy();
    const isolated = screen.getByRole("region", { name: "USDT perpetual · isolated accounts" });
    expect(within(isolated).getByText("Open positions")).toBeTruthy();
    expect(within(isolated).getByText("Recent executions")).toBeTruthy();
    expect(within(isolated).getByText("Executed fill · ETH · ETH-USDT")).toBeTruthy();
    expect(
      within(isolated).getByText("Sell · Close · not an open position or a balance"),
    ).toBeTruthy();
    expect(within(isolated).getByText("-0.010000000000000001")).toBeTruthy();
    expect(within(isolated).getByText("0E-18")).toBeTruthy();
    expect(within(isolated).getByText("500")).toBeTruthy();
    expect(within(isolated).getAllByText("USDT").length).toBeGreaterThan(0);

    const cross = screen.getByRole("region", { name: "USDT cross · shared derivatives pool" });
    expect(
      within(cross).getByText(/These fills are not a second copy of the shared USDT pool/),
    ).toBeTruthy();
    expect(
      within(cross).getByText(
        "This fill history hit a read limit or is missing values. It is not a complete history.",
      ),
    ).toBeTruthy();
    expect(within(cross).getAllByText("10000")).toHaveLength(1);

    const coin = screen.getByRole("region", { name: "Coin-margined perpetual accounts" });
    expect(
      within(coin).getByText(
        "No closed contract set is configured for fill history. Open positions do not prove fills for contracts that are already closed.",
      ),
    ).toBeTruthy();
    expect(within(coin).getByTestId("executions-status-coin_perpetual").textContent).toBe(
      "NOT CONFIGURED",
    );

    const delivery = screen.getByRole("region", {
      name: "Coin-margined delivery futures accounts",
    });
    expect(
      within(delivery).getByTestId("executions-status-coin_delivery_futures").textContent,
    ).toBe("ERROR");
    expect(within(delivery).getByText("The account read timed out.")).toBeTruthy();
  });
});
