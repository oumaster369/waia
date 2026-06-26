import { describe, expect, it } from "vitest";

import { effectiveOutcome } from "@/lib/trader/settlement/reconciliation/effective-outcome";
import type { ReconciliationCaseView } from "@/lib/trader/settlement/reconciliation/reconciliation.types";

function baseCase(overrides: Partial<ReconciliationCaseView> = {}): ReconciliationCaseView {
  return {
    id: "case-1",
    organizationId: "org-1",
    settlementId: "settlement-1",
    paymentId: "payment-1",
    exchangeAccountId: "acct-1",
    exceptionReason: "AMOUNT_MISMATCH",
    status: "OPEN",
    priority: 10,
    resolutionType: null,
    currentDecisionId: null,
    assignedTo: null,
    claimExpiresAt: null,
    coolingOffUntil: null,
    openedAt: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: null,
    lastEventSeq: 1,
    lastEventDigest: "digest",
    ...overrides,
  };
}

describe("effectiveOutcome", () => {
  it("returns FINANCIALLY_APPLIED when application exists", () => {
    expect(
      effectiveOutcome({
        applications: [
          {
            id: "app-1",
            schemaVersion: "waia.trader.settlement-application.v1",
            settlementId: "settlement-1",
            organizationId: "org-1",
            invoiceId: "inv-1",
            appliedAmount: "100.00",
            invoiceStatusAfter: "PAID",
            recordContentDigest: "d",
            createdAt: new Date(),
          },
        ],
        case: baseCase({ status: "OPEN" }),
      }),
    ).toBe("FINANCIALLY_APPLIED");
  });

  it("returns CLOSED_WITHOUT_APPLICATION for resolved waive", () => {
    expect(
      effectiveOutcome({
        applications: [],
        case: baseCase({
          status: "RESOLVED",
          resolutionType: "WAIVE",
          resolvedAt: new Date(),
        }),
      }),
    ).toBe("CLOSED_WITHOUT_APPLICATION");
  });

  it("returns PENDING_RECONCILIATION for ESCALATED", () => {
    expect(
      effectiveOutcome({
        applications: [],
        case: baseCase({ status: "ESCALATED" }),
      }),
    ).toBe("PENDING_RECONCILIATION");
  });

  it("returns CLOSED_WITHOUT_APPLICATION for CLOSE_NO_ACTION resolution", () => {
    expect(
      effectiveOutcome({
        applications: [],
        case: baseCase({
          status: "RESOLVED",
          resolutionType: "CLOSE_NO_ACTION",
          resolvedAt: new Date(),
        }),
      }),
    ).toBe("CLOSED_WITHOUT_APPLICATION");
  });

  it("returns PENDING_RECONCILIATION for open case without application", () => {
    expect(
      effectiveOutcome({
        applications: [],
        case: baseCase({ status: "OPEN" }),
      }),
    ).toBe("PENDING_RECONCILIATION");
  });

  it("returns PENDING_RECONCILIATION for DECISION_PENDING", () => {
    expect(
      effectiveOutcome({
        applications: [],
        case: baseCase({ status: "DECISION_PENDING", resolutionType: "MANUAL_APPLY" }),
      }),
    ).toBe("PENDING_RECONCILIATION");
  });

  it("never produces CANCELLED outcome", () => {
    expect(
      effectiveOutcome({
        applications: [],
        case: baseCase({ status: "CANCELLED" }),
      }),
    ).not.toBe("CANCELLED");
    expect(
      effectiveOutcome({
        applications: [],
        case: baseCase({ status: "CANCELLED" }),
      }),
    ).toBe("PENDING_RECONCILIATION");
  });
});
