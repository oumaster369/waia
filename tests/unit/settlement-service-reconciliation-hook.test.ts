import { describe, expect, it, vi } from "vitest";

import { createSettlementService } from "@/lib/trader/settlement/settlement-service";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";

describe("settlement service reconciliation hook", () => {
  it("calls createCaseOnException for EXCEPTION outcomes only", async () => {
    const hook = vi.fn().mockResolvedValue(undefined);
    const settlement: SettlementRecordView = {
      id: "settlement-1",
      schemaVersion: "waia.trader.settlement.v1",
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
      outcome: "EXCEPTION",
      exceptionReason: "AMOUNT_MISMATCH",
      prevEventDigest: null,
      recordContentDigest: "digest",
      createdAt: new Date(),
    };

    const service = createSettlementService({
      settlementsRepository: {
        findByPaymentId: vi.fn().mockResolvedValue(null),
        insertSettlement: vi.fn().mockResolvedValue(settlement),
      },
      settlementApplicationsRepository: {
        insertApplication: vi.fn(),
        listBySettlementId: vi.fn(),
      },
      accountStatusRepository: {
        getProjection: vi.fn(),
        listEventsForAccount: vi.fn(),
        appendEventAndProjection: vi.fn(),
      },
      invoiceSettlementRepository: {
        listIssuedInvoicesForAccount: vi.fn().mockResolvedValue([]),
        getInvoiceForSettlementLock: vi.fn(),
        markInvoicePaid: vi.fn(),
      },
      writeAudit: vi.fn(() => "audit"),
      createCaseOnException: hook,
    });

    await service.applySettlementForPayment(
      { organizationId: "org-1" },
      {
        paymentId: "pay-1",
        organizationId: "org-1",
        subjectModule: "trader",
        settlementNetwork: "TRC-20",
        settlementAsset: "USDT",
        settlementAmount: "150.000000",
        settlementTxHash: "tx-1",
        transferIndex: 0,
        blockHeight: "100",
        paymentAddressId: null,
        exchangeAccountId: "acct-1",
        updatedAt: new Date(),
      },
    );

    expect(hook).toHaveBeenCalledOnce();
  });

  it("skips hook when settlement already exists (idempotent race)", async () => {
    const hook = vi.fn();
    const existing: SettlementRecordView = {
      id: "settlement-existing",
      schemaVersion: "waia.trader.settlement.v1",
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
      outcome: "EXCEPTION",
      exceptionReason: "AMOUNT_MISMATCH",
      prevEventDigest: null,
      recordContentDigest: "digest",
      createdAt: new Date(),
    };

    const service = createSettlementService({
      settlementsRepository: {
        findByPaymentId: vi.fn().mockResolvedValue(existing),
        insertSettlement: vi.fn(),
      },
      settlementApplicationsRepository: {
        insertApplication: vi.fn(),
        listBySettlementId: vi.fn(),
      },
      accountStatusRepository: {
        getProjection: vi.fn(),
        listEventsForAccount: vi.fn(),
        appendEventAndProjection: vi.fn(),
      },
      invoiceSettlementRepository: {
        listIssuedInvoicesForAccount: vi.fn(),
        getInvoiceForSettlementLock: vi.fn(),
        markInvoicePaid: vi.fn(),
      },
      writeAudit: vi.fn(() => "audit"),
      createCaseOnException: hook,
    });

    await service.applySettlementForPayment(
      { organizationId: "org-1" },
      {
        paymentId: "pay-1",
        organizationId: "org-1",
        subjectModule: "trader",
        settlementNetwork: "TRC-20",
        settlementAsset: "USDT",
        settlementAmount: "150.000000",
        settlementTxHash: "tx-1",
        transferIndex: 0,
        blockHeight: "100",
        paymentAddressId: null,
        exchangeAccountId: "acct-1",
        updatedAt: new Date(),
      },
    );

    expect(hook).not.toHaveBeenCalled();
  });
});
