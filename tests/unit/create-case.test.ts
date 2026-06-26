import { describe, expect, it, vi } from "vitest";

import { createCase } from "@/lib/trader/settlement/reconciliation/create-case";
import { RECONCILIATION_EVENT_CASE_OPENED } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import { ReconciliationInvalidSettlementOutcomeError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import type { ReconciliationEvidenceReader } from "@/lib/trader/settlement/reconciliation/reconciliation-evidence.types";
import { traderAuditActions } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const EXCEPTION_SETTLEMENT = {
  id: "settlement-1",
  schemaVersion: "waia.trader.settlement.v1" as const,
  organizationId: "org-1",
  exchangeAccountId: "acct-1",
  paymentId: "pay-1",
  settlementNetwork: "TRC-20",
  settlementTxHash: "tx-1",
  transferIndex: 0,
  blockHeight: "100",
  asset: "USDT",
  onChainAmount: "150.000000",
  valuedAmount: "150.000000",
  valuationCurrency: "USD",
  valuationBasis: "stablecoin_par",
  outcome: "EXCEPTION" as const,
  exceptionReason: "AMOUNT_MISMATCH",
  prevEventDigest: null,
  recordContentDigest: "digest-settlement",
  createdAt: new Date("2026-06-26T12:00:00.000Z"),
};

const EVIDENCE = {
  settlement: {
    id: EXCEPTION_SETTLEMENT.id,
    outcome: EXCEPTION_SETTLEMENT.outcome,
    exceptionReason: EXCEPTION_SETTLEMENT.exceptionReason,
    valuedAmount: EXCEPTION_SETTLEMENT.valuedAmount,
    valuationCurrency: EXCEPTION_SETTLEMENT.valuationCurrency,
    settlementNetwork: EXCEPTION_SETTLEMENT.settlementNetwork,
    settlementTxHash: EXCEPTION_SETTLEMENT.settlementTxHash,
    onChainAmount: EXCEPTION_SETTLEMENT.onChainAmount,
    asset: EXCEPTION_SETTLEMENT.asset,
    exchangeAccountId: EXCEPTION_SETTLEMENT.exchangeAccountId,
    paymentId: EXCEPTION_SETTLEMENT.paymentId,
  },
  payment: null,
  invoiceCandidates: [],
  applications: [],
};

describe("createCase", () => {
  it("opens case + CASE_OPENED event and writes audit", async () => {
    const openedCase = {
      id: "case-1",
      organizationId: "org-1",
      settlementId: EXCEPTION_SETTLEMENT.id,
      paymentId: EXCEPTION_SETTLEMENT.paymentId,
      exchangeAccountId: EXCEPTION_SETTLEMENT.exchangeAccountId,
      exceptionReason: EXCEPTION_SETTLEMENT.exceptionReason,
      status: "OPEN" as const,
      priority: 30,
      resolutionType: null,
      assignedTo: null,
      claimExpiresAt: null,
      coolingOffUntil: null,
      openedAt: new Date("2026-06-26T12:00:00.000Z"),
      resolvedAt: null,
      lastEventSeq: 1,
      lastEventDigest: "event-digest",
    };

    const caseRepository: ReconciliationCaseRepository = {
      findBySettlementId: vi.fn().mockResolvedValue(null),
      openCase: vi.fn().mockResolvedValue({
        case: openedCase,
        event: {
          id: "event-1",
          schemaVersion: "waia.trader.settlement-reconciliation-event.v1",
          organizationId: "org-1",
          caseId: "case-1",
          seq: 1,
          eventType: RECONCILIATION_EVENT_CASE_OPENED,
          actorType: "service",
          actorId: null,
          payload: EVIDENCE,
          prevEventDigest: null,
          recordContentDigest: "event-digest",
          createdAt: openedCase.openedAt,
        },
      }),
      listEventsForCase: vi.fn(),
    };
    const evidenceReader: ReconciliationEvidenceReader = {
      buildEvidence: vi.fn().mockResolvedValue(EVIDENCE),
    };
    const writeAudit = vi.fn(() => "audit-1");

    const result = await createCase(
      { caseRepository, evidenceReader, writeAudit, now: () => openedCase.openedAt },
      requireOrgContext("org-1"),
      { settlement: EXCEPTION_SETTLEMENT },
    );

    expect(result.id).toBe("case-1");
    expect(caseRepository.openCase).toHaveBeenCalledOnce();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: traderAuditActions.settlementReconciliationCaseOpened,
      }),
    );
  });

  it("returns existing case idempotently", async () => {
    const existing = {
      id: "case-existing",
      organizationId: "org-1",
      settlementId: EXCEPTION_SETTLEMENT.id,
      paymentId: EXCEPTION_SETTLEMENT.paymentId,
      exchangeAccountId: EXCEPTION_SETTLEMENT.exchangeAccountId,
      exceptionReason: EXCEPTION_SETTLEMENT.exceptionReason,
      status: "OPEN" as const,
      priority: 30,
      resolutionType: null,
      assignedTo: null,
      claimExpiresAt: null,
      coolingOffUntil: null,
      openedAt: new Date("2026-06-26T12:00:00.000Z"),
      resolvedAt: null,
      lastEventSeq: 1,
      lastEventDigest: "event-digest",
    };
    const caseRepository: ReconciliationCaseRepository = {
      findBySettlementId: vi.fn().mockResolvedValue(existing),
      openCase: vi.fn(),
      listEventsForCase: vi.fn(),
    };

    const result = await createCase(
      {
        caseRepository,
        evidenceReader: { buildEvidence: vi.fn() },
        writeAudit: vi.fn(),
      },
      requireOrgContext("org-1"),
      { settlement: EXCEPTION_SETTLEMENT },
    );

    expect(result).toBe(existing);
    expect(caseRepository.openCase).not.toHaveBeenCalled();
  });

  it("rejects non-EXCEPTION settlements", async () => {
    await expect(
      createCase(
        {
          caseRepository: {
            findBySettlementId: vi.fn(),
            openCase: vi.fn(),
            listEventsForCase: vi.fn(),
          },
          evidenceReader: { buildEvidence: vi.fn() },
          writeAudit: vi.fn(),
        },
        requireOrgContext("org-1"),
        {
          settlement: { ...EXCEPTION_SETTLEMENT, outcome: "APPLIED" },
        },
      ),
    ).rejects.toThrow(ReconciliationInvalidSettlementOutcomeError);
  });
});
