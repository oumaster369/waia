import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AccountAssets } from "@/components/trader/admin-console/sections/accounts/account-assets";

describe("observed account asset display", () => {
  it("keeps cash and nonzero evidence visible and expands confirmed zero balances on request", () => {
    render(
      <AccountAssets
        finance={{
          currency: "USDT",
          method: "htx_spot_last:usdt",
          observedAt: "2026-09-25T07:00:00Z",
          reason: null,
          assets: [
            { asset: "USDT", free: "0", locked: "0", value: "0", state: "ok", reasons: [] },
            {
              asset: "BTC",
              free: "0.00000001",
              locked: "0",
              value: null,
              state: "partial",
              reasons: ["NO_QUOTE:BTC"],
            },
            {
              asset: "DUST",
              free: "0.0000000000",
              locked: "0",
              value: "0",
              state: "ok",
              reasons: [],
            },
          ],
        }}
      />,
    );
    const table = screen.getByRole("table", { name: "Активы счёта" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("USDT")).toBeInTheDocument();
    expect(screen.getByText("0.00000001")).toBeInTheDocument();
    expect(screen.queryByText("DUST")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Показать нулевые остатки (1)" }));
    expect(screen.getByText("DUST")).toBeInTheDocument();
    const hide = screen.getByRole("button", { name: "Скрыть нулевые остатки" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(hide);
    expect(screen.queryByText("DUST")).not.toBeInTheDocument();
    expect(screen.getByText("BTC")).toBeInTheDocument();
  });
});
