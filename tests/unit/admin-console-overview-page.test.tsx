import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  OverviewPanel,
  overviewFromEnvelope,
} from "@/components/trader/admin-console/sections/overview/overview-panel";

describe("admin console overview page", () => {
  it("shows excluded accounts and keeps the last known estimate out of the equity sum", () => {
    const view = overviewFromEnvelope({
      data: {
        coverageLabel: "По 1 актуальным счетам из 2",
        lastKnownEstimate: "4",
        finance: {
          equity: { value: { amount: "10", currency: "USDT" } },
          free: { value: { amount: "3", currency: "USDT" } },
          holdings: { value: { amount: "7", currency: "USDT" } },
          reserved: { value: { amount: "1", currency: "USDT" } },
          pnl: { value: null },
        },
      },
      coverage: { excluded: [{ id: "acc-2", reason: "NO_QUOTE:BTC" }] },
    });
    render(<OverviewPanel view={view} />);
    expect(screen.getByTestId("overview-Оценка")).toHaveTextContent("10");
    expect(screen.getByTestId("overview-Оценка")).not.toHaveTextContent("4");
    expect(screen.getByTestId("overview-last-known")).toHaveTextContent("4");
    expect(screen.getByText("acc-2: NO_QUOTE:BTC")).toBeInTheDocument();
    expect(screen.getByTestId("overview-Результат")).toHaveTextContent("—");
  });

  it("shows postgres required instead of zeros", () => {
    render(
      <OverviewPanel
        view={overviewFromEnvelope({
          data: { state: "unavailable", reasons: ["POSTGRES_REQUIRED"] },
        })}
      />,
    );
    expect(screen.getByText(/Нужен Postgres/)).toBeInTheDocument();
    expect(screen.queryByText("0 USDT")).not.toBeInTheDocument();
  });
});
