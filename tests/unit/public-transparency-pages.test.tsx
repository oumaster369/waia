import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BudgetPage from "@/app/budget/page";
import WorkPlanPage from "@/app/work-plan/page";
import type { PublicWorkPlanProjection } from "@/lib/public-work-plan/types";
import type { PublicTreasuryProjection } from "@/lib/waia-core/treasury/public/types";

const { readTreasuryMock, readWorkPlanMock } = vi.hoisted(() => ({
  readTreasuryMock: vi.fn(),
  readWorkPlanMock: vi.fn(),
}));

vi.mock("@/lib/landing/public-data", () => ({
  readPublicTreasuryForView: readTreasuryMock,
  readPublicWorkPlanForView: readWorkPlanMock,
}));

const publishedTreasury: PublicTreasuryProjection = {
  schemaVersion: "waia-public-treasury/v1",
  breath: {
    status: "published",
    pendingReasons: [],
    availableAmountMicros: "42000000000",
    availableCurrency: "USD",
    runway: {
      status: "published",
      asOf: "2026-08-23T11:00:00.000Z",
      endsAt: "2026-09-23T11:00:00.000Z",
    },
    annualBudgetAmountMicros: "120000000000",
    annualBudgetCurrency: "USD",
    lastUpdatedAt: "2026-08-23T11:00:00.000Z",
  },
  budget: {
    status: "published",
    year: 2026,
    currency: "USD",
    annualBudgetAmountMicros: "120000000000",
    months: [
      {
        month: "2026-08",
        groups: [
          {
            groupName: "Development",
            currency: "USD",
            budgetMicros: "10000000000",
            spentMicros: "2500000000",
            remainingMicros: "7500000000",
          },
        ],
        categories: [
          {
            code: "DEVELOPMENT",
            name: "Development",
            groupName: "Development",
            currency: "USD",
            budgetMicros: "10000000000",
            spentMicros: "2500000000",
            remainingMicros: "7500000000",
          },
        ],
      },
    ],
  },
  transactions: [
    {
      occurredAt: "2026-08-23T10:30:00.000Z",
      amountMicros: "-2500000000",
      currency: "USD",
      categoryName: "Development",
      categoryGroup: "Development",
      projectName: "WAIA Core",
      description: "Published engineering expense",
    },
  ],
  fundingNeeds: [],
  patrons: {
    status: "pending",
    totalContributedAmountMicros: null,
    currency: null,
    patrons: [],
    privateSupport: null,
    lastUpdatedAt: null,
  },
};

const availableWorkPlan: PublicWorkPlanProjection = {
  schemaVersion: "waia-public-work-plan/v1",
  state: "stale",
  projects: [
    {
      name: "Breath of WAIA",
      statuses: [
        {
          status: { label: "In Progress", type: "started" },
          issues: [
            {
              identifier: "DEE-618",
              title: "Minimal Breath and public transparency pages",
              url: "https://linear.app/example/issue/DEE-618",
              status: { label: "In Progress", type: "started" },
              priorityLabel: "High",
              dueDate: "2026-08-31",
            },
          ],
        },
      ],
    },
  ],
  lastSuccessfulSyncAt: "2026-08-23T11:00:00.000Z",
};

describe("public transparency pages", () => {
  beforeEach(() => {
    readTreasuryMock.mockReset();
    readWorkPlanMock.mockReset();
  });

  it("renders the published annual, monthly, category, group, and transaction record", async () => {
    readTreasuryMock.mockResolvedValue(publishedTreasury);

    render(await BudgetPage());

    expect(screen.getByTestId("public-budget-summary")).toHaveTextContent("120,000 USD");
    expect(screen.getByTestId("public-budget-months")).toHaveTextContent("August 2026");
    expect(screen.getByRole("table", { name: /Budget groups for 2026-08/i })).toHaveTextContent(
      "7,500 USD",
    );
    expect(screen.getByRole("table", { name: /Budget categories for 2026-08/i })).toHaveTextContent(
      "Development",
    );
    expect(screen.getByRole("table", { name: /Published WAIA transactions/i })).toHaveTextContent(
      "−2,500 USD",
    );
    expect(screen.getByTestId("public-transactions")).toHaveTextContent(
      "Published engineering expense",
    );
    expect(document.querySelector("form, iframe, button")).toBeNull();
  });

  it("renders a stale allowlisted work plan without embedding Linear", async () => {
    readWorkPlanMock.mockResolvedValue(availableWorkPlan);

    render(await WorkPlanPage());

    expect(screen.getByTestId("public-work-plan-stale")).toHaveTextContent(
      /last successful public snapshot/i,
    );
    expect(screen.getByTestId("public-work-plan-projects")).toHaveTextContent("Breath of WAIA");
    expect(screen.getByRole("link", { name: /DEE-618/i })).toHaveAttribute(
      "href",
      "https://linear.app/example/issue/DEE-618",
    );
    expect(document.querySelector("form, iframe, button")).toBeNull();
  });
});
