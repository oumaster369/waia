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

function projection(patch: Partial<Extract<HtxV5AccountObservation, { schemaVersion: "htx-v5-observation/v1" }>> = {}): HtxV5AccountObservation {
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
    expect(within(balance).getByText("Account equity (USD)")).toBeInTheDocument();
    expect(within(balance).getByText("1000.25")).toBeInTheDocument();
    expect(within(balance).getByText("Collateral in USDT")).toBeInTheDocument();
    expect(within(balance).getByText("Equity (native currency units)")).toBeInTheDocument();
    expect(screen.getByText("Position quantity (contracts)")).toBeInTheDocument();
    expect(screen.getByText("7", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("59000", { exact: true })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /Stop order/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Fill quantity (contracts)")).toBeInTheDocument();
    expect(screen.getByText("Read contracts: BTC-USDT")).toBeInTheDocument();
    expect(screen.getByText(/^History window:/)).toBeInTheDocument();
    expect(screen.getAllByText("Some records may be missing from this sample.")).toHaveLength(3);
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /This snapshot does not confirm protection of the open position/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This window does not confirm complete daily activity or a daily result.",
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
      screen.getByText("Balance unavailable — this does not mean zero."),
    ).toBeInTheDocument();
    expect(screen.getByText("No open positions were received.")).toBeInTheDocument();
    expect(screen.getByText("The account read timed out.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX open orders" })).getByText(
        "BTC-USDT · sell · new",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("stale · partial data")).toHaveLength(3);
  });

  it("shows only received position-matched stop and target details and keeps protection unconfirmed", () => {
    const base = projection();
    const target = {
      ...base.algoOrders.values![0]!,
      id: "target-view-id",
      algoId: "target-algo-id",
      type: "tp" as const,
      tpTriggerPrice: "62000",
      slTriggerPrice: null,
    };
    const wrongSide = { ...target, id: "wrong-side", algoId: "wrong-side", side: "buy" as const };
    const result = projection({
      algoOrders: { ...base.algoOrders, values: [...base.algoOrders.values!, target, wrongSide] },
    });
    render(<HtxV5AccountSection projection={result} stale={false} nowMs={now} />);
    const positions = within(screen.getByRole("region", { name: "HTX positions" }));
    expect(positions.getByText("Stop: price 58999; quantity 3 contracts")).toBeInTheDocument();
    expect(positions.getByText("Target: price 62000; quantity 3 contracts")).toBeInTheDocument();
    expect(positions.queryByText(/wrong-side/)).not.toBeInTheDocument();
    expect(
      positions.getByText("Position coverage is unknown; protection is not confirmed."),
    ).toBeInTheDocument();
    expect(positions.queryByText(/protected|fully protected/i)).not.toBeInTheDocument();
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
      screen.getByText("Fill history unavailable; the fill count is unknown."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Conditional order data unavailable. Protection is not confirmed."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No fills were received for the specified contracts and displayed window."),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /This snapshot does not confirm protection of the open position/,
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
        "BTC-USDT · long · cross margin",
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
        "BTC-USDT · Stop order",
      ),
    ).toHaveLength(100);
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        "Showing the first 100 of 103 received rows.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Fill · BTC-USDT · sell")).toHaveLength(100);
    expect(screen.getByText("Showing the first 100 of 103 received fills.")).toBeInTheDocument();
  });

  it("keeps a flat-or-unavailable position snapshot from creating a protection alert", () => {
    const base = projection();
    const result = projection({ positions: { ...base.positions, values: [] } });
    render(<HtxV5AccountSection projection={result} stale={false} nowMs={now} />);
    expect(
      screen.queryByText(/This snapshot does not confirm protection of the open position/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Conditional orders are shown separately from positions; protection completeness is not assessed.",
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
      screen.queryByText(/This snapshot does not confirm protection of the open position/),
    ).not.toBeInTheDocument();
    rerender(<HtxV5AccountSection projection={positive} stale={false} nowMs={now} />);
    expect(screen.getByText("0.0000000000000000000000001", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/This snapshot does not confirm protection of the open position/)).toHaveAttribute(
      "role",
      "alert",
    );
  });
  it.each([['buy', 'long'], ['sell', 'short']] as const)("shows direction %s in one-way positions", (direction, label) => {
    const base = projection();
    const result = projection({ positions: { ...base.positions, values: [{ ...base.positions.values![0], positionSide: "both", direction }] } });
    render(<HtxV5AccountSection projection={result} stale={false} nowMs={now} />);
    expect(screen.getByRole("heading", { name: `BTC-USDT · ${label} (one-way mode) · cross margin` })).toBeInTheDocument();
  });

});

describe("received stop evidence explanations", () => {
  it("shows the exact comparison and independent read times without confirming protection", () => {
    const base = projection();
    render(<HtxV5AccountSection projection={{ ...base, algoOrders: { ...base.algoOrders, readCompletedAtMs: now - 5 } }} stale={false} nowMs={now} />);
    const positions = within(screen.getByRole("region", { name: "HTX positions" }));
    expect(positions.getByText("Received quantity of one SL order (3 contracts) less than the quantity of the position (7 contracts). This compares received numbers; it does not confirm protection.")).toBeInTheDocument();
    expect(positions.getByText(/Positions read at:/)).toHaveTextContent(new Date(now).toISOString());
    expect(positions.getByText(/Positions read at:/)).toHaveTextContent(new Date(now - 5).toISOString());
    expect(positions.getByText(/These reads are not a simultaneous snapshot/)).toBeInTheDocument();
    expect(positions.getByText("These data do not confirm how much of the position would be closed.")).toBeInTheDocument();
    expect(positions.getByText("The received sample is incomplete; stop orders may be missing.")).toBeInTheDocument();
    expect(positions.queryByText(/protected|fully protected/i)).not.toBeInTheDocument();
  });

  it.each(["stale", "error", "scope"] as const)("clears a displayed quantity comparison on %s update", change => {
    const base = projection();
    const { rerender } = render(<HtxV5AccountSection projection={base} stale={false} nowMs={now} />);
    expect(screen.getByText(/Received quantity of one SL order/)).toBeInTheDocument();
    const changed = change === "error"
      ? { ...base, algoOrders: { ...base.algoOrders, status: "ERROR" as const, error: "READ_FAILED" as const } }
      : change === "scope"
        ? { ...base, positions: { ...base.positions, values: [{ ...base.positions.values![0]!, contractCode: "ETH-USDT" }] } }
        : base;
    rerender(<HtxV5AccountSection projection={changed} stale={change === "stale"} nowMs={now} />);
    expect(screen.queryByText(/Received quantity of one SL order/)).not.toBeInTheDocument();
    const positions = within(screen.getByRole("region", { name: "HTX positions" }));
    expect(positions.queryByText(/protected|fully protected/i)).not.toBeInTheDocument();
  });

  it.each(["duplicate", "multiple", "tp-only"] as const)("explains %s evidence without aggregating quantities", kind => {
    const base = projection();
    const sl = base.algoOrders.values![0]!;
    const second = { ...sl, id: "different-id", algoId: kind === "duplicate" ? sl.algoId : "different-algo", type: "tp" as const, slTriggerPrice: null, tpTriggerPrice: "62000" };
    const values = kind === "tp-only" ? [second] : [sl, kind === "multiple" ? { ...sl, id: "second-sl", algoId: "second-sl" } : second];
    render(<HtxV5AccountSection projection={{ ...base, algoOrders: { ...base.algoOrders, values } }} stale={false} nowMs={now} />);
    const positions = within(screen.getByRole("region", { name: "HTX positions" }));
    expect(positions.queryByText(/Received quantity of one SL order/)).not.toBeInTheDocument();
    expect(positions.getByText(kind === "duplicate"
      ? "An order identity is duplicated in the received data; quantities are not compared."
      : kind === "multiple"
        ? "Multiple matching stop orders were received; their quantities are not added together."
        : "No matching SL order was received; this does not prove its absence. A TP target does not replace a stop.")).toBeInTheDocument();
  });
});
