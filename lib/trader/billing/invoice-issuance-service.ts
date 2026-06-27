import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { extractPeriodDisclosure } from "@/lib/trader/billing/draft-invoice-service";
import {
  createPostgresFeeComputationService,
  createSqliteFeeComputationService,
} from "@/lib/trader/billing/fee-computation-service";
import { HwmLedgerNotBootstrappedError } from "@/lib/trader/billing/hwm-ledger.errors";
import {
  createPostgresHwmLedgerRepository,
  createSqliteHwmLedgerRepository,
} from "@/lib/trader/billing/hwm-ledger-repository-adapters";
import {
  DraftInvoiceDigestMismatchError,
  DraftInvoiceNotBillableError,
} from "@/lib/trader/billing/invoice.errors";
import {
  computeApprovalExpiresAt,
  computeCoolingOffUntil,
  effectiveInvoiceApprovalValidityMs,
} from "@/lib/trader/billing/invoice-issuance.config";
import {
  IssuanceAlreadyIssuedError,
  IssuanceApprovalExpiredError,
  IssuanceApprovalRequiredError,
  IssuanceAttestationIncompleteError,
  IssuanceCoolingOffNotElapsedError,
  IssuanceHwmInconsistentError,
  IssuanceInvoiceNotFoundError,
  IssuanceNotDraftError,
  IssuanceOperatorRequiredError,
} from "@/lib/trader/billing/invoice-issuance.errors";
import {
  createPostgresInvoiceIssuanceRepository,
  createSqliteInvoiceIssuanceRepository,
} from "@/lib/trader/billing/invoice-issuance-repository-adapters";
import {
  isIssuanceAttestationComplete,
  type ApproveIssuanceInput,
  type CancelPendingIssuanceInput,
  type InvoiceIssuanceService,
  type InvoiceIssuanceServiceDeps,
  type IssueInvoiceInput,
} from "@/lib/trader/billing/invoice-issuance.types";
import {
  createPostgresInvoiceRepository,
  createSqliteInvoiceRepository,
} from "@/lib/trader/billing/invoice-repository-adapters";
import type { InvoiceRecordView, IssuedInvoiceView } from "@/lib/trader/billing/invoice.types";
import {
  createPostgresReportingPeriodRepository,
  createSqliteReportingPeriodRepository,
} from "@/lib/trader/billing/repository-adapters";
import { buildHwmLedgerRecordPayload } from "@/lib/trader/billing/serialize-hwm-ledger";
import {
  verifyDraftInvoiceCanonicalBinding,
  verifyInvoiceRecordDigest,
} from "@/lib/trader/billing/serialize-invoice";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type OperatorContext = OrgContext & { userId?: string };

type PgInvoiceIssuanceExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

async function assertMembershipIfNeeded(
  context: OperatorContext,
  assertMembership: InvoiceIssuanceServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function requireOperatorId(context: OperatorContext): string {
  const operatorId = context.userId?.trim();
  if (!operatorId) {
    throw new IssuanceOperatorRequiredError();
  }
  return operatorId;
}

function buildApprovalAuditInput(
  context: OrgContext,
  operatorId: string,
  invoice: InvoiceRecordView,
  attestations: ApproveIssuanceInput["attestations"],
  coolingOffUntil: Date,
): TraderAuditInput {
  return {
    actorType: "user",
    actorId: operatorId,
    action: traderAuditActions.invoiceIssuanceApproved,
    entityType: traderEntityTypes.invoice,
    entityId: invoice.id,
    organizationId: context.organizationId,
    metadata: {
      reportingPeriodId: invoice.reportingPeriodId,
      exchangeAccountId: invoice.exchangeAccountId,
      feeArtifactDigest: invoice.feeArtifactDigest,
      recordContentDigest: invoice.recordContentDigest,
      coolingOffUntil: coolingOffUntil.toISOString(),
      attestations,
    },
  };
}

function buildCancellationAuditInput(
  context: OrgContext,
  operatorId: string,
  invoiceId: string,
  reason: string,
): TraderAuditInput {
  return {
    actorType: "user",
    actorId: operatorId,
    action: traderAuditActions.invoiceIssuanceCancelled,
    entityType: traderEntityTypes.invoice,
    entityId: invoiceId,
    organizationId: context.organizationId,
    metadata: { reason },
  };
}

async function loadInvoiceOrThrow(
  deps: InvoiceIssuanceServiceDeps,
  context: OrgContext,
  invoiceId: string,
): Promise<InvoiceRecordView> {
  const invoice = await deps.invoiceRepository.getById(context, invoiceId);
  if (!invoice) {
    throw new IssuanceInvoiceNotFoundError(invoiceId);
  }
  return invoice;
}

async function loadCanonicalSources(
  deps: InvoiceIssuanceServiceDeps,
  context: OrgContext,
  invoice: InvoiceRecordView,
) {
  const period = await deps.reportingPeriodRepository.getById(context, invoice.reportingPeriodId);
  if (!period) {
    throw new IssuanceInvoiceNotFoundError(invoice.id);
  }

  const artifact = await deps.feeComputationService.computeFeeForPeriod(context, {
    periodId: invoice.reportingPeriodId,
    realizedFillFinality: invoice.realizedFillFinality,
    computedAt: invoice.feeComputedAt,
  });

  const disclosure = extractPeriodDisclosure(period);
  verifyDraftInvoiceCanonicalBinding(invoice, artifact, period, disclosure);
  verifyInvoiceRecordDigest(invoice);

  return { period, artifact, disclosure };
}

function assertPendingApproval(invoice: InvoiceRecordView, now: Date): void {
  if (!invoice.issuanceApprovedAt || !invoice.coolingOffUntil) {
    throw new IssuanceApprovalRequiredError(invoice.id);
  }

  const expiresAt = computeApprovalExpiresAt(
    invoice.issuanceApprovedAt,
    effectiveInvoiceApprovalValidityMs(),
  );
  if (now.getTime() > expiresAt.getTime()) {
    throw new IssuanceApprovalExpiredError(invoice.id, expiresAt);
  }
}

async function invalidateStaleApproval(
  deps: InvoiceIssuanceServiceDeps,
  context: OrgContext,
  invoiceId: string,
  error: unknown,
): Promise<void> {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null;

  if (
    error instanceof DraftInvoiceDigestMismatchError ||
    error instanceof IssuanceHwmInconsistentError ||
    code === "INVOICE_RECORD_DIGEST_MISMATCH" ||
    code === "ISSUANCE_HWM_INCONSISTENT"
  ) {
    await deps.invoiceRepository.clearIssuanceApprovalMetadata(context, { invoiceId });
  }
}

export function createInvoiceIssuanceService(
  deps: InvoiceIssuanceServiceDeps,
): InvoiceIssuanceService {
  const nowFn = deps.now ?? (() => new Date());

  return {
    async approveInvoiceIssuance(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(context, deps.assertMembership);
      const operatorId = requireOperatorId(context);

      if (!isIssuanceAttestationComplete(input.attestations)) {
        throw new IssuanceAttestationIncompleteError();
      }

      const invoice = await loadInvoiceOrThrow(deps, scoped, input.invoiceId);
      if (invoice.status === "ISSUED") {
        throw new IssuanceAlreadyIssuedError(invoice.id);
      }
      if (invoice.status !== "DRAFT") {
        throw new IssuanceNotDraftError(invoice.id, invoice.status);
      }
      if (!invoice.billable) {
        throw new DraftInvoiceNotBillableError(invoice.reportingPeriodId, invoice.performanceFee);
      }

      await loadCanonicalSources(deps, scoped, invoice);

      const approvedAt = input.approvedAt ?? nowFn();
      const coolingOffUntil = computeCoolingOffUntil(approvedAt, input.coolingOffMs);

      const updated = await deps.invoiceRepository.setIssuanceApprovalMetadata(scoped, {
        invoiceId: invoice.id,
        issuanceApprovedAt: approvedAt,
        issuanceApprovedBy: operatorId,
        coolingOffUntil,
      });

      await deps.writeAudit(
        buildApprovalAuditInput(scoped, operatorId, updated, input.attestations, coolingOffUntil),
      );

      return updated;
    },

    async cancelPendingIssuance(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(context, deps.assertMembership);
      const operatorId = requireOperatorId(context);

      const invoice = await loadInvoiceOrThrow(deps, scoped, input.invoiceId);
      if (invoice.status === "ISSUED") {
        throw new IssuanceAlreadyIssuedError(invoice.id);
      }

      if (!invoice.issuanceApprovedAt && !invoice.coolingOffUntil) {
        return invoice;
      }

      const cleared = await deps.invoiceRepository.clearIssuanceApprovalMetadata(scoped, {
        invoiceId: invoice.id,
      });

      await deps.writeAudit(
        buildCancellationAuditInput(scoped, operatorId, invoice.id, input.reason.trim()),
      );

      return cleared;
    },

    async issueInvoice(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(context, deps.assertMembership);
      const operatorId = requireOperatorId(context);
      const now = input.issuedAt ?? nowFn();

      try {
        const invoice = await loadInvoiceOrThrow(deps, scoped, input.invoiceId);
        if (invoice.status === "ISSUED") {
          if (!invoice.issuedAt) {
            throw new Error("[trader] issued invoice missing issuedAt");
          }
          return invoice as IssuedInvoiceView;
        }

        if (invoice.status !== "DRAFT") {
          throw new IssuanceNotDraftError(invoice.id, invoice.status);
        }
        if (!invoice.billable) {
          throw new DraftInvoiceNotBillableError(invoice.reportingPeriodId, invoice.performanceFee);
        }

        assertPendingApproval(invoice, now);
        if (now.getTime() < invoice.coolingOffUntil!.getTime()) {
          throw new IssuanceCoolingOffNotElapsedError(invoice.id, invoice.coolingOffUntil!);
        }

        const boundInvoice = await loadInvoiceOrThrow(deps, scoped, input.invoiceId);
        const { period, artifact, disclosure } = await loadCanonicalSources(
          deps,
          scoped,
          boundInvoice,
        );

        const currentHwm = await deps.hwmLedgerRepository.getCurrentEntry(
          scoped,
          invoice.exchangeAccountId,
        );
        if (!currentHwm) {
          throw new HwmLedgerNotBootstrappedError(invoice.exchangeAccountId);
        }

        const hwmPayload = buildHwmLedgerRecordPayload({
          organizationId: scoped.organizationId,
          exchangeAccountId: invoice.exchangeAccountId,
          entryType: "RATCHET_UP",
          highWaterMark: invoice.proposedNewHighWaterMark,
          previousHighWaterMark: currentHwm.highWaterMark,
          sourcePeriodId: invoice.reportingPeriodId,
          sourceInvoiceId: invoice.id,
          valuationSource: invoice.valuationSource,
          effectiveAt: now,
          reason: null,
        });

        const result = await deps.issuanceRepository.executeAtomicIssuance(scoped, {
          invoiceId: invoice.id,
          issuedAt: now,
          issuedBy: operatorId,
          artifact,
          period,
          disclosure,
          hwmPayload,
          attestations: {
            depositsVerified: true,
            withdrawalsVerified: true,
            balanceSnapshotsVerified: true,
            reconciliationVerified: true,
            exchangeSyncVerified: true,
            realizedFillFinalityVerified: invoice.realizedFillFinality,
          },
          auditMetadata: {
            reportingPeriodId: invoice.reportingPeriodId,
            exchangeAccountId: invoice.exchangeAccountId,
            performanceFee: invoice.performanceFee,
            previousHwm: invoice.previousHighWaterMark,
            newHwm: invoice.proposedNewHighWaterMark,
            feeArtifactDigest: invoice.feeArtifactDigest,
            recordContentDigest: invoice.recordContentDigest,
            issuedAt: now.toISOString(),
            realizedFillFinalityAttested: invoice.realizedFillFinality,
          },
        });

        return result.invoice;
      } catch (error) {
        await invalidateStaleApproval(deps, scoped, input.invoiceId, error);
        throw error;
      }
    },
  };
}

export function createSqliteInvoiceIssuanceService(
  db: WaiaDb,
  deps: Partial<InvoiceIssuanceServiceDeps> = {},
): InvoiceIssuanceService {
  return createInvoiceIssuanceService({
    feeComputationService: deps.feeComputationService ?? createSqliteFeeComputationService(db),
    reportingPeriodRepository:
      deps.reportingPeriodRepository ?? createSqliteReportingPeriodRepository(db),
    invoiceRepository: deps.invoiceRepository ?? createSqliteInvoiceRepository(db),
    hwmLedgerRepository: deps.hwmLedgerRepository ?? createSqliteHwmLedgerRepository(db),
    issuanceRepository: deps.issuanceRepository ?? createSqliteInvoiceIssuanceRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
    now: deps.now,
  });
}

export function createPostgresInvoiceIssuanceService(
  ex: PgInvoiceIssuanceExecutor,
  deps: Partial<InvoiceIssuanceServiceDeps> = {},
  db?: WaiaPostgresDb,
): InvoiceIssuanceService {
  return createInvoiceIssuanceService({
    feeComputationService:
      deps.feeComputationService ?? createPostgresFeeComputationService(ex, {}, db),
    reportingPeriodRepository:
      deps.reportingPeriodRepository ?? createPostgresReportingPeriodRepository(ex, db),
    invoiceRepository: deps.invoiceRepository ?? createPostgresInvoiceRepository(ex, db),
    hwmLedgerRepository: deps.hwmLedgerRepository ?? createPostgresHwmLedgerRepository(ex, db),
    issuanceRepository: deps.issuanceRepository ?? createPostgresInvoiceIssuanceRepository(ex, db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
    now: deps.now,
  });
}

export type {
  ApproveIssuanceInput,
  CancelPendingIssuanceInput,
  InvoiceIssuanceService,
  InvoiceIssuanceServiceDeps,
  IssueInvoiceInput,
};
