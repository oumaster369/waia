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
    expect(within(balance).getByText("Капитал счёта (USD)")).toBeInTheDocument();
    expect(within(balance).getByText("1000.25")).toBeInTheDocument();
    expect(within(balance).getByText("Обеспечение в USDT")).toBeInTheDocument();
    expect(within(balance).getByText("Капитал (в единицах валюты)")).toBeInTheDocument();
    expect(screen.getByText("Объём позиции (контракты)")).toBeInTheDocument();
    expect(screen.getByText("7", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("59000", { exact: true })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /Стоп-заявка/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Объём исполнения (контракты)")).toBeInTheDocument();
    expect(screen.getByText("Контракты чтения: BTC-USDT")).toBeInTheDocument();
    expect(screen.getByText(/^Период истории:/)).toBeInTheDocument();
    expect(screen.getAllByText("В этой выборке могут отсутствовать некоторые записи.")).toHaveLength(3);
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /Наличие защиты открытой позиции не подтверждено этим снимком/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Этот период не подтверждает полную дневную активность или итог за день.",
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
      screen.getByText("Баланс недоступен — это не означает нулевое значение."),
    ).toBeInTheDocument();
    expect(screen.getByText("Открытые позиции не получены.")).toBeInTheDocument();
    expect(screen.getByText("Истекло время чтения счёта.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Открытые заявки HTX" })).getByText(
        "BTC-USDT · sell · new",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("устарело · частичные данные")).toHaveLength(3);
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
    expect(positions.getByText("Стоп: цена 58999; объём 3 контр.")).toBeInTheDocument();
    expect(positions.getByText("Цель: цена 62000; объём 3 контр.")).toBeInTheDocument();
    expect(positions.queryByText(/wrong-side/)).not.toBeInTheDocument();
    expect(
      positions.getByText("Полнота покрытия позиции неизвестна; защита не подтверждена."),
    ).toBeInTheDocument();
    expect(positions.queryByText(/защищена|полностью защищена/i)).not.toBeInTheDocument();
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
      screen.getByText("История исполнений недоступна; число исполнений неизвестно."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Данные условных заявок недоступны. Наличие защиты не подтверждено."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Исполнения по указанным контрактам и за показанный период не получены."),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        /Наличие защиты открытой позиции не подтверждено этим снимком/,
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
        "BTC-USDT · лонг · кросс-маржа",
      ),
    ).toHaveLength(100);
    expect(
      within(screen.getByRole("region", { name: "HTX positions" })).getByText(
        "Показаны первые 100 из 103 полученных позиций.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Открытые заявки HTX" })).getAllByText(
        "BTC-USDT · sell · new",
      ),
    ).toHaveLength(100);
    expect(
      within(screen.getByRole("region", { name: "Открытые заявки HTX" })).getByText(
        "Показаны первые 100 из 103 полученных строк.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getAllByText(
        "BTC-USDT · Стоп-заявка",
      ),
    ).toHaveLength(100);
    expect(
      within(screen.getByRole("region", { name: "HTX conditional orders" })).getByText(
        "Показаны первые 100 из 103 полученных строк.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Исполнение · BTC-USDT · sell")).toHaveLength(100);
    expect(screen.getByText("Показаны первые 100 из 103 полученных исполнений.")).toBeInTheDocument();
  });

  it("keeps a flat-or-unavailable position snapshot from creating a protection alert", () => {
    const base = projection();
    const result = projection({ positions: { ...base.positions, values: [] } });
    render(<HtxV5AccountSection projection={result} stale={false} nowMs={now} />);
    expect(
      screen.queryByText(/Наличие защиты открытой позиции не подтверждено этим снимком/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Условные заявки показаны отдельно от позиций; полнота защиты не оценивается.",
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
      screen.queryByText(/Наличие защиты открытой позиции не подтверждено этим снимком/),
    ).not.toBeInTheDocument();
    rerender(<HtxV5AccountSection projection={positive} stale={false} nowMs={now} />);
    expect(screen.getByText("0.0000000000000000000000001", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Наличие защиты открытой позиции не подтверждено этим снимком/)).toHaveAttribute(
      "role",
      "alert",
    );
  });
  it.each([['buy', 'лонг'], ['sell', 'шорт']] as const)("shows direction %s in one-way positions", (direction, label) => {
    const base = projection();
    const result = projection({ positions: { ...base.positions, values: [{ ...base.positions.values![0], positionSide: "both", direction }] } });
    render(<HtxV5AccountSection projection={result} stale={false} nowMs={now} />);
    expect(screen.getByRole("heading", { name: `BTC-USDT · ${label} (односторонний режим) · кросс-маржа` })).toBeInTheDocument();
  });

});

describe("received stop evidence explanations", () => {
  it("shows the exact comparison and independent read times without confirming protection", () => {
    const base = projection();
    render(<HtxV5AccountSection projection={{ ...base, algoOrders: { ...base.algoOrders, readCompletedAtMs: now - 5 } }} stale={false} nowMs={now} />);
    const positions = within(screen.getByRole("region", { name: "HTX positions" }));
    expect(positions.getByText("Полученный объём одной SL-заявки (3 контр.) меньше объёма позиции (7 контр.). Это сравнение полученных чисел, не подтверждение защиты.")).toBeInTheDocument();
    expect(positions.getByText(/Позиции прочитаны:/)).toHaveTextContent(new Date(now).toISOString());
    expect(positions.getByText(/Позиции прочитаны:/)).toHaveTextContent(new Date(now - 5).toISOString());
    expect(positions.getByText(/Эти чтения не являются одновременным снимком/)).toBeInTheDocument();
    expect(positions.getByText("По этим данным не подтверждено, какой объём позиции будет закрыт.")).toBeInTheDocument();
    expect(positions.getByText("Получена неполная выборка: в ней могут отсутствовать стоп-заявки.")).toBeInTheDocument();
    expect(positions.queryByText(/защищена|полностью защищена/i)).not.toBeInTheDocument();
  });

  it.each(["stale", "error", "scope"] as const)("clears a displayed quantity comparison on %s update", change => {
    const base = projection();
    const { rerender } = render(<HtxV5AccountSection projection={base} stale={false} nowMs={now} />);
    expect(screen.getByText(/Полученный объём одной SL-заявки/)).toBeInTheDocument();
    const changed = change === "error"
      ? { ...base, algoOrders: { ...base.algoOrders, status: "ERROR" as const, error: "READ_FAILED" as const } }
      : change === "scope"
        ? { ...base, positions: { ...base.positions, values: [{ ...base.positions.values![0]!, contractCode: "ETH-USDT" }] } }
        : base;
    rerender(<HtxV5AccountSection projection={changed} stale={change === "stale"} nowMs={now} />);
    expect(screen.queryByText(/Полученный объём одной SL-заявки/)).not.toBeInTheDocument();
    const positions = within(screen.getByRole("region", { name: "HTX positions" }));
    expect(positions.queryByText(/защищена|полностью защищена/i)).not.toBeInTheDocument();
  });

  it.each(["duplicate", "multiple", "tp-only"] as const)("explains %s evidence without aggregating quantities", kind => {
    const base = projection();
    const sl = base.algoOrders.values![0]!;
    const second = { ...sl, id: "different-id", algoId: kind === "duplicate" ? sl.algoId : "different-algo", type: "tp" as const, slTriggerPrice: null, tpTriggerPrice: "62000" };
    const values = kind === "tp-only" ? [second] : [sl, kind === "multiple" ? { ...sl, id: "second-sl", algoId: "second-sl" } : second];
    render(<HtxV5AccountSection projection={{ ...base, algoOrders: { ...base.algoOrders, values } }} stale={false} nowMs={now} />);
    const positions = within(screen.getByRole("region", { name: "HTX positions" }));
    expect(positions.queryByText(/Полученный объём одной SL-заявки/)).not.toBeInTheDocument();
    expect(positions.getByText(kind === "duplicate"
      ? "Идентификатор заявки повторяется в полученных данных; объёмы не сравниваются."
      : kind === "multiple"
        ? "Получено несколько совпавших стоп-заявок; их объёмы не складываются."
        : "Совпавшая стоп-заявка SL не получена; это не доказывает её отсутствие. Цель TP не заменяет стоп.")).toBeInTheDocument();
  });
});
