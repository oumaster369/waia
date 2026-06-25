import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import type { FeeComputationService } from "@/lib/trader/billing/fee-computation-service";
import {
  createPostgresFeeComputationService,
  createSqliteFeeComputationService,
} from "@/lib/trader/billing/fee-computation-service";
import {
  DraftInvoiceContentMismatchError,
  DraftInvoiceNotBillableError,
  DraftInvoiceNotDraftError,
  DraftInvoicePeriodDisclosureMissingError,
  DraftInvoiceValidationError,
} from "@/lib/trader/billing/invoice.errors";
import type { InvoiceRepository } from "@/lib/trader/billing/invoice-repository.types";
import {
  createPostgresInvoiceRepository,
  createSqliteInvoiceRepository,
} from "@/lib/trader/billing/invoice-repository-adapters";
import { isInvoicePgUniqueViolation } from "@/lib/trader/billing/invoice-repository-postgres";
import { isInvoiceUniqueConstraintError } from "@/lib/trader/billing/invoice-repository-sqlite";
import type {
  GenerateDraftInvoiceInput,
  InvoiceRecordPayload,
  InvoiceRecordView,
} from "@/lib/trader/billing/invoice.types";
import type { ReportingPeriodRepository } from "@/lib/trader/billing/reporting-period-repository.types";
import {
  createPostgresReportingPeriodRepository,
  createSqliteReportingPeriodRepository,
} from "@/lib/trader/billing/repository-adapters";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import { buildInvoiceRecordPayloadFromSources } from "@/lib/trader/billing/serialize-invoice";
import { parseDecimal } from "@/lib/trader/risk/numeric";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgDraftInvoiceExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type PeriodDisclosureSnapshot = {
  startingEquity: string;
  endingEquity: string;
  netDeposits: string;
  netWithdrawals: string;
  periodStart: Date;
  periodEnd: Date;
  valuationSource: string;
};

export type DraftInvoiceServiceDeps = {
  feeComputationService: FeeComputationService;
  reportingPeriodRepository: ReportingPeriodRepository;
  invoiceRepository: InvoiceRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type DraftInvoiceService = {
  generateDraftInvoice(
    context: OrgContext,
    input: GenerateDraftInvoiceInput,
  ): Promise<InvoiceRecordView>;
  getDraftInvoiceByPeriod(
    context: OrgContext,
    exchangeAccountId: string,
    reportingPeriodId: string,
  ): Promise<InvoiceRecordView | null>;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: DraftInvoiceServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildAuditInput(
  context: OrgContext,
  entityId: string,
  metadata: Record<string, unknown>,
): TraderAuditInput {
  return {
    actorType: "service",
    actorId: null,
    action: traderAuditActions.invoiceDraftGenerated,
    entityType: traderEntityTypes.invoice,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function assertValidDecimal(field: string, value: string): void {
  try {
    parseDecimal(value);
  } catch {
    throw new DraftInvoiceValidationError(
      "DRAFT_INVOICE_INVALID_DECIMAL",
      `Invalid decimal for ${field}: ${value}`,
    );
  }
}

function assertInvoiceMonetaryFields(payload: InvoiceRecordPayload): void {
  for (const [field, value] of Object.entries({
    periodRealizedStrategyProfit: payload.periodRealizedStrategyProfit,
    cumulativeRealizedStrategyProfit: payload.cumulativeRealizedStrategyProfit,
    previousHighWaterMark: payload.previousHighWaterMark,
    newProfitAboveHwm: payload.newProfitAboveHwm,
    feeRate: payload.feeRate,
    performanceFee: payload.performanceFee,
    proposedNewHighWaterMark: payload.proposedNewHighWaterMark,
    startingEquity: payload.startingEquity,
    endingEquity: payload.endingEquity,
    netDeposits: payload.netDeposits,
    netWithdrawals: payload.netWithdrawals,
  })) {
    assertValidDecimal(field, value);
  }

  if (payload.unrealizedPnl !== null) {
    assertValidDecimal("unrealizedPnl", payload.unrealizedPnl);
  }
}

export function extractPeriodDisclosure(
  period: ReportingPeriodRecordView,
): PeriodDisclosureSnapshot {
  if (period.endingEquity === null) {
    throw new DraftInvoicePeriodDisclosureMissingError(period.id, "endingEquity");
  }
  if (period.periodEnd === null) {
    throw new DraftInvoicePeriodDisclosureMissingError(period.id, "periodEnd");
  }

  return {
    startingEquity: period.startingEquity,
    endingEquity: period.endingEquity,
    netDeposits: period.netDeposits,
    netWithdrawals: period.netWithdrawals,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    valuationSource: period.valuationSource,
  };
}

function reconcileExistingDraftInvoice(
  existing: InvoiceRecordView,
  expectedPayload: InvoiceRecordPayload,
): InvoiceRecordView {
  if (existing.status !== "DRAFT") {
    throw new DraftInvoiceNotDraftError(existing.id, existing.status);
  }

  if (existing.recordContentDigest !== expectedPayload.recordContentDigest) {
    throw new DraftInvoiceContentMismatchError(existing.reportingPeriodId);
  }

  return existing;
}

export function createDraftInvoiceService(deps: DraftInvoiceServiceDeps): DraftInvoiceService {
  return {
    async generateDraftInvoice(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const artifact = await deps.feeComputationService.computeFeeForPeriod(scoped, input);

      if (!artifact.billable) {
        throw new DraftInvoiceNotBillableError(input.periodId, artifact.performanceFee);
      }

      const period = await deps.reportingPeriodRepository.getById(scoped, input.periodId);
      if (!period) {
        throw new DraftInvoiceValidationError(
          "DRAFT_INVOICE_PERIOD_NOT_FOUND",
          `Reporting period ${input.periodId} not found`,
        );
      }

      const disclosure = extractPeriodDisclosure(period);
      const expectedPayload = buildInvoiceRecordPayloadFromSources(artifact, period, disclosure);
      assertInvoiceMonetaryFields(expectedPayload);

      const existing = await deps.invoiceRepository.findByReportingPeriod(
        scoped,
        artifact.exchangeAccountId,
        artifact.periodId,
      );

      if (existing) {
        return reconcileExistingDraftInvoice(existing, expectedPayload);
      }

      try {
        const row = await deps.invoiceRepository.insertInvoice(scoped, {
          payload: expectedPayload,
        });

        await deps.writeAudit(
          buildAuditInput(scoped, row.id, {
            exchangeAccountId: row.exchangeAccountId,
            reportingPeriodId: row.reportingPeriodId,
            performanceFee: row.performanceFee,
            feeArtifactDigest: row.feeArtifactDigest,
            recordContentDigest: row.recordContentDigest,
            feeComputedAt: row.feeComputedAt.toISOString(),
          }),
        );

        return row;
      } catch (error) {
        if (!isInvoiceUniqueConstraintError(error) && !isInvoicePgUniqueViolation(error)) {
          throw error;
        }

        const raced = await deps.invoiceRepository.findByReportingPeriod(
          scoped,
          artifact.exchangeAccountId,
          artifact.periodId,
        );
        if (!raced) {
          throw error;
        }

        return reconcileExistingDraftInvoice(raced, expectedPayload);
      }
    },

    async getDraftInvoiceByPeriod(context, exchangeAccountId, reportingPeriodId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return deps.invoiceRepository.findByReportingPeriod(
        scoped,
        exchangeAccountId,
        reportingPeriodId,
      );
    },
  };
}

export function createSqliteDraftInvoiceService(
  db: WaiaDb,
  deps: Partial<DraftInvoiceServiceDeps> = {},
): DraftInvoiceService {
  return createDraftInvoiceService({
    feeComputationService: deps.feeComputationService ?? createSqliteFeeComputationService(db),
    reportingPeriodRepository:
      deps.reportingPeriodRepository ?? createSqliteReportingPeriodRepository(db),
    invoiceRepository: deps.invoiceRepository ?? createSqliteInvoiceRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresDraftInvoiceService(
  ex: PgDraftInvoiceExecutor,
  deps: Partial<DraftInvoiceServiceDeps> = {},
  db?: WaiaPostgresDb,
): DraftInvoiceService {
  return createDraftInvoiceService({
    feeComputationService:
      deps.feeComputationService ?? createPostgresFeeComputationService(ex, {}, db),
    reportingPeriodRepository:
      deps.reportingPeriodRepository ?? createPostgresReportingPeriodRepository(ex, db),
    invoiceRepository: deps.invoiceRepository ?? createPostgresInvoiceRepository(ex, db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
