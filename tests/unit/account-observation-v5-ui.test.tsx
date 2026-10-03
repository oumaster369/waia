import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HtxV5AccountSection } from "@/components/trader/account-observation/htx-v5-account-section";
import type { HtxV5AccountObservation } from "@/lib/trader/account-observation/types";

const now = 1_800_000_000_000;
const unknownPage = {
  pageSize: 20,
  maxPages: 2,
  pagesRead: 2,
  nextFrom: null,
  completeness: "UNKNOWN" as const,
};

function projection(patch: Partial<HtxV5AccountObservation> = {}): HtxV5AccountObservation {
  return {
    schemaVersion: "htx-v5-observation/v1",
    htxUid: "9988776655",
    assetMode: {
      status: "COMPLETE",
      value: "1",
      readStartedAtMs: now - 10,
      readCompletedAtMs: now,
      responseGeneratedAtMs: now,
      error: null,
    },
    balance: {
      status: "COMPLETE",
      readStartedAtMs: now - 10,
      readCompletedAtMs: now,
      responseGeneratedAtMs: now,
      error: null,
      value: {
        state: "normal",
        account: {
          equityUsd: "1000.25",
          initialMarginUsd: "2.5",
          maintenanceMarginUsd: "1.25",
          maintenanceMarginRate: "0.002",
          profitUnrealUsd: "-0.000000000000000007",
          availableMarginUsd: "997.75",
          voucherValue: "0",
          createdTimeMs: now - 100,
          updatedTimeMs: now,
        },
        details: [
          {
            currency: "USDT",
            equity: "999",
            isolatedEquity: "0",
            available: "995",
            isolatedAvailable: "0",
            withdrawAvailable: "994",
            profitUnreal: "-0.25",
            isolatedProfitUnreal: "0",
            initialMargin: "2.5",
            maintenanceMargin: "1.25",
            maintenanceMarginRate: "0.002",
            initialMarginRate: "0.003",
            voucher: "0",
            voucherValue: "0",
            createdTimeMs: now - 100,
            updatedTimeMs: now,
          },
        ],
      },
    },
    positions: {
      status: "COMPLETE",
      values: [
        {
          contractCode: "BTC-USDT",
          positionSide: "long",
          direction: "buy",
          marginMode: "cross",
          volume: "7",
          available: "6",
          openAveragePrice: "60000.5",
          liquidationPrice: null,
          initialMargin: "2",
          maintenanceMargin: "1",
          margin: "2.5",
          profitUnreal: "-0.000000000000000007",
          profitRate: "-0.0001",
          marginRate: "0.01",
          marginCurrency: "USDT",
          lastPrice: "60001",
          markPrice: "59999.5",
          contractType: "swap",
          createdTimeMs: now - 20,
          updatedTimeMs: now,
        },
      ],
      readStartedAtMs: now - 10,
      readCompletedAtMs: now,
      responseGeneratedAtMs: now,
      error: null,
      pageScope: null,
    },
    openOrders: {
      status: "PARTIAL",
      values: [
        {
          id: "view-id",
          contractCode: "BTC-USDT",
          orderId: "887766554433",
          clientOrderId: null,
          side: "sell",
          positionSide: "long",
          marginMode: "cross",
          volume: "3",
          state: "new",
          reduceOnly: true,
          tpTriggerPrice: "61000",
          slTriggerPrice: "59000",
          createdTimeMs: now - 20,
          updatedTimeMs: now,
        },
      ],
      readStartedAtMs: now - 10,
      readCompletedAtMs: now,
      responseGeneratedAtMs: now,
      error: null,
      pageScope: unknownPage,
    },
    algoOrders: {
      status: "PARTIAL",
      values: [
        {
          id: "algo-view-id",
          algoId: "887766554434",
          contractCode: "BTC-USDT",
          volume: "3",
          type: "sl",
          state: "active",
          positionSide: "long",
          side: "sell",
          marginMode: "cross",
          tpTriggerPrice: null,
          slTriggerPrice: "58999",
          reduceOnly: true,
          createdTimeMs: now - 20,
          updatedTimeMs: now,
        },
      ],
      readStartedAtMs: now - 10,
      readCompletedAtMs: now,
      responseGeneratedAtMs: now,
      error: null,
      pageScope: {
        pageSize: 20,
        maxPagesPerType: 2,
        queries: ["tp", "sl", "tpsl", "trigger", "trailing_stop"].map((type) => ({
          type,
          pagesRead: 2,
          nextFrom: null,
        })),
        completeness: "UNKNOWN",
      },
    },
    fills: {
      status: "PARTIAL",
      coverage: "CONFIGURED_CONTRACTS_AND_WINDOW",
      contracts: ["BTC-USDT"],
      windowStartMs: now - 3_600_000,
      windowEndMs: now,
      readStartedAtMs: now - 10,
      readCompletedAtMs: now,
      responseGeneratedAtMs: now,
      error: null,
      pageScope: {
        pageSize: 100,
        maxPagesPerContract: 2,
        queries: [{ contractCode: "BTC-USDT", pagesRead: 2, nextFrom: null }],
        completeness: "UNKNOWN",
      },
      values: [
        {
          id: "887766554435",
          tradeId: "887766554436",
          orderId: "887766554433",
          contractCode: "BTC-USDT",
          side: "sell",
          positionSide: "long",
          orderType: "1",
          marginMode: "cross",
          tradePrice: "60010.25",
          tradeVolume: "2",
          tradeTurnover: "120020.5",
          tradeFee: "-0.01",
          feeCurrency: "USDT",
          profit: "-0.5",
          createdTimeMs: now - 1000,
          updatedTimeMs: now - 900,
        },
      ],
    },
    ...patch,
  };
}

describe("HTX futures snapshot UI", () => {
  it("keeps USD aggregates, currency collateral, contract volumes, order triggers, and fills distinct", () => {
    render(<HtxV5AccountSection projection={projection()} stale={false} nowMs={now} />);
    const balance = screen.getByRole("region", { name: "HTX futures balance" });
    expect(within(balance).getByText("Total equity (USD)")).toBeInTheDocument();
    expect(within(balance).getByText("1000.25")).toBeInTheDocument();
    expect(within(balance).getByText("USDT collateral")).toBeInTheDocument();
    expect(within(balance).getByText("Equity (currency units)")).toBeInTheDocument();
    expect(screen.getByText("Position volume (contracts)")).toBeInTheDocument();
    expect(screen.getByText("7", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("59000", { exact: true })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /Stop-loss order/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Fill volume (contracts)")).toBeInTheDocument();
    expect(screen.getByText("Contracts covered: BTC-USDT")).toBeInTheDocument();
    expect(screen.getByText(/^History period:/)).toBeInTheDocument();
    expect(screen.getAllByText("Some results may be missing from this read.")).toHaveLength(3);
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /Open-position protection has not been confirmed from this snapshot/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This history period does not establish complete daily activity or daily PnL.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("9988776655")).not.toBeInTheDocument();
    expect(screen.queryByText(/coin quantity|notional|daily PnL:/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "HTX futures snapshot" }).querySelector("button"),
    ).toBeNull();
  });

  it("distinguishes unavailable from empty and retains received rows with stale/partial status", () => {
    const base = projection();
    const result = projection({
      balance: { ...base.balance, status: "ERROR", value: null, error: "READ_FAILED" },
      positions: { ...base.positions, values: [], status: "COMPLETE" },
      openOrders: { ...base.openOrders, status: "PARTIAL", error: "TIMEOUT" },
    });
    render(<HtxV5AccountSection projection={result} stale={true} nowMs={now + 1} />);
    expect(
      screen.getByText("Balance values unavailable — not an observed zero."),
    ).toBeInTheDocument();
    expect(screen.getByText("No open positions were returned.")).toBeInTheDocument();
    expect(screen.getByText("The account read timed out.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX open orders" })).getByText(
        "BTC-USDT · sell · new",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("STALE · PARTIAL")).toHaveLength(3);
  });

  it("marks unconfigured fills unavailable rather than zero and does not claim protection", () => {
    const base = projection();
    const result = projection({
      fills: {
        status: "NOT_CONFIGURED",
        coverage: "NOT_CONFIGURED",
        contracts: [],
        windowStartMs: null,
        windowEndMs: null,
        values: null,
        readStartedAtMs: null,
        readCompletedAtMs: null,
        responseGeneratedAtMs: null,
        error: null,
        pageScope: null,
      },
      algoOrders: {
        ...base.algoOrders,
        status: "ERROR",
        values: null,
        error: "PERMISSION_DENIED",
        pageScope: null,
      },
    });
    render(<HtxV5AccountSection projection={result} stale={false} nowMs={now} />);
    expect(
      screen.getByText("Fill history is unavailable; no fill count is implied."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Conditional-order data unavailable — exchange protection is unconfirmed."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No fills returned for the contracts and history period shown."),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /Open-position protection has not been confirmed/,
      ),
    ).toHaveAttribute("role", "alert");
  });

  it("bounds each received row group to 100 and explains the omitted rows", () => {
    const base = projection();
    const result = projection({
      positions: {
        ...base.positions,
        values: Array.from({ length: 103 }, () => base.positions.values![0]),
      },
      openOrders: {
        ...base.openOrders,
        values: Array.from({ length: 103 }, (_, index) => ({
          ...base.openOrders.values![0],
          id: String(880000000000000000 + index),
          orderId: String(770000000000000000 + index),
        })),
      },
      algoOrders: {
        ...base.algoOrders,
        values: Array.from({ length: 103 }, (_, index) => ({
          ...base.algoOrders.values![0],
          id: String(660000000000000000 + index),
          algoId: String(550000000000000000 + index),
        })),
      },
      fills: {
        ...base.fills,
        values: Array.from({ length: 103 }, (_, index) => ({
          ...base.fills.values![0],
          id: String(440000000000000000 + index),
          tradeId: String(330000000000000000 + index),
        })),
      },
    });
    render(<HtxV5AccountSection projection={result} stale={false} nowMs={now} />);
    expect(
      within(screen.getByRole("region", { name: "HTX positions" })).getAllByText(
        "BTC-USDT · long · cross",
      ),
    ).toHaveLength(100);
    expect(
      within(screen.getByRole("region", { name: "HTX positions" })).getByText(
        "Showing the first 100 of 103 received positions.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX open orders" })).getAllByText(
        "BTC-USDT · sell · new",
      ),
    ).toHaveLength(100);
    expect(
      within(screen.getByRole("region", { name: "HTX open orders" })).getByText(
        "Showing the first 100 of 103 received rows.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getAllByText(
        "BTC-USDT · Stop-loss order",
      ),
    ).toHaveLength(100);
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        "Showing the first 100 of 103 received rows.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Executed fill · BTC-USDT · sell")).toHaveLength(100);
    expect(screen.getByText("Showing the first 100 of 103 received fills.")).toBeInTheDocument();
  });

  it("keeps a flat-or-unavailable position snapshot from creating a protection alert", () => {
    const base = projection();
    const result = projection({ positions: { ...base.positions, values: [] } });
    render(<HtxV5AccountSection projection={result} stale={false} nowMs={now} />);
    expect(
      screen.queryByText(/Open-position protection has not been confirmed/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Conditional orders are listed separately from positions; protection coverage is not assessed.",
      ),
    ).toBeInTheDocument();
  });

  it("alerts for positive contract volume without treating decimal zero as an open position", () => {
    const base = projection();
    const position = base.positions.values![0];
    const zero = projection({
      positions: { ...base.positions, values: [{ ...position, volume: "0e-10" }] },
    });
    const positive = projection({
      positions: {
        ...base.positions,
        values: [{ ...position, volume: "0.0000000000000000000000001" }],
      },
    });
    const { rerender } = render(
      <HtxV5AccountSection projection={zero} stale={false} nowMs={now} />,
    );
    expect(screen.getByText("0e-10", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByText(/Open-position protection has not been confirmed/),
    ).not.toBeInTheDocument();
    rerender(<HtxV5AccountSection projection={positive} stale={false} nowMs={now} />);
    expect(screen.getByText("0.0000000000000000000000001", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Open-position protection has not been confirmed/)).toHaveAttribute(
      "role",
      "alert",
    );
  });
});
