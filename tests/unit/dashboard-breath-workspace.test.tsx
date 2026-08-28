import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardBreathWorkspace } from "@/components/dashboard/breath-workspace";

describe("Dashboard Breath of WAIA workspace", () => {
  it("renders anonymous guidance, named intent form, self share and verified history", () => {
    render(
      <DashboardBreathWorkspace
        displayName="Adamar"
        accountingCurrency="USD"
        support={{
          address: "TE1BrKebw9AAYGUpztgn7xG9hMujTePkzD",
          explorerUrl: "https://tronscan.org/#/address/TE1BrKebw9AAYGUpztgn7xG9hMujTePkzD",
        }}
        record={{
          numeratorMicros: "2006000000",
          denominatorMicros: "2006000000",
          isZeroShare: false,
          partsPerMillion: "1000000",
          lastUpdatedAt: "2026-08-27T11:28:00.000Z",
          contributions: [
            {
              transactionId: "verified-contribution",
              occurredAt: "2026-08-27T11:25:00.000Z",
              contributedAmountMicros: "210000000",
            },
          ],
        }}
      />,
    );

    expect(screen.getByTestId("dashboard-breath-anonymous")).toHaveTextContent("Anonymous Patrons");
    expect(screen.getByTestId("contribution-intent-form")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-breath-history")).toHaveTextContent("2,006 USD");
    expect(screen.getByTestId("dashboard-breath-history")).toHaveTextContent("100%");
    expect(
      screen.getByRole("table", { name: /Your confirmed WAIA contributions/i }),
    ).toHaveTextContent("210 USD");
  });
});
