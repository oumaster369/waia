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
  realizedPnl: string;
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

      let openPeriod = await deps.reportingPeriodLifecycle.findOpenPeriod(
        scoped,
        input.exchangeAccountId,
      );
      if (!openPeriod) {
        openPeriod = await deps.reportingPeriodLifecycle.openReportingPeriod(scoped, {
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
        realizedPnl: input.realizedPnl,
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
          auditActions,
        };
      } catch (error) {
        if (error instanceof DraftInvoiceNotBillableError) {
          return {
            reportingPeriodIdPrefix: idPrefix(period.id),
            invoiceIdPrefix: null,
            invoiceStatus: null,
            billable: false,
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
