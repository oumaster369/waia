import { requireServiceOrgContext } from "@/lib/trader/security/service-org-context";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { createPostgresReportingPeriodRepository } from "./repository-adapters";
import { runPostgresBillingRealityCommand, type PostgresBillingCloseOptions } from "./v2/reality-dependencies-postgres-v1";
import { refuseBillingReality, snapshotBillingCommand, type BillingRealityDependenciesV1, type BillingRealityDependenciesMatched } from "./v2/reality-dependencies-v1";
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
  createReportingPeriodLifecycleService,
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
import { assertOrgMembershipPostgres, assertOrgMembershipSqlite, type OrgContext } from "@/lib/waia-core/scope/org-context";

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
  realityDependencies?: BillingRealityDependenciesV1;
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
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
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
      const scoped = await requireServiceOrgContext(context, deps.assertMembership);
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
      // Include the period about to close: its automatic draft must have complete history.
      if (existingClosed.length + 1 >= MAX_REPORTING_PERIODS_LIST_LIMIT) {
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
        realizedStrategyProfitReceipt: input.realizedStrategyProfitReceipt,
        closedTradeSettlements: input.closedTradeSettlements,
        realityDependencies: input.realityDependencies,
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
      const scoped = await requireServiceOrgContext(context, deps.assertMembership);
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
  const assertMembership = deps.assertMembership ?? ((context: OrgContext & { userId: string }) =>
    assertOrgMembershipSqlite(db, context));
  const service = createBillingPeriodCloseOrchestrator({
    assertMembership,
    reportingPeriodLifecycle:
      deps.reportingPeriodLifecycle ?? createSqliteReportingPeriodLifecycleService(db, { assertMembership }),
    hwmLedger: deps.hwmLedger ?? createSqliteHwmLedgerService(db, { assertMembership }),
    draftInvoiceService: deps.draftInvoiceService ?? createSqliteDraftInvoiceService(db, { assertMembership }),
  });
  return { ...service, async closeAndMaterialize(context, input) {
    const captured = snapshotBillingCommand({ context, input });
    await requireServiceOrgContext(captured.context, assertMembership);
    refuseBillingReality("BILLING_REALITY_POSTGRES_REQUIRED");
  } };
}

function createBoundPostgresBillingPeriodCloseOrchestrator(
  ex: WaiaPostgresDb,
  assertMembership: NonNullable<BillingPeriodCloseOrchestratorDeps["assertMembership"]>,
  proof?: BillingRealityDependenciesMatched,
): BillingPeriodCloseOrchestrator {
  const draftInvoiceService = createPostgresDraftInvoiceService(ex, { assertMembership });
  return createBillingPeriodCloseOrchestrator({
    assertMembership,
    reportingPeriodLifecycle: createReportingPeriodLifecycleService({
      repository: createPostgresReportingPeriodRepository(ex), assertMembership, draftInvoiceService,
      writeAudit: (input) => writeTraderAuditLogPostgres(ex, { ...input, metadata: { ...input.metadata,
        ...(proof && input.action === traderAuditActions.reportingPeriodClosed ? { realityDependencies: proof } : {}) } }),
    }),
    hwmLedger: createPostgresHwmLedgerService(ex, { assertMembership }),
    draftInvoiceService,
  });
}

export function createPostgresBillingPeriodCloseOrchestrator(
  db: WaiaPostgresDb, options: PostgresBillingCloseOptions = {},
): BillingPeriodCloseOrchestrator {
  const assertMembership = options.assertMembership;
  const capturedOptions = { assertMembership };
  const membership = (bound: WaiaPostgresDb) => (actor: OrgContext & { userId: string }) =>
    assertMembership ? assertMembership(actor, bound) : assertOrgMembershipPostgres(bound, actor);
  const service = createBoundPostgresBillingPeriodCloseOrchestrator(db, membership(db));
  return { ...service, closeAndMaterialize(context, input) {
    return runPostgresBillingRealityCommand(db, context, input, capturedOptions, (tx, scoped, captured, proof) =>
      createBoundPostgresBillingPeriodCloseOrchestrator(tx, membership(tx), proof).closeAndMaterialize(scoped, captured));
  } };
}
