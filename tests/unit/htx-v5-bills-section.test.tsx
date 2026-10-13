import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HtxV5BillsSection } from "@/components/trader/account-observation/htx-v5-bills-section";
import type { HtxV5BillsObservation } from "@/lib/trader/account-observation/types";

const now = 1_800_000_000_000;
const base: HtxV5BillsObservation = {
  status: "PARTIAL",
  unavailableReason: null,
  scopeId: "bills-scope",
  windowStartMs: now - 60_000,
  windowEndMs: now,
  validFromMs: now - 10_000,
  validUntilMs: now + 10_000,
  windowConvention: "START_INCLUSIVE_END_EXCLUSIVE",
  values: [],
  groups: [],
  readStartedAtMs: now - 1_000,
  responseReceivedAtMs: now - 500,
  readCompletedAtMs: now,
  responseGeneratedAtMs: now - 500,
  error: null,
  pageScope: {
    pageSize: 100,
    maxPages: 1,
    pagesRead: 1,
    nextFrom: null,
    completeness: "UNKNOWN",
  },
  completeness: "UNKNOWN",
  amountSemantics: "RAW_SIGNED_AMOUNTS_NO_SIGN_CONVERSION",
  accountBinding: "NOT_ESTABLISHED_BY_BILLS_RESPONSE",
  netPnl: null,
  dailyPnl: null,
};

function renderSection(
  observation: HtxV5BillsObservation | null,
  inheritedStale = false,
  currentTime = now,
) {
  return render(
    <HtxV5BillsSection
      observation={observation}
      inheritedStale={inheritedStale}
      nowMs={currentTime}
    />,
  );
}

describe("HtxV5BillsSection", () => {
  it("shows a bounded UTC window and separate currencies with raw unknown types and exact received sums", () => {
    renderSection({
      ...base,
      values: [
        { id: "a", contractCode: "BTC-USDT", marginMode: "cross", currency: "USDT", type: "30", category: "FUNDING_INCOME", amount: "-0.000000000000000007", createdTimeMs: now - 1_000 },
        { id: "b", contractCode: "", marginMode: "cross", currency: "USD", type: "987654", category: "UNKNOWN", amount: "1.25", createdTimeMs: now - 900 },
      ],
      groups: [
        { currency: "USDT", type: "30", category: "FUNDING_INCOME", observedAmountSum: "-0.000000000000000007", recordCount: 1 },
        { currency: "USD", type: "987654", category: "UNKNOWN", observedAmountSum: "1.25", recordCount: 1 },
      ],
    });

    expect(screen.getByText(/partial data · completeness unknown/i)).toBeInTheDocument();
    expect(screen.getByText(/\[.* UTC, .* UTC\)/)).toBeInTheDocument();
    expect(screen.getByText(/2027-01-15 08:00:00\.000 UTC/i)).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("30")).toBeInTheDocument();
    expect(within(table).getByText("987654")).toBeInTheDocument();
    expect(within(table).getByText("USDT")).toBeInTheDocument();
    expect(within(table).getByText("USD")).toBeInTheDocument();
    expect(within(table).getByText("-0.000000000000000007 USDT")).toBeInTheDocument();
    expect(within(table).getByText("1.25 USD")).toBeInTheDocument();
    expect(screen.getByText(/not complete history, a daily result/i)).toBeInTheDocument();
    expect(screen.queryByText(/daily profit|total PnL|net result/i)).not.toBeInTheDocument();
  });

  it("explains that an empty successful bounded query is not zero fees or PnL", () => {
    renderSection(base);
    expect(screen.getByText(/No records were received in this bounded request/i)).toBeInTheDocument();
    expect(screen.getByText(/does not mean zero fees, payments or profit/i)).toBeInTheDocument();
    expect(screen.getByText(/Received records \/ pages/i)).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
  });

  it("shows an error without substituting numeric values", () => {
    renderSection({ ...base, status: "ERROR", error: "READ_FAILED", values: null, groups: null, pageScope: null });
    expect(screen.getByRole("alert")).toHaveTextContent("Financial records could not be read.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 ₽|0 USD|0 USDT|0\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/records \/ pages/i)).not.toBeInTheDocument();
  });

  it.each([
    ["SCOPE_EXPIRED", /authorized financial records read window.*expired/i],
    ["SCOPE_NOT_YET_VALID", /not started yet/i],
  ] as const)("explains optional-scope unavailability: %s", (reason, copy) => {
    renderSection({
      ...base,
      status: "UNAVAILABLE",
      unavailableReason: reason,
      values: null,
      groups: null,
      readStartedAtMs: null,
      responseReceivedAtMs: null,
      readCompletedAtMs: null,
      responseGeneratedAtMs: null,
      error: null,
      pageScope: null,
    });
    expect(screen.getByRole("status")).toHaveTextContent(copy);
    expect(screen.getByText(/Balance updates continue/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/records \/ pages/i)).not.toBeInTheDocument();
  });

  it("labels inherited and age-based observations stale without claiming currentness", () => {
    const staleAt = now - 700_000;
    renderSection({ ...base, readCompletedAtMs: staleAt }, false, now);
    expect(screen.getByRole("status")).toHaveTextContent(/stale and its freshness is not confirmed/i);
    expect(screen.queryByText(/^current$/i)).not.toBeInTheDocument();
  });

  it("marks absent configuration as not enabled", () => {
    renderSection(null);
    expect(screen.getByText("not configured")).toBeInTheDocument();
    expect(screen.getByText("Financial records reading is not configured.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
