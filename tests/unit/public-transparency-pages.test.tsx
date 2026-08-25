import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BudgetPage from "@/app/budget/page";
import PatronsPage from "@/app/patrons/page";
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
  funds: {
    status: "published",
    currency: "USD",
    allocationAsOf: "2026-08-23T11:00:00.000Z",
    canonicalFreeFundsMicros: "42000000000",
    protectedAnnualBudgetMicros: "120000000000",
    operatingAllocationMicros: "42000000000",
    developmentAllocationMicros: "0",
    policyCode: "ANNUAL_BUDGET_EXCESS_V1",
    policyVersion: 1,
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

  it("renders consented Patrons and one non-identifying private aggregate", async () => {
    readTreasuryMock.mockResolvedValue({
      ...publishedTreasury,
      patrons: {
        status: "published",
        totalContributedAmountMicros: "30000000",
        currency: "USD",
        patrons: [
          {
            displayName: "Alice",
            contributedAmountMicros: "20000000",
            currency: "USD",
            share: {
              numeratorMicros: "20000000",
              denominatorMicros: "30000000",
              partsPerMillion: "666666",
            },
          },
        ],
        privateSupport: {
          contributedAmountMicros: "10000000",
          currency: "USD",
          share: {
            numeratorMicros: "10000000",
            denominatorMicros: "30000000",
            partsPerMillion: "333333",
          },
        },
        lastUpdatedAt: "2026-08-23T11:00:00.000Z",
      },
    } satisfies PublicTreasuryProjection);

    render(await PatronsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Patrons" })).toBeInTheDocument();
    expect(screen.getByText("People who help keep WAIA alive.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Published WAIA patron contributions/i });
    expect(table).toHaveTextContent("Alice");
    expect(table).toHaveTextContent("20 USD");
    expect(table).toHaveTextContent("66.6666%");
    expect(table).toHaveTextContent("Private & anonymous support");
    expect(table).toHaveTextContent("10 USD");
    expect(table).toHaveTextContent("33.3333%");
    expect(screen.getByTestId("public-patrons-record")).toHaveTextContent(
      "Share shows financial participation only. It does not grant ownership, governance power or voting weight.",
    );
    expect(document.querySelector("form, iframe, button")).toBeNull();
  });

  it("keeps pending and unavailable Patron states distinct and private", async () => {
    readTreasuryMock.mockResolvedValue(publishedTreasury);
    const { unmount } = render(await PatronsPage());
    expect(screen.getByTestId("public-patrons-pending")).toHaveTextContent(/awaiting publication/i);
    expect(document.body).not.toHaveTextContent("Alice");
    unmount();

    readTreasuryMock.mockResolvedValue(null);
    render(await PatronsPage());
    expect(screen.getByTestId("public-patrons-unavailable")).toHaveTextContent(
      /cannot be loaded right now/i,
    );
    expect(document.querySelector("table, form, iframe, button")).toBeNull();
  });

  it("renders a truthful empty published Patron record", async () => {
    readTreasuryMock.mockResolvedValue({
      ...publishedTreasury,
      patrons: {
        status: "published",
        totalContributedAmountMicros: "0",
        currency: "USD",
        patrons: [],
        privateSupport: null,
        lastUpdatedAt: null,
      },
    } satisfies PublicTreasuryProjection);

    render(await PatronsPage());

    expect(screen.getByTestId("public-patrons-empty")).toHaveTextContent(
      /No confirmed contribution rows/i,
    );
    expect(screen.getByTestId("public-patrons-record")).toHaveTextContent(
      /Confirmed contributions: 0 USD/i,
    );
  });
});
