import { describe, expect, it, vi } from "vitest";

import { createDraftInvoiceService } from "@/lib/trader/billing/draft-invoice-service";
import { createFeeComputationService } from "@/lib/trader/billing/fee-computation-service";
import { createBillingPeriodCloseOrchestrator } from "@/lib/trader/billing/billing-period-close-orchestrator";
import { createReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { foldCumulativeRealizedStrategyProfit } from "@/lib/trader/billing/fee-computation";
import {
  MAX_REPORTING_PERIODS_LIST_LIMIT,
  type ReportingPeriodRepository,
} from "@/lib/trader/billing/reporting-period-repository.types";
import { buildReportingPeriodRecordPayload } from "@/lib/trader/billing/serialize-reporting-period";
import { buildHwmLedgerRecordPayload } from "@/lib/trader/billing/serialize-hwm-ledger";
import {
  admitCanonicalPeriodProfitFromReceiptV2,
  billingPeriodReportingScopeIdV2,
} from "@/lib/trader/billing/v2";
import { billingV2PeriodCloseEvidence } from "@/tests/helpers/billing-v2-period-close-evidence";

const organizationId = "billing-history-proof-org";
const exchangeAccountId = "billing-history-proof-account";
const context = { organizationId };
const computedAt = new Date("2026-09-26T00:00:00.000Z");
const code = "BILLING_PERIOD_LIST_TRUNCATED";

function setupHistory(count: number, oldestProfit: string) {
  // Actual receipt/admission/period builders; only persistence is an in-memory port.
  // Every later period earns 1; a newest-first capped read can omit the oldest loss.
  const periods = Array.from({ length: count }, (_, index) => {
    const periodStart = new Date(Date.UTC(2025, 0, index + 1));
    const periodEnd = new Date(Date.UTC(2025, 0, index + 2));
    const evidence = billingV2PeriodCloseEvidence({
      organizationId,
      accountId: exchangeAccountId,
      periodStart,
      periodEnd,
      realizedPnl: index === 0 ? oldestProfit : "1",
    });
    const realizedPnl = admitCanonicalPeriodProfitFromReceiptV2({
      organizationId,
      accountId: exchangeAccountId,
      receipt: evidence.realizedStrategyProfitReceipt,
      settlements: evidence.closedTradeSettlements,
      expectedReportingScopeId: billingPeriodReportingScopeIdV2({
        organizationId,
        accountId: exchangeAccountId,
        periodStart,
        periodEnd,
      }),
    });
    return {
      ...buildReportingPeriodRecordPayload({
        organizationId,
        exchangeAccountId,
        periodStart,
        periodEnd,
        startingEquity: "10000",
        endingEquity: "10000",
        openPositionsSnapshotRef: `history-proof/${index}`,
        realizedPnl,
        unrealizedPnl: "0",
        netDeposits: "0",
        netWithdrawals: "0",
        valuationSource: "synthetic-proof-only",
        startingSnapshotAt: periodStart,
        endingSnapshotAt: periodEnd,
        status: "CLOSED",
      }),
      id: `period-${index}`,
      createdAt: computedAt,
      updatedAt: computedAt,
    };
  });
  const listClosedPeriods = vi.fn<ReportingPeriodRepository["listClosedPeriods"]>(
    (_scope, query = {}) => [...periods].reverse().slice(
      0,
      Math.min(query.limit ?? 50, MAX_REPORTING_PERIODS_LIST_LIMIT),
    ),
  );
  const repository: ReportingPeriodRepository = {
    getById: (_scope, id) => periods.find(period => period.id === id) ?? null,
    listClosedPeriods,
    findOpenPeriod: vi.fn(),
    insertOpenPeriod: vi.fn(),
    closePeriod: vi.fn(),
  };
  const hwm = {
    ...buildHwmLedgerRecordPayload({
      organizationId,
      exchangeAccountId,
      entryType: "BOOTSTRAP",
      highWaterMark: "0",
      previousHighWaterMark: null,
      sourcePeriodId: null,
      sourceInvoiceId: null,
      valuationSource: "synthetic-proof-only",
      effectiveAt: periods[0].periodStart,
      reason: null,
    }),
    id: "history-proof-hwm",
    createdAt: computedAt,
    updatedAt: computedAt,
  };
  const feeService = createFeeComputationService({
    reportingPeriodRepository: repository,
    hwmLedgerService: { getCurrentHwm: vi.fn().mockResolvedValue(hwm) },
  });
  const insertInvoice = vi.fn(async (_scope, { payload }) => ({
    ...payload,
    id: "history-proof-draft",
    createdAt: computedAt,
    updatedAt: computedAt,
  }));
  const findInvoice = vi.fn().mockResolvedValue(null);
  const writeAudit = vi.fn().mockReturnValue("history-proof-audit");
  const draftService = createDraftInvoiceService({
    reportingPeriodRepository: repository,
    feeComputationService: feeService,
    invoiceRepository: {
      insertInvoice,
      findByReportingPeriod: findInvoice,
      getById: vi.fn(),
      setIssuanceApprovalMetadata: vi.fn(),
      clearIssuanceApprovalMetadata: vi.fn(),
    },
    writeAudit,
  });
  return {
    periods,
    target: periods.at(-1)!,
    listClosedPeriods,
    feeService,
    draftService,
    insertInvoice,
    findInvoice,
    writeAudit,
    repository,
    hwm,
  };
}

function setupCloseBoundary(existingCount: number) {
  const proof = setupHistory(existingCount, "-100");
  const periodStart = proof.target.periodEnd!;
  const periodEnd = new Date(periodStart.getTime() + 86_400_000);
  const open = {
    ...buildReportingPeriodRecordPayload({
      organizationId,
      exchangeAccountId,
      periodStart,
      periodEnd: null,
      startingEquity: "10000",
      endingEquity: null,
      openPositionsSnapshotRef: "history-proof/pending",
      realizedPnl: null,
      unrealizedPnl: null,
      netDeposits: "0",
      netWithdrawals: "0",
      valuationSource: "synthetic-proof-only",
      startingSnapshotAt: periodStart,
      endingSnapshotAt: null,
      status: "OPEN",
    }),
    id: "pending-period",
    createdAt: computedAt,
    updatedAt: computedAt,
  };
  const closePeriod = vi.fn<ReportingPeriodRepository["closePeriod"]>((_scope, { payload }) => {
    const closed = { ...payload, id: open.id, createdAt: computedAt, updatedAt: computedAt };
    proof.periods.push(closed);
    return closed;
  });
  proof.repository.findOpenPeriod = vi.fn().mockResolvedValue(open);
  proof.repository.closePeriod = closePeriod;
  const writePeriodAudit = vi.fn().mockReturnValue("history-proof-period-audit");
  const lifecycle = createReportingPeriodLifecycleService({
    repository: proof.repository,
    writeAudit: writePeriodAudit,
    draftInvoiceService: proof.draftService,
  });
  const bootstrapHwm = vi.fn();
  const getCurrentHwm = vi.fn().mockResolvedValue(proof.hwm);
  const orchestrator = createBillingPeriodCloseOrchestrator({
    reportingPeriodLifecycle: lifecycle,
    hwmLedger: { getCurrentHwm, bootstrapHwm } as never,
    draftInvoiceService: proof.draftService,
  });
  const evidence = billingV2PeriodCloseEvidence({
    organizationId,
    accountId: exchangeAccountId,
    periodStart,
    periodEnd,
    realizedPnl: "1",
  });
  return { ...proof, lifecycle, orchestrator, evidence, open, closePeriod, writePeriodAudit, bootstrapHwm, getCurrentHwm };
}

describe("billing history completeness before fee and draft computation", () => {
  it.each([
    ["loss", "-1000", "-800"],
    ["profit", "1000", "1200"],
  ])("refuses an omitted older %s instead of computing a fee from the newest page", async (
    _label, oldestProfit, fullProfit,
  ) => {
    const proof = setupHistory(MAX_REPORTING_PERIODS_LIST_LIMIT + 1, oldestProfit);
    expect(foldCumulativeRealizedStrategyProfit(proof.periods)).toBe(fullProfit);
    await expect(proof.feeService.computeFeeForPeriod(context, {
      periodId: proof.target.id, computedAt,
    })).rejects.toMatchObject({ code });
    expect(proof.listClosedPeriods).toHaveBeenCalledWith(context, {
      exchangeAccountId, limit: MAX_REPORTING_PERIODS_LIST_LIMIT,
    });
  });

  it("refuses exactly capped history because the current port cannot prove exhaustion", async () => {
    const proof = setupHistory(MAX_REPORTING_PERIODS_LIST_LIMIT, "1");
    await expect(proof.feeService.computeFeeForPeriod(context, {
      periodId: proof.target.id, computedAt,
    })).rejects.toMatchObject({ code });
  });

  it.each([0, 100])("reports incomplete history for target index %i, whether inside or outside the page", async index => {
    const proof = setupHistory(MAX_REPORTING_PERIODS_LIST_LIMIT + 1, "-1000");
    await expect(proof.feeService.computeFeeForPeriod(context, {
      periodId: proof.periods[index].id, computedAt,
    })).rejects.toMatchObject({ code });
  });

  it("refuses a truncated receipt-to-draft chain before invoice reads, inserts or audit", async () => {
    const proof = setupHistory(MAX_REPORTING_PERIODS_LIST_LIMIT + 1, "-1000");
    await expect(proof.draftService.generateDraftInvoice(context, {
      periodId: proof.target.id, computedAt,
    })).rejects.toMatchObject({ code });
    expect(proof.findInvoice).not.toHaveBeenCalled();
    expect(proof.insertInvoice).not.toHaveBeenCalled();
    expect(proof.writeAudit).not.toHaveBeenCalled();
  });

  it("preserves valid history below the cap, loss recovery, decimal values and manual finality", async () => {
    const proof = setupHistory(MAX_REPORTING_PERIODS_LIST_LIMIT - 1, "-100");
    const fee = await proof.feeService.computeFeeForPeriod(context, {
      periodId: proof.target.id, computedAt,
    });
    expect(fee).toMatchObject({
      cumulativeRealizedStrategyProfit: "98",
      previousHighWaterMark: "0",
      performanceFee: "29.4",
      proposedNewHighWaterMark: "98",
      billable: true,
      realizedFillFinality: false,
    });
    const draft = await proof.draftService.generateDraftInvoice(context, {
      periodId: proof.target.id, computedAt,
    });
    expect(draft).toMatchObject({
      status: "DRAFT",
      cumulativeRealizedStrategyProfit: "98",
      performanceFee: "29.4",
      realizedFillFinality: false,
    });
    expect(proof.insertInvoice).toHaveBeenCalledOnce();
  });

  it("keeps unrecovered losses non-billable with complete history", async () => {
    const proof = setupHistory(3, "-100");
    await expect(proof.feeService.computeFeeForPeriod(context, {
      periodId: proof.target.id, computedAt,
    })).resolves.toMatchObject({
      cumulativeRealizedStrategyProfit: "-98",
      previousHighWaterMark: "0",
      performanceFee: "0",
      proposedNewHighWaterMark: "0",
      billable: false,
      realizedFillFinality: false,
    });
    await expect(proof.draftService.generateDraftInvoice(context, {
      periodId: proof.target.id, computedAt,
    })).rejects.toMatchObject({ code: "DRAFT_INVOICE_NOT_BILLABLE" });
    expect(proof.insertInvoice).not.toHaveBeenCalled();
  });

  it("refuses the 199-to-200 close-and-draft boundary before period, HWM or audit effects", async () => {
    const proof = setupCloseBoundary(MAX_REPORTING_PERIODS_LIST_LIMIT - 1);
    await expect(proof.orchestrator.closeAndMaterialize(context, {
      exchangeAccountId,
      periodEnd: proof.evidence.periodEnd,
      endingEquity: proof.evidence.endingEquity,
      endingSnapshotAt: proof.evidence.endingSnapshotAt,
      realizedStrategyProfitReceipt: proof.evidence.realizedStrategyProfitReceipt,
      closedTradeSettlements: proof.evidence.closedTradeSettlements,
      periodStart: proof.open.periodStart,
      startingEquity: proof.open.startingEquity,
      startingSnapshotAt: proof.open.startingSnapshotAt,
      openPositionsSnapshotRef: proof.open.openPositionsSnapshotRef,
      valuationSource: proof.open.valuationSource,
      unrealizedPnl: "0",
    })).rejects.toMatchObject({ code });
    expect(proof.closePeriod).not.toHaveBeenCalled();
    expect(proof.repository.insertOpenPeriod).not.toHaveBeenCalled();
    expect(proof.bootstrapHwm).not.toHaveBeenCalled();
    expect(proof.writePeriodAudit).not.toHaveBeenCalled();
    expect(proof.insertInvoice).not.toHaveBeenCalled();
    expect(proof.writeAudit).not.toHaveBeenCalled();
  });

  it("also refuses direct lifecycle close with a draft hook before committing the 200th period", async () => {
    const proof = setupCloseBoundary(MAX_REPORTING_PERIODS_LIST_LIMIT - 1);
    await expect(proof.lifecycle.closeReportingPeriod(context, proof.evidence))
      .rejects.toMatchObject({ code });
    expect(proof.closePeriod).not.toHaveBeenCalled();
    expect(proof.writePeriodAudit).not.toHaveBeenCalled();
    expect(proof.insertInvoice).not.toHaveBeenCalled();
    expect(proof.writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a new 200th period before reading or bootstrapping HWM and opening the period", async () => {
    const proof = setupCloseBoundary(MAX_REPORTING_PERIODS_LIST_LIMIT - 1);
    proof.repository.findOpenPeriod = vi.fn().mockResolvedValue(null);
    proof.getCurrentHwm.mockResolvedValue(null);
    await expect(proof.orchestrator.closeAndMaterialize(context, {
      exchangeAccountId,
      periodEnd: proof.evidence.periodEnd,
      endingEquity: proof.evidence.endingEquity,
      endingSnapshotAt: proof.evidence.endingSnapshotAt,
      realizedStrategyProfitReceipt: proof.evidence.realizedStrategyProfitReceipt,
      closedTradeSettlements: proof.evidence.closedTradeSettlements,
      periodStart: proof.open.periodStart,
      startingEquity: proof.open.startingEquity,
      startingSnapshotAt: proof.open.startingSnapshotAt,
      openPositionsSnapshotRef: proof.open.openPositionsSnapshotRef,
      valuationSource: proof.open.valuationSource,
      unrealizedPnl: "0",
    })).rejects.toMatchObject({ code });
    expect(proof.repository.findOpenPeriod).toHaveBeenCalledOnce();
    expect(proof.listClosedPeriods).toHaveBeenCalledOnce();
    expect(proof.getCurrentHwm).not.toHaveBeenCalled();
    expect(proof.bootstrapHwm).not.toHaveBeenCalled();
    expect(proof.repository.insertOpenPeriod).not.toHaveBeenCalled();
    expect(proof.closePeriod).not.toHaveBeenCalled();
    expect(proof.writePeriodAudit).not.toHaveBeenCalled();
    expect(proof.insertInvoice).not.toHaveBeenCalled();
    expect(proof.writeAudit).not.toHaveBeenCalled();
  });

  it("preserves the composed 198-to-199 period and draft chain", async () => {
    const proof = setupCloseBoundary(MAX_REPORTING_PERIODS_LIST_LIMIT - 2);
    const closed = await proof.lifecycle.closeReportingPeriod(context, proof.evidence);
    expect(closed.status).toBe("CLOSED");
    expect(proof.closePeriod).toHaveBeenCalledOnce();
    expect(proof.writePeriodAudit).toHaveBeenCalledOnce();
    expect(proof.insertInvoice).toHaveBeenCalledWith(context, {
      payload: expect.objectContaining({
        status: "DRAFT",
        cumulativeRealizedStrategyProfit: "98",
        performanceFee: "29.4",
        realizedFillFinality: false,
      }),
    });
  });

  it("does not add a fee capacity gate to lifecycle-only recording without a draft hook", async () => {
    const proof = setupCloseBoundary(MAX_REPORTING_PERIODS_LIST_LIMIT - 1);
    const lifecycleOnly = createReportingPeriodLifecycleService({
      repository: proof.repository,
      writeAudit: proof.writePeriodAudit,
    });
    await expect(lifecycleOnly.closeReportingPeriod(context, proof.evidence))
      .resolves.toMatchObject({ status: "CLOSED" });
    expect(proof.closePeriod).toHaveBeenCalledOnce();
    expect(proof.listClosedPeriods).not.toHaveBeenCalled();
    expect(proof.insertInvoice).not.toHaveBeenCalled();
  });
});
