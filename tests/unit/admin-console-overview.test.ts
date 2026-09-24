import { describe, expect, it } from "vitest";

import { accountMode } from "@/lib/trader/admin-console/accounts/account-mode";
import { dedupeAccounts, firstConnectedAt } from "@/lib/trader/admin-console/accounts/dedupe";
import { buildAttention } from "@/lib/trader/admin-console/attention";
import { buildOverview } from "@/lib/trader/admin-console/read-models/overview";
import {
  buildOrderTrace,
  ORDER_STATUS_LABELS,
} from "@/lib/trader/admin-console/read-models/order-trace";

const emptyAttention = {
  reconciliationRequiredOrderIds: [],
  sentWithoutReportOrderIds: [],
  runtimeHalted: false,
  killed: false,
  lotsMissingGuardian: [],
  divergentAccountIds: [],
  openReconciliationCaseIds: [],
  staleActiveAccountIds: [],
  failedJobStreak: 0,
  recentFatalIncidents: 0,
  ownershipConflicts: [],
  overdueInvoiceIds: [],
  settlementExceptions: [],
  blockedPeriodIds: [],
  staleQuietAccountIds: [],
  promotionProposalIds: [],
  noTradeCount: 4,
};

describe("account dedupe, mode, attention, overview, and order trace", () => {
  it("collapses credentials and excludes an ownership conflict from sums", () => {
    const rows = dedupeAccounts([
      {
        credentialId: "a",
        organizationId: "org-1",
        venue: "htx",
        exchangeAccountId: "acct",
        ownerEmail: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        credentialId: "b",
        organizationId: "org-1",
        venue: "htx",
        exchangeAccountId: "acct",
        ownerEmail: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      },
      {
        credentialId: "c",
        organizationId: "org-2",
        venue: "htx",
        exchangeAccountId: "shared",
        ownerEmail: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        credentialId: "d",
        organizationId: "org-3",
        venue: "htx",
        exchangeAccountId: "shared",
        ownerEmail: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(rows.find((row) => row.exchangeAccountId === "acct")?.credentialsCount).toBe(2);
    expect(rows.find((row) => row.exchangeAccountId === "shared")?.conflict).toBe(true);
  });

  it("keeps a live portfolio when new entries are close-only and separates paper", () => {
    const live = accountMode({
      kind: "exchange",
      liveEnable: "ENABLED",
      posture: "CLOSE_ONLY",
      suspended: false,
      killSwitchActive: false,
      liveOrderCount: 2,
      paperOrderCount: 5,
    });
    expect(live.portfolio).toBe("live");
    expect(live.activity).toBe("live");
    expect(live.tradePermission).toBe("close_only");
    expect(
      accountMode({
        kind: "paper",
        liveEnable: null,
        posture: null,
        suspended: false,
        killSwitchActive: false,
        liveOrderCount: 0,
        paperOrderCount: 1,
      }).portfolio,
    ).toBe("paper");
  });

  it("uses the earliest observation as first connected", () => {
    expect(firstConnectedAt(["2026-03-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"])).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(firstConnectedAt([])).toBeNull();
  });

  it("orders attention and ignores no-trade", () => {
    const items = buildAttention({
      ...emptyAttention,
      promotionProposalIds: ["p1"],
      ownershipConflicts: ["acct"],
      reconciliationRequiredOrderIds: ["order-1"],
    });
    expect(items.map((item) => item.severity)).toEqual(["critical", "high", "low"]);
    expect(items.some((item) => item.reason === "NO_TRADE")).toBe(false);
  });

  it("sums only current included rows and reports coverage", () => {
    const accounts = Array.from({ length: 10 }, (_, index) => ({
      id: `a${index}`,
      valuationKey: "k",
      included: index < 8,
      reason: index < 8 ? null : "STALE",
      stale: index >= 7,
      equity: "10",
      freeQuote: "4",
      lockedQuote: "1",
      holdingsValue: "5",
      traderPnl: "2",
    }));
    const overview = buildOverview(accounts, {
      currency: "USDT",
      method: "htx_spot_last:usdt",
      periodBounds: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-23T00:00:00.000Z" },
      mode: "live",
    });
    expect(overview.coverageLabel).toBe("По 7 актуальным счетам из 10");
    expect(overview.finance.equity.value?.amount).toBe("70");
    expect(overview.lastKnownEstimate).toBe("30");
    const rowSum = "70";
    expect(overview.finance.equity.value?.amount).toBe(rowSum);
  });

  it("traces a legacy order as not applicable and counts three fills as one order", () => {
    expect(ORDER_STATUS_LABELS.ACCEPTED).toBe("Биржа приняла");
    expect(ORDER_STATUS_LABELS.FILLED).toBe("Исполнено");
    expect(ORDER_STATUS_LABELS.RECONCILIATION_REQUIRED).toBe("Требует сверки");
    const legacy = buildOrderTrace({
      orderId: "order-1",
      executionAttemptId: null,
      attempt: null,
      plan: null,
      allowance: null,
      verdict: null,
      decision: null,
      forecast: null,
      reports: [],
      events: [],
      fills: [
        { id: "f1", at: "t" },
        { id: "f2", at: "t" },
        { id: "f3", at: "t" },
      ],
    });
    expect(legacy.steps[0]?.reason).toBe("LEGACY_ORDER_NO_V2_BINDING");
    expect(legacy.fillCount).toBe(3);
    expect(legacy.allowedActions).toEqual([]);
  });
});
