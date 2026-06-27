import { buildCaseOpenedEventPayload } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import {
  inlineEvidenceValue,
  RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";

import { backfillExceptionCases } from "@/lib/trader/settlement/reconciliation/backfill-exception-cases";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import type { ReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const SETTLEMENT = {
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

describe("backfillExceptionCases", () => {
  it("calls createCase for each orphan and is idempotent on second run", async () => {
    const openedCase = {
      id: "case-1",
      organizationId: "org-1",
      settlementId: SETTLEMENT.id,
      paymentId: SETTLEMENT.paymentId,
      exchangeAccountId: SETTLEMENT.exchangeAccountId,
      exceptionReason: SETTLEMENT.exceptionReason,
      status: "OPEN" as const,
      priority: 30,
      resolutionType: null,
      currentDecisionId: null,
      assignedTo: null,
      claimExpiresAt: null,
      coolingOffUntil: null,
      openedAt: new Date("2026-06-26T12:00:00.000Z"),
      resolvedAt: null,
      lastEventSeq: 1,
      lastEventDigest: "event-digest",
    };

    let hasCase = false;
    const caseRepository: ReconciliationCaseRepository = {
      findById: vi.fn().mockResolvedValue(null),
      findBySettlementId: vi.fn(async () => (hasCase ? openedCase : null)),
      openCase: vi.fn(async () => {
        hasCase = true;
        return {
          case: openedCase,
          event: {
            id: "event-1",
            schemaVersion: "waia.trader.settlement-reconciliation-event.v1" as const,
            organizationId: "org-1",
            caseId: openedCase.id,
            seq: 1,
            eventType: "CASE_OPENED",
            actorType: "service" as const,
            actorId: null,
            payload: buildCaseOpenedEventPayload({
              evidenceSnapshot: {
                schemaVersion: RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
                settlement: {
                  id: SETTLEMENT.id,
                  outcome: "EXCEPTION" as const,
                  exceptionReason: SETTLEMENT.exceptionReason,
                  valuedAmount: SETTLEMENT.valuedAmount,
                  valuationCurrency: SETTLEMENT.valuationCurrency,
                  settlementNetwork: SETTLEMENT.settlementNetwork,
                  settlementTxHash: SETTLEMENT.settlementTxHash,
                  onChainAmount: SETTLEMENT.onChainAmount,
                  asset: SETTLEMENT.asset,
                  exchangeAccountId: SETTLEMENT.exchangeAccountId,
                  paymentId: SETTLEMENT.paymentId,
                },
                payment: null,
                invoiceCandidates: inlineEvidenceValue([]),
                applications: inlineEvidenceValue([]),
              },
              exceptionReason: SETTLEMENT.exceptionReason,
              priority: 30,
            }),
            prevEventDigest: null,
            recordContentDigest: "event-digest",
            createdAt: openedCase.openedAt,
          },
        };
      }),
      appendEvent: vi.fn(),
      listEventsForCase: vi.fn(),
      listClaimExpired: vi.fn().mockResolvedValue([]),
    };

    const reader: Pick<ReconciliationReader, "listExceptionSettlementsWithoutCase"> = {
      listExceptionSettlementsWithoutCase: vi
        .fn()
        .mockResolvedValueOnce([SETTLEMENT])
        .mockResolvedValueOnce([]),
    };

    const deps = {
      caseRepository,
      evidenceReader: {
        buildEvidence: vi.fn().mockResolvedValue({
          schemaVersion: RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
          settlement: {
            id: SETTLEMENT.id,
            outcome: "EXCEPTION",
            exceptionReason: SETTLEMENT.exceptionReason,
            valuedAmount: SETTLEMENT.valuedAmount,
            valuationCurrency: SETTLEMENT.valuationCurrency,
            settlementNetwork: SETTLEMENT.settlementNetwork,
            settlementTxHash: SETTLEMENT.settlementTxHash,
            onChainAmount: SETTLEMENT.onChainAmount,
            asset: SETTLEMENT.asset,
            exchangeAccountId: SETTLEMENT.exchangeAccountId,
            paymentId: SETTLEMENT.paymentId,
          },
          payment: null,
          invoiceCandidates: inlineEvidenceValue([]),
          applications: inlineEvidenceValue([]),
        }),
      },
      writeAudit: vi.fn(() => "audit-1"),
      reader,
    };

    const context = requireOrgContext("org-1");
    const first = await backfillExceptionCases(deps, context);
    const second = await backfillExceptionCases(deps, context);

    expect(first).toEqual({ processed: 1, created: 1 });
    expect(second).toEqual({ processed: 0, created: 0 });
    expect(caseRepository.openCase).toHaveBeenCalledOnce();
  });
});
