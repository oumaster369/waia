import { describe, expect, it } from "vitest";

import {
  consecutiveFailedJobStreak,
  splitStaleAccounts,
} from "@/lib/trader/admin-console/attention";
import { riskStateMatchesLot } from "@/lib/trader/admin-console/attribution/trade-attribution";
import { rowIsBeforePageCursor } from "@/lib/trader/admin-console/cursor";
import {
  assembleAttributedLots,
  lotsForExchangeAccount,
  lotsRevisionFromLegs,
} from "@/lib/trader/admin-console/money/account-lots";
import {
  GUARDIAN_FRESH_AFTER_MS,
  latestGuardianByLot,
  presentOpenLot,
  type OpenLotInput,
} from "@/lib/trader/admin-console/read-models/positions";

const now = Date.parse("2026-09-23T12:00:00.000Z");

function lot(overrides: Partial<OpenLotInput> = {}): OpenLotInput {
  return {
    lotId: "lot-1",
    organizationId: "org-1",
    symbol: "BTCUSDT",
    accountKey: "paper-1",
    openQty: "1",
    remainingQty: "0.4",
    avgCost: "90",
    openedAt: "2026-09-23T10:00:00.000Z",
    exchangeAccountId: "acct-1",
    mode: "live",
    attribution: "attributed",
    openLotsInGroup: 2,
    guardian: {
      recommendation: "HOLD",
      openPositionSufficiency: "SUFFICIENT",
      newOpportunitySufficiency: "INSUFFICIENT",
      targetReductionBps: 0,
      assessedAt: "2026-09-23T11:50:00.000Z",
    },
    riskPosture: "CLOSE_ONLY",
    nowMs: now,
    ...overrides,
  };
}

describe("open positions", () => {
  it("keeps the newest guardian assessment per lot", () => {
    const latest = latestGuardianByLot([
      { lotId: "lot-1", assessmentId: "old", createdAt: "2026-09-23T11:00:00.000Z" },
      { lotId: "lot-1", assessmentId: "new", createdAt: "2026-09-23T11:40:00.000Z" },
      { lotId: "lot-2", assessmentId: "other", createdAt: "2026-09-23T11:10:00.000Z" },
    ]);
    expect(
      latestGuardianByLot([
        { lotId: "lot-1", assessmentId: "a", createdAt: "2026-09-23T11:00:00.000Z" },
        { lotId: "lot-1", assessmentId: "b", createdAt: "2026-09-23T11:00:00.000Z" },
      ]).get("lot-1")?.assessmentId,
    ).toBe("b");
    expect(latest.get("lot-1")?.assessmentId).toBe("new");
    expect(latest.get("lot-2")?.assessmentId).toBe("other");
  });

  it("shows a fresh assessment without treating a weak new entry as a missing position", () => {
    const view = presentOpenLot(lot());
    expect(view.guardian.state).toBe("ok");
    expect(view.guardian.openPositionSufficiency).toBe("SUFFICIENT");
    expect(view.guardian.newOpportunitySufficiency).toBe("INSUFFICIENT");
    expect(view.guardian.recommendation).toBe("HOLD");
    expect(view.riskPermission.posture).toBe("CLOSE_ONLY");
    expect(view.riskPermission.label).toBe("Только закрытие");
    expect(view.executedReduction.quantity).toBe("0.6");
    expect(view.remainingQty).toBe("0.4");
    expect(view.openLotsInGroup).toBe(2);
    expect(view.allocation).toBe("acct-1");
  });

  it("marks a missing or old guardian assessment stale and still separates risk from the fill", () => {
    const missing = presentOpenLot(
      lot({
        guardian: null,
        riskPosture: null,
        remainingQty: "1",
        attribution: "unattributed",
        exchangeAccountId: null,
      }),
    );
    expect(missing.guardian.state).toBe("stale");
    expect(missing.guardian.reasons).toContain("GUARDIAN_ASSESSMENT_MISSING");
    expect(missing.guardian.recommendation).toBeNull();
    expect(missing.riskPermission.reasons).toContain("RISK_ACCOUNT_UNMATCHED");
    expect(missing.executedReduction.quantity).toBe("0");
    expect(missing.allocation).toBe("Не распределено");

    const stale = presentOpenLot(
      lot({
        guardian: {
          recommendation: "REDUCE_FULL",
          openPositionSufficiency: "SUFFICIENT",
          newOpportunitySufficiency: "SUFFICIENT",
          targetReductionBps: 10000,
          assessedAt: new Date(now - GUARDIAN_FRESH_AFTER_MS - 1).toISOString(),
        },
        remainingQty: "1",
      }),
    );
    expect(stale.guardian.state).toBe("stale");
    expect(stale.guardian.recommendation).toBe("REDUCE_FULL");
    expect(stale.executedReduction.quantity).toBe("0");
    expect(stale.riskPermission.posture).toBe("CLOSE_ONLY");
  });

  it("keeps an assessment that is exactly 15 minutes old", () => {
    const view = presentOpenLot(
      lot({
        guardian: {
          recommendation: "HOLD",
          openPositionSufficiency: "SUFFICIENT",
          newOpportunitySufficiency: "SUFFICIENT",
          targetReductionBps: 0,
          assessedAt: new Date(now - GUARDIAN_FRESH_AFTER_MS).toISOString(),
        },
      }),
    );
    expect(view.guardian.state).toBe("ok");
  });

  it("does not invent a negative executed reduction", () => {
    const view = presentOpenLot(lot({ openQty: "1", remainingQty: "2" }));
    expect(view.executedReduction).toEqual({
      state: "unavailable",
      quantity: null,
      reasons: ["LOT_QTY_INCONSISTENT"],
    });
  });
});

describe("lots in valuation", () => {
  it("attaches only live lots of that exchange account and keeps text quantities", () => {
    const lots = assembleAttributedLots([
      {
        lotId: "lot-1",
        organizationId: "org-1",
        symbol: "BTCUSDT",
        remainingQty: "0.5",
        avgCost: "90",
        accountKey: "paper-1",
        legId: "leg-1",
        legCreatedAt: "2026-09-23T10:00:00.000Z",
        orderId: "order-1",
        strategySignalId: "signal-1",
        order: {
          id: "order-1",
          organizationId: "org-1",
          historicalRunId: null,
          executionMode: "live",
          credentialId: "cred-1",
          strategySignalId: "signal-1",
          symbol: "BTCUSDT",
        },
        credential: { id: "cred-1", organizationId: "org-1", exchangeAccountId: "acct-1" },
      },
      {
        lotId: "lot-2",
        organizationId: "org-1",
        symbol: "ETHUSDT",
        remainingQty: "2",
        avgCost: "10",
        accountKey: "paper-key",
        legId: "leg-2",
        legCreatedAt: "2026-09-23T11:00:00.000Z",
        orderId: "order-2",
        strategySignalId: "signal-2",
        order: {
          id: "order-2",
          organizationId: "org-1",
          historicalRunId: null,
          executionMode: "paper",
          credentialId: "cred-2",
          strategySignalId: "signal-2",
          symbol: "ETHUSDT",
        },
        credential: { id: "cred-2", organizationId: "org-1", exchangeAccountId: "acct-1" },
      },
    ]);
    const selected = lotsForExchangeAccount({
      exchangeAccountId: "acct-1",
      mode: "all",
      lots,
    });
    expect(selected.lots).toEqual([
      { asset: "BTC", remainingQty: "0.5", avgCost: "90", accountMatched: true },
    ]);
    expect(selected.lotsRevision).toBe(lotsRevisionFromLegs(["2026-09-23T10:00:00.000Z"]));
    expect(riskStateMatchesLot({ lotAccountKey: "paper-1", riskAccountId: "acct-1" })).toBe(false);
  });

  it("does not price a non-USDT lot as matched", () => {
    const selected = lotsForExchangeAccount({
      exchangeAccountId: "acct-1",
      mode: "live",
      lots: [
        {
          lotId: "lot-1",
          symbol: "BTCUSD",
          remainingQty: "1",
          avgCost: "1",
          exchangeAccountId: "acct-1",
          mode: "live",
          matched: true,
          legCreatedAts: ["2026-09-23T10:00:00.000Z", "2026-09-23T09:00:00.000Z"],
        },
      ],
    });
    expect(selected.lots[0]?.accountMatched).toBe(false);
    expect(selected.lotsRevision).toBe("2026-09-23T10:00:00.000Z:2");
  });
});

describe("attention facts and order cursor", () => {
  it("counts only the newest failed runs and splits stale accounts by activity", () => {
    expect(
      consecutiveFailedJobStreak([
        { jobKey: "paper_loop", startedAtMs: 3, status: "failed" },
        { jobKey: "paper_loop", startedAtMs: 2, status: "failed" },
        { jobKey: "paper_loop", startedAtMs: 1, status: "succeeded" },
        { jobKey: "settlement", startedAtMs: 4, status: "succeeded" },
        { jobKey: "settlement", startedAtMs: 3, status: "failed" },
      ]),
    ).toBe(2);
    expect(
      splitStaleAccounts([
        { exchangeAccountId: "a", stale: true, active: true },
        { exchangeAccountId: "b", stale: true, active: false },
        { exchangeAccountId: "c", stale: false, active: true },
      ]),
    ).toEqual({ active: ["a"], quiet: ["b"] });
  });

  it("pages strictly before the cursor", () => {
    const cursor = { t: "2026-09-23T12:00:00.000Z", id: "m" };
    expect(rowIsBeforePageCursor({ t: "2026-09-23T11:00:00.000Z", id: "z" }, cursor)).toBe(true);
    expect(rowIsBeforePageCursor({ t: "2026-09-23T12:00:00.000Z", id: "z" }, cursor)).toBe(false);
    expect(rowIsBeforePageCursor({ t: "2026-09-23T12:00:00.000Z", id: "a" }, cursor)).toBe(true);
    expect(rowIsBeforePageCursor({ t: "2026-09-23T12:00:00.000Z", id: "m" }, null)).toBe(true);
  });
});
