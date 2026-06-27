import { describe, expect, it, vi } from "vitest";

import { runReconciliationSweeper } from "@/lib/trader/settlement/reconciliation/run-reconciliation-sweeper";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

describe("runReconciliationSweeper", () => {
  it("expires claims without executing resolutions", async () => {
    const expiredCase = {
      id: "case-1",
      organizationId: "org-1",
      settlementId: "settlement-1",
      paymentId: "payment-1",
      exchangeAccountId: "acct-1",
      exceptionReason: "AMOUNT_MISMATCH",
      status: "ASSIGNED" as const,
      priority: 10,
      resolutionType: null,
      currentDecisionId: null,
      assignedTo: "operator-1",
      claimExpiresAt: new Date("2026-01-01T00:00:00Z"),
      coolingOffUntil: null,
      openedAt: new Date("2026-01-01T00:00:00Z"),
      resolvedAt: null,
      lastEventSeq: 2,
      lastEventDigest: "digest-2",
    };

    const appendEvent = vi.fn().mockResolvedValue({
      case: { ...expiredCase, status: "OPEN", assignedTo: null, claimExpiresAt: null },
      event: { id: "evt-3" },
    });

    const caseRepository: ReconciliationCaseRepository = {
      findById: vi.fn(),
      findBySettlementId: vi.fn(),
      openCase: vi.fn(),
      appendEvent,
      listEventsForCase: vi.fn().mockResolvedValue([]),
      listClaimExpired: vi.fn().mockResolvedValue([expiredCase]),
    };

    const writeAudit = vi.fn();
    const report = await runReconciliationSweeper(
      { caseRepository, writeAudit, now: () => new Date("2026-01-02T00:00:00Z") },
      requireOrgContext("org-1"),
    );

    expect(report.expired).toBe(1);
    expect(appendEvent).toHaveBeenCalledOnce();
    expect(writeAudit).toHaveBeenCalledOnce();
  });

  it("is idempotent when claim-expired already recorded", async () => {
    const expiredCase = {
      id: "case-2",
      organizationId: "org-1",
      settlementId: "settlement-2",
      paymentId: "payment-2",
      exchangeAccountId: "acct-1",
      exceptionReason: "AMOUNT_MISMATCH",
      status: "ASSIGNED" as const,
      priority: 10,
      resolutionType: null,
      currentDecisionId: null,
      assignedTo: "operator-1",
      claimExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
      coolingOffUntil: null,
      openedAt: new Date("2026-01-01T00:00:00Z"),
      resolvedAt: null,
      lastEventSeq: 2,
      lastEventDigest: "digest-2",
    };

    const appendEvent = vi.fn();
    const caseRepository: ReconciliationCaseRepository = {
      findById: vi.fn(),
      findBySettlementId: vi.fn(),
      openCase: vi.fn(),
      appendEvent,
      listEventsForCase: vi.fn().mockResolvedValue([
        {
          id: "evt-prior",
          payload: {
            idempotencyKey: "claim-expired:case-2:2026-01-01T00:00:00.000Z",
          },
        },
      ]),
      listClaimExpired: vi.fn().mockResolvedValue([expiredCase]),
    };

    const report = await runReconciliationSweeper(
      {
        caseRepository,
        writeAudit: vi.fn(),
        now: () => new Date("2026-01-02T00:00:00Z"),
      },
      requireOrgContext("org-1"),
    );

    expect(report.expired).toBe(0);
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
