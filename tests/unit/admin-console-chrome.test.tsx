import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AssistantPanel } from "@/components/trader/admin-console/assistant/assistant-panel";
import { MarketStrip } from "@/components/trader/admin-console/shell/market-strip";
import { StatusBar } from "@/components/trader/admin-console/shell/status-bar";

describe("admin console chrome", () => {
  it("does not call a USDT quote BTC/USD", () => {
    render(<MarketStrip />);
    expect(screen.getByText(/Рынок сейчас/)).toBeInTheDocument();
    expect(screen.queryByText(/BTC\/USD(?!T)/)).not.toBeInTheDocument();
    render(<MarketStrip quote={{ symbol: "BTC", currency: "USDT", price: "1" }} />);
    expect(screen.getByText(/BTC\/USDT/)).toBeInTheDocument();
    expect(screen.queryByText(/BTC\/USD(?!T)/)).not.toBeInTheDocument();
  });

  it("shows the assistant banner and an empty delivery sample", () => {
    render(<StatusBar />);
    expect(screen.getByText(/p95: нет измерения/)).toBeInTheDocument();
    render(
      <AssistantPanel enabled={false} answers={[{ id: "orders", title: "Рабочие ордера" }]} />,
    );
    expect(screen.getByText(/Быстрые ответы работают/)).toBeInTheDocument();
    expect(screen.getByText("Рабочие ордера")).toBeInTheDocument();
  });
});
