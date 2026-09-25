import { requireServiceOrgContext } from "@/lib/trader/security/service-org-context";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { assertAllowedReportingPeriodTransition } from "@/lib/trader/billing/reporting-period-lifecycle.transitions";
import {
  ReportingPeriodAlreadyOpenError,
  ReportingPeriodNotOpenError,
} from "@/lib/trader/billing/reporting-period.errors";
import type {
  CloseReportingPeriodInput,
  ListReportingPeriodsQuery,
  OpenReportingPeriodInput,
  ReportingPeriodRepository,
} from "@/lib/trader/billing/reporting-period-repository.types";
import type { DraftInvoiceService } from "@/lib/trader/billing/draft-invoice-service";
import {
  createPostgresDraftInvoiceService,
  createSqliteDraftInvoiceService,
} from "@/lib/trader/billing/draft-invoice-service";
import { DraftInvoiceNotBillableError } from "@/lib/trader/billing/invoice.errors";
import {
  createPostgresReportingPeriodRepository,
  createSqliteReportingPeriodRepository,
} from "@/lib/trader/billing/repository-adapters";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import { buildReportingPeriodRecordPayload } from "@/lib/trader/billing/serialize-reporting-period";
import {
  BILLING_RECEIPT_PNL_MISMATCH,
  BillingCanonicalProfitAdmissionError,
  admitCanonicalPeriodProfitFromReceiptV2,
  billingPeriodReportingScopeIdV2,
  refuseNakedRealizedPnl,
} from "@/lib/trader/billing/v2";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReportingPeriodExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type ReportingPeriodLifecycleServiceDeps = {
  repository: ReportingPeriodRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  draftInvoiceService?: DraftInvoiceService;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type ReportingPeriodLifecycleService = {
  openReportingPeriod(
    context: OrgContext,
    input: OpenReportingPeriodInput,
  ): Promise<ReportingPeriodRecordView>;
  closeReportingPeriod(
    context: OrgContext,
    input: CloseReportingPeriodInput,
  ): Promise<ReportingPeriodRecordView>;
  findOpenPeriod(
    context: OrgContext,
    exchangeAccountId: string,
  ): Promise<ReportingPeriodRecordView | null>;
  getReportingPeriodById(
    context: OrgContext,
    id: string,
  ): Promise<ReportingPeriodRecordView | null>;
  listClosedPeriods(
    context: OrgContext,
    query?: ListReportingPeriodsQuery,
  ): Promise<ReportingPeriodRecordView[]>;
};

function buildAuditInput(
  action: TraderAuditInput["action"],
  context: OrgContext,
  entityId: string,
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"] = "service",
  actorId: string | null = null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action,
    entityType: traderEntityTypes.reportingPeriod,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

async function materializeDraftInvoiceAfterPeriodClose(
  deps: ReportingPeriodLifecycleServiceDeps,
  context: OrgContext,
  period: ReportingPeriodRecordView,
  periodEnd: Date,
): Promise<void> {
  if (!deps.draftInvoiceService) {
    return;
  }

  try {
    await deps.draftInvoiceService.generateDraftInvoice(context, {
      periodId: period.id,
      computedAt: periodEnd,
      realizedFillFinality: false,
    });
  } catch (error) {
    if (error instanceof DraftInvoiceNotBillableError) {
      return;
    }
    throw error;
  }
}

export function createReportingPeriodLifecycleService(
  deps: ReportingPeriodLifecycleServiceDeps,
): ReportingPeriodLifecycleService {
  return {
    async openReportingPeriod(context, input) {
      const scoped = await requireServiceOrgContext(context, deps.assertMembership);

      const existing = await deps.repository.findOpenPeriod(scoped, input.exchangeAccountId);
      if (existing) {
        throw new ReportingPeriodAlreadyOpenError(input.exchangeAccountId);
      }

      const payload = buildReportingPeriodRecordPayload({
        organizationId: scoped.organizationId,
        exchangeAccountId: input.exchangeAccountId,
        periodStart: input.periodStart,
        periodEnd: null,
        startingEquity: input.startingEquity,
        endingEquity: null,
        openPositionsSnapshotRef: input.openPositionsSnapshotRef,
        realizedPnl: null,
        unrealizedPnl: null,
        netDeposits: "0",
        netWithdrawals: "0",
        valuationSource: input.valuationSource,
        startingSnapshotAt: input.startingSnapshotAt,
        endingSnapshotAt: null,
        status: "OPEN",
      });

      const row = await deps.repository.insertOpenPeriod(scoped, { payload });

      await deps.writeAudit(
        buildAuditInput(traderAuditActions.reportingPeriodOpened, scoped, row.id, {
          exchangeAccountId: input.exchangeAccountId,
          periodStart: input.periodStart.toISOString(),
          startingEquity: input.startingEquity,
          valuationSource: input.valuationSource,
          startingSnapshotAt: input.startingSnapshotAt.toISOString(),
          openPositionsSnapshotRef: input.openPositionsSnapshotRef,
          recordContentDigest: row.recordContentDigest,
        }),
      );

      return row;
    },

    async closeReportingPeriod(context, input) {
      const scoped = await requireServiceOrgContext(context, deps.assertMembership);

      if (input.realizedStrategyProfitReceipt == null || input.closedTradeSettlements == null) {
        refuseNakedRealizedPnl();
      }

      const openPeriod = await deps.repository.findOpenPeriod(scoped, input.exchangeAccountId);
      if (!openPeriod) {
        throw new ReportingPeriodNotOpenError(input.exchangeAccountId);
      }

      assertAllowedReportingPeriodTransition(openPeriod.status, "CLOSED");

      const admitted = admitCanonicalPeriodProfitFromReceiptV2({
        organizationId: scoped.organizationId,
        accountId: input.exchangeAccountId,
        receipt: input.realizedStrategyProfitReceipt,
        settlements: input.closedTradeSettlements,
        expectedReportingScopeId: billingPeriodReportingScopeIdV2({
          organizationId: scoped.organizationId,
          accountId: input.exchangeAccountId,
          periodStart: openPeriod.periodStart,
          periodEnd: input.periodEnd,
        }),
      });
      if (input.realizedPnl != null && compareDecimal(input.realizedPnl, admitted) !== 0) {
        throw new BillingCanonicalProfitAdmissionError(BILLING_RECEIPT_PNL_MISMATCH);
      }
      const realizedPnl = input.realizedPnl ?? admitted;

      const payload = buildReportingPeriodRecordPayload({
        organizationId: openPeriod.organizationId,
        exchangeAccountId: openPeriod.exchangeAccountId,
        periodStart: openPeriod.periodStart,
        periodEnd: input.periodEnd,
        startingEquity: openPeriod.startingEquity,
        endingEquity: input.endingEquity,
        openPositionsSnapshotRef: openPeriod.openPositionsSnapshotRef,
        realizedPnl,
        unrealizedPnl: input.unrealizedPnl,
        netDeposits: input.netDeposits ?? openPeriod.netDeposits,
        netWithdrawals: input.netWithdrawals ?? openPeriod.netWithdrawals,
        valuationSource: openPeriod.valuationSource,
        startingSnapshotAt: openPeriod.startingSnapshotAt,
        endingSnapshotAt: input.endingSnapshotAt,
        status: "CLOSED",
      });

      const row = await deps.repository.closePeriod(scoped, {
        id: openPeriod.id,
        payload,
      });

      await deps.writeAudit(
        buildAuditInput(traderAuditActions.reportingPeriodClosed, scoped, row.id, {
          exchangeAccountId: input.exchangeAccountId,
          periodEnd: input.periodEnd.toISOString(),
          endingEquity: input.endingEquity,
          endingSnapshotAt: input.endingSnapshotAt.toISOString(),
          realizedPnl,
          unrealizedPnl: input.unrealizedPnl,
          netDeposits: payload.netDeposits,
          netWithdrawals: payload.netWithdrawals,
          recordContentDigest: row.recordContentDigest,
        }),
      );

      await materializeDraftInvoiceAfterPeriodClose(deps, scoped, row, input.periodEnd);

      return row;
    },

    async findOpenPeriod(context, exchangeAccountId) {
      const scoped = await requireServiceOrgContext(context, deps.assertMembership);
      return deps.repository.findOpenPeriod(scoped, exchangeAccountId);
    },

    async getReportingPeriodById(context, id) {
      const scoped = await requireServiceOrgContext(context, deps.assertMembership);
      return deps.repository.getById(scoped, id);
    },

    async listClosedPeriods(context, query = {}) {
      const scoped = await requireServiceOrgContext(context, deps.assertMembership);
      return deps.repository.listClosedPeriods(scoped, query);
    },
  };
}

export function createSqliteReportingPeriodLifecycleService(
  db: WaiaDb,
  deps: Partial<ReportingPeriodLifecycleServiceDeps> = {},
): ReportingPeriodLifecycleService {
  return createReportingPeriodLifecycleService({
    repository: deps.repository ?? createSqliteReportingPeriodRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    draftInvoiceService: deps.draftInvoiceService ?? createSqliteDraftInvoiceService(db, { assertMembership: deps.assertMembership }),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresReportingPeriodLifecycleService(
  ex: PgReportingPeriodExecutor,
  deps: Partial<ReportingPeriodLifecycleServiceDeps> = {},
  db?: WaiaPostgresDb,
): ReportingPeriodLifecycleService {
  return createReportingPeriodLifecycleService({
    repository: deps.repository ?? createPostgresReportingPeriodRepository(ex, db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    draftInvoiceService: deps.draftInvoiceService ?? createPostgresDraftInvoiceService(ex, { assertMembership: deps.assertMembership }, db),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
