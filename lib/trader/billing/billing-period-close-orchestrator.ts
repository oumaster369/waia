import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { DraftInvoiceService } from "@/lib/trader/billing/draft-invoice-service";
import {
  createPostgresDraftInvoiceService,
  createSqliteDraftInvoiceService,
} from "@/lib/trader/billing/draft-invoice-service";
import type { HwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import {
  createPostgresHwmLedgerService,
  createSqliteHwmLedgerService,
} from "@/lib/trader/billing/hwm-ledger-service";
import { DraftInvoiceNotBillableError } from "@/lib/trader/billing/invoice.errors";
import type { ReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import {
  createPostgresReportingPeriodLifecycleService,
  createSqliteReportingPeriodLifecycleService,
} from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { MAX_REPORTING_PERIODS_LIST_LIMIT } from "@/lib/trader/billing/reporting-period-repository.types";
import {
  admitCanonicalPeriodProfitFromReceiptV2,
  billingPeriodReportingScopeIdV2,
  BillingCanonicalProfitAdmissionError,
  refuseNakedRealizedPnl,
  type ClosedTradeSettlementV2,
  type RealizedStrategyProfitReceiptV2,
} from "@/lib/trader/billing/v2";
import { traderAuditActions } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type CloseAndMaterializeInput = {
  exchangeAccountId: string;
  periodStart: Date;
  periodEnd: Date;
  startingEquity: string;
  endingEquity: string;
  startingSnapshotAt: Date;
  endingSnapshotAt: Date;
  openPositionsSnapshotRef: string;
  valuationSource: string;
  realizedStrategyProfitReceipt: RealizedStrategyProfitReceiptV2;
  closedTradeSettlements: readonly ClosedTradeSettlementV2[];
  unrealizedPnl: string;
  netDeposits?: string;
  netWithdrawals?: string;
};

export type MaterializeDraftInput = {
  exchangeAccountId: string;
  periodId: string;
  computedAt?: Date;
};

export type BillingPeriodCloseResult = {
  reportingPeriodIdPrefix: string;
  invoiceIdPrefix: string | null;
  invoiceStatus: string | null;
  billable: boolean;
  realizedStrategyProfitReceiptDigestHex: string | null;
  auditActions: string[];
};

export type BillingPeriodCloseOrchestratorDeps = {
  reportingPeriodLifecycle: ReportingPeriodLifecycleService;
  hwmLedger: HwmLedgerService;
  draftInvoiceService: DraftInvoiceService;
};

function idPrefix(id: string): string {
  return id.slice(0, 8);
}

export function createBillingPeriodCloseOrchestrator(deps: BillingPeriodCloseOrchestratorDeps) {
  return {
    async closeAndMaterialize(
      context: OrgContext,
      input: CloseAndMaterializeInput,
    ): Promise<BillingPeriodCloseResult> {
      const scoped = requireOrgContext(context.organizationId);
      const auditActions: string[] = [];

      if (
        input.realizedStrategyProfitReceipt == null ||
        input.closedTradeSettlements == null ||
        Object.prototype.hasOwnProperty.call(input, "realizedPnl")
      ) {
        refuseNakedRealizedPnl();
      }

      const expectedReportingScopeId = billingPeriodReportingScopeIdV2({
        organizationId: scoped.organizationId,
        accountId: input.exchangeAccountId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      });

      const existingOpen = await deps.reportingPeriodLifecycle.findOpenPeriod(
        scoped,
        input.exchangeAccountId,
      );
      if (existingOpen && existingOpen.periodStart.getTime() !== input.periodStart.getTime()) {
        throw new BillingCanonicalProfitAdmissionError("PERIOD_START_MISMATCH");
      }

      const realizedPnl = admitCanonicalPeriodProfitFromReceiptV2({
        organizationId: scoped.organizationId,
        accountId: input.exchangeAccountId,
        receipt: input.realizedStrategyProfitReceipt,
        settlements: input.closedTradeSettlements,
        expectedReportingScopeId,
      });

      const existingClosed = await deps.reportingPeriodLifecycle.listClosedPeriods(scoped, {
        exchangeAccountId: input.exchangeAccountId,
        limit: MAX_REPORTING_PERIODS_LIST_LIMIT,
      });
      if (existingClosed.length >= MAX_REPORTING_PERIODS_LIST_LIMIT) {
        throw new BillingCanonicalProfitAdmissionError("BILLING_PERIOD_LIST_TRUNCATED");
      }
      const duplicateWindow = existingClosed.some(
        (period) => period.periodStart.getTime() === input.periodStart.getTime(),
      );
      if (duplicateWindow) {
        throw new BillingCanonicalProfitAdmissionError("DUPLICATE_BILLING_PERIOD_SCOPE");
      }

      const existingHwm = await deps.hwmLedger.getCurrentHwm(scoped, input.exchangeAccountId);
      if (!existingHwm) {
        await deps.hwmLedger.bootstrapHwm(scoped, {
          exchangeAccountId: input.exchangeAccountId,
          initialHwm: "0",
          valuationSource: input.valuationSource,
          effectiveAt: input.periodStart,
        });
        auditActions.push(traderAuditActions.hwmBootstrapped);
      }

      if (!existingOpen) {
        await deps.reportingPeriodLifecycle.openReportingPeriod(scoped, {
          exchangeAccountId: input.exchangeAccountId,
          periodStart: input.periodStart,
          startingEquity: input.startingEquity,
          openPositionsSnapshotRef: input.openPositionsSnapshotRef,
          valuationSource: input.valuationSource,
          startingSnapshotAt: input.startingSnapshotAt,
        });
        auditActions.push(traderAuditActions.reportingPeriodOpened);
      }

      const closed = await deps.reportingPeriodLifecycle.closeReportingPeriod(scoped, {
        exchangeAccountId: input.exchangeAccountId,
        periodEnd: input.periodEnd,
        endingEquity: input.endingEquity,
        endingSnapshotAt: input.endingSnapshotAt,
        realizedPnl,
        unrealizedPnl: input.unrealizedPnl,
        netDeposits: input.netDeposits,
        netWithdrawals: input.netWithdrawals,
      });
      auditActions.push(traderAuditActions.reportingPeriodClosed);

      const invoice = await deps.draftInvoiceService.getDraftInvoiceByPeriod(
        scoped,
        input.exchangeAccountId,
        closed.id,
      );

      if (invoice) {
        auditActions.push(traderAuditActions.invoiceDraftGenerated);
      }

      return {
        reportingPeriodIdPrefix: idPrefix(closed.id),
        invoiceIdPrefix: invoice ? idPrefix(invoice.id) : null,
        invoiceStatus: invoice?.status ?? null,
        billable: invoice?.billable ?? false,
        realizedStrategyProfitReceiptDigestHex:
          input.realizedStrategyProfitReceipt.contentDigestHex,
        auditActions,
      };
    },

    async materializeDraft(
      context: OrgContext,
      input: MaterializeDraftInput,
    ): Promise<BillingPeriodCloseResult> {
      const scoped = requireOrgContext(context.organizationId);
      const auditActions: string[] = [];

      const period = await deps.reportingPeriodLifecycle.getReportingPeriodById(
        scoped,
        input.periodId,
      );
      if (!period || period.status !== "CLOSED") {
        throw new Error(
          `[trader/billing] reporting period ${input.periodId} is not CLOSED or not found`,
        );
      }

      if (period.exchangeAccountId !== input.exchangeAccountId) {
        throw new Error(
          `[trader/billing] reporting period ${input.periodId} exchange account mismatch`,
        );
      }

      try {
        const invoice = await deps.draftInvoiceService.generateDraftInvoice(scoped, {
          periodId: input.periodId,
          computedAt: input.computedAt ?? period.periodEnd ?? new Date(),
          realizedFillFinality: false,
        });
        auditActions.push(traderAuditActions.invoiceDraftGenerated);

        return {
          reportingPeriodIdPrefix: idPrefix(period.id),
          invoiceIdPrefix: idPrefix(invoice.id),
          invoiceStatus: invoice.status,
          billable: invoice.billable,
          realizedStrategyProfitReceiptDigestHex: null,
          auditActions,
        };
      } catch (error) {
        if (error instanceof DraftInvoiceNotBillableError) {
          return {
            reportingPeriodIdPrefix: idPrefix(period.id),
            invoiceIdPrefix: null,
            invoiceStatus: null,
            billable: false,
            realizedStrategyProfitReceiptDigestHex: null,
            auditActions,
          };
        }
        throw error;
      }
    },
  };
}

export type BillingPeriodCloseOrchestrator = ReturnType<
  typeof createBillingPeriodCloseOrchestrator
>;

export function createSqliteBillingPeriodCloseOrchestrator(
  db: WaiaDb,
  deps: Partial<BillingPeriodCloseOrchestratorDeps> = {},
): BillingPeriodCloseOrchestrator {
  return createBillingPeriodCloseOrchestrator({
    reportingPeriodLifecycle:
      deps.reportingPeriodLifecycle ?? createSqliteReportingPeriodLifecycleService(db),
    hwmLedger: deps.hwmLedger ?? createSqliteHwmLedgerService(db),
    draftInvoiceService: deps.draftInvoiceService ?? createSqliteDraftInvoiceService(db),
  });
}

export function createPostgresBillingPeriodCloseOrchestrator(
  ex: Pick<WaiaPostgresDb, "select" | "insert" | "update">,
  deps: Partial<BillingPeriodCloseOrchestratorDeps> = {},
  db?: WaiaPostgresDb,
): BillingPeriodCloseOrchestrator {
  return createBillingPeriodCloseOrchestrator({
    reportingPeriodLifecycle:
      deps.reportingPeriodLifecycle ?? createPostgresReportingPeriodLifecycleService(ex, {}, db),
    hwmLedger: deps.hwmLedger ?? createPostgresHwmLedgerService(ex, {}, db),
    draftInvoiceService: deps.draftInvoiceService ?? createPostgresDraftInvoiceService(ex, {}, db),
  });
}
