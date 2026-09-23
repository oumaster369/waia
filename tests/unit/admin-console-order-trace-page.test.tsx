import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  orderRowView,
  OrdersPanel,
} from "@/components/trader/admin-console/sections/orders/orders-panel";

describe("admin console order trace page", () => {
  it("shows reconciliation required and does not offer a retry", () => {
    const row = orderRowView({ id: "1", symbol: "btcusdt", state: "RECONCILIATION_REQUIRED" });
    render(<OrdersPanel rows={[row]} />);
    expect(screen.getByText("Требует сверки")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /повтор/i })).not.toBeInTheDocument();
  });
});
