import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OverviewPanel,
  overviewFromEnvelope,
} from "@/components/trader/admin-console/sections/overview/overview-panel";
import { OverviewFuturesSummaryView } from "@/components/trader/admin-console/sections/overview/overview-futures-summary-view";

const overviewTestState = vi.hoisted(() => ({
  params: new URLSearchParams(),
  read: { loading: false, envelope: null, reason: "POSTGRES_REQUIRED" as string | null },
}));

vi.mock("@/components/trader/admin-console/data/read-context", () => ({
  useAdminReadContext: () => ({ params: overviewTestState.params }),
}));
vi.mock("@/components/trader/admin-console/data/use-admin-read", () => ({
  useAdminRead: () => overviewTestState.read,
}));
import { OverviewLoader } from "@/components/trader/admin-console/sections/overview/overview-loader";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  overviewTestState.params = new URLSearchParams();
  overviewTestState.read = { loading: false, envelope: null, reason: "POSTGRES_REQUIRED" };
});

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
    expect(screen.getByTestId("overview-Капитал спота")).toHaveTextContent("10");
    expect(screen.getByTestId("overview-Капитал спота")).not.toHaveTextContent("4");
    expect(screen.getByTestId("overview-last-known")).toHaveTextContent("4");
    expect(screen.getByText("acc-2")).toBeInTheDocument();
    expect(screen.getByText(/Нет котировки · BTC/).closest("[data-reason]")).toHaveAttribute(
      "data-reason",
      "NO_QUOTE:BTC",
    );
    expect(screen.getByTestId("overview-Результат спота")).toHaveTextContent("—");
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

  it("shows readable exclusion reasons and preserves exact large and small USD values", () => {
    render(
      <OverviewFuturesSummaryView
        summary={{
          state: "partial",
          currency: "USD",
          equityUsd: "12345678901234567890.123456789012",
          availableMarginUsd: "0.000000000001",
          profitUnrealUsd: "-0.00000000000012",
          included: 1,
          total: 3,
          oldestReadCompletedAtMs: null,
          excluded: [
            { exchangeAccountId: "account-a", reason: "DIRECTORY_STALE" },
            { exchangeAccountId: "account-b", reason: "DUPLICATE_IDENTITY" },
          ],
        }}
      />,
    );

    const compactText = (label: string) =>
      screen.getByText(label).parentElement?.textContent?.replaceAll(/\s/g, "");
    expect(compactText("Капитал фьючерсов")).toContain("12345678901234567890,123456789012");
    expect(compactText("Доступная маржа фьючерсов")).toContain("0,000000000001");
    expect(compactText("Нереализованный результат фьючерсов")).toContain("−0,00000000000012");
    expect(
      screen.getByText("Счёт account-a: Список счетов не удалось обновить"),
    ).toBeInTheDocument();
    expect(screen.getByText("Счёт account-b: Счет совпадает с другой записью")).toBeInTheDocument();
    expect(screen.queryByText("DIRECTORY_STALE")).not.toBeInTheDocument();
    expect(screen.queryByText("DUPLICATE_IDENTITY")).not.toBeInTheDocument();
  });

  it.each([
    ["paper", "mode=paper"],
    ["history", "mode=history"],
    ["an account without its organization", "exchange_account_id=73750148"],
    ["a malformed organization UUID", "mode=live&organization_id=not-a-uuid"],
    [
      "an overlong account ID",
      `mode=live&organization_id=11111111-1111-4111-8111-111111111111&exchange_account_id=${"a".repeat(257)}`,
    ],
    [
      "a whitespace-only account ID",
      "mode=live&organization_id=11111111-1111-4111-8111-111111111111&exchange_account_id=%20%20",
    ],
    [
      "an untrimmed account ID",
      "mode=live&organization_id=11111111-1111-4111-8111-111111111111&exchange_account_id=%20account-a",
    ],
    [
      "duplicate organization parameters",
      "mode=live&organization_id=11111111-1111-4111-8111-111111111111&organization_id=11111111-1111-4111-8111-111111111111",
    ],
    [
      "duplicate account parameters",
      "mode=live&organization_id=11111111-1111-4111-8111-111111111111&exchange_account_id=account-a&exchange_account_id=account-a",
    ],
  ])("does not request live observations for %s", async (_label, query) => {
    overviewTestState.params = new URLSearchParams(query);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<OverviewLoader />);
    await waitFor(() => expect(screen.getByText("Фьючерсы")).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mounts the Futures observation view when the Spot overview is unavailable", async () => {
    overviewTestState.params = new URLSearchParams(
      "mode=live&organization_id=11111111-1111-4111-8111-111111111111&exchange_account_id=account-a",
    );
    const fetchSpy = vi.fn(async () => Response.json({ accounts: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<OverviewLoader />);
    await waitFor(() => expect(screen.getByText("Фьючерсы")).toBeInTheDocument());
    expect(screen.getByText(/Нужен Postgres/)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/trader/admin/connected-accounts",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });
});
