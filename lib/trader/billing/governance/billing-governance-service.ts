import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import type { InvoiceCorrectionRepository } from "@/lib/trader/billing/governance/correction-repository.types";
import { createPostgresInvoiceCorrectionRepository } from "@/lib/trader/billing/governance/correction-repository-postgres";
import { createSqliteInvoiceCorrectionRepository } from "@/lib/trader/billing/governance/correction-repository-sqlite";
import type { InvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository.types";
import { createPostgresInvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository-postgres";
import { createSqliteInvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository-sqlite";
import {
  InvoiceCorrectionReasonRequiredError,
  InvoiceDisputeAlreadyOpenError,
  InvoiceDisputeInvalidInvoiceStatusError,
  InvoiceDisputeInvoiceNotFoundError,
  InvoiceDisputeNotFoundError,
  InvoiceDisputeNotOpenError,
  InvoiceDisputeOpenRequiredForCorrectionError,
} from "@/lib/trader/billing/governance/billing-governance.errors";
import {
  assertDisputeTransitionAllowed,
  isInvoiceDisputable,
  resolveDisputeStatusAfterEvent,
} from "@/lib/trader/billing/governance/billing-governance.transitions";
import type {
  InvoiceCorrectionRecordView,
  InvoiceCorrectionType,
  InvoiceDisputeProjectionView,
} from "@/lib/trader/billing/governance/billing-governance.types";
import { buildInvoiceCorrectionPayload } from "@/lib/trader/billing/governance/serialize-invoice-correction";
import { buildInvoiceDisputeEventPayload } from "@/lib/trader/billing/governance/serialize-invoice-dispute-event";
import {
  createPostgresHwmLedgerService,
  createSqliteHwmLedgerService,
  type HwmLedgerService,
} from "@/lib/trader/billing/hwm-ledger-service";
import type { InvoiceRepository } from "@/lib/trader/billing/invoice-repository.types";
import { createPostgresInvoiceRepository } from "@/lib/trader/billing/invoice-repository-adapters";
import { createSqliteInvoiceRepository } from "@/lib/trader/billing/invoice-repository-adapters";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type OpenInvoiceDisputeInput = {
  invoiceId: string;
  reason: string;
  openedBy: string;
  now?: Date;
};

export type ResolveInvoiceDisputeUpheldInput = {
  disputeId: string;
  resolutionReason: string;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
  now?: Date;
};

export type ApplyOverchargeCorrectionInput = {
  invoiceId: string;
  correctionType: InvoiceCorrectionType;
  amount: string;
  restoredHwm: string;
  reason: string;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
  now?: Date;
};

export type ApplyOverchargeCorrectionResult = {
  correction: InvoiceCorrectionRecordView;
  dispute: InvoiceDisputeProjectionView;
  hwmLedgerEntryId: string;
};

export type BillingGovernanceServiceDeps = {
  invoiceRepository: InvoiceRepository;
  disputeRepository: InvoiceDisputeRepository;
  correctionRepository: InvoiceCorrectionRepository;
  hwmLedgerService: HwmLedgerService;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
};

export type BillingGovernanceService = {
  openInvoiceDispute(
    context: OrgContext,
    input: OpenInvoiceDisputeInput,
  ): Promise<InvoiceDisputeProjectionView>;
  resolveInvoiceDisputeUpheld(
    context: OrgContext,
    input: ResolveInvoiceDisputeUpheldInput,
  ): Promise<InvoiceDisputeProjectionView>;
  applyOverchargeCorrection(
    context: OrgContext,
    input: ApplyOverchargeCorrectionInput,
  ): Promise<ApplyOverchargeCorrectionResult>;
  findOpenDisputeForInvoice(
    context: OrgContext,
    invoiceId: string,
  ): Promise<InvoiceDisputeProjectionView | null>;
};

async function appendDisputeEvent(
  deps: BillingGovernanceServiceDeps,
  context: OrgContext,
  dispute: InvoiceDisputeProjectionView | null,
  input: {
    disputeId: string;
    invoiceId: string;
    exchangeAccountId: string;
    eventType: "OPENED" | "RESOLVED_UPHELD" | "RESOLVED_CORRECTED";
    reason: string | null;
    actorType: TraderAuditInput["actorType"];
    actorId: string | null;
    openedBy?: string | null;
    openedAt?: Date;
    resolutionReason?: string | null;
    now: Date;
  },
): Promise<InvoiceDisputeProjectionView> {
  assertDisputeTransitionAllowed(dispute?.status ?? null, input.eventType);
  const events = dispute
    ? await deps.disputeRepository.listEventsForDispute(context, dispute.id)
    : [];
  const lastEvent = events.at(-1) ?? null;
  const seq = (lastEvent?.seq ?? 0) + 1;
  const eventPayload = buildInvoiceDisputeEventPayload({
    organizationId: context.organizationId,
    disputeId: input.disputeId,
    seq,
    eventType: input.eventType,
    reason: input.reason,
    actorType: input.actorType,
    actorId: input.actorId,
    prevEventDigest: lastEvent?.recordContentDigest ?? null,
  });

  const status = resolveDisputeStatusAfterEvent(input.eventType);
  const projection: InvoiceDisputeProjectionView = {
    id: input.disputeId,
    organizationId: context.organizationId,
    invoiceId: input.invoiceId,
    exchangeAccountId: input.exchangeAccountId,
    status,
    reason: input.reason,
    openedBy: dispute?.openedBy ?? input.openedBy ?? null,
    openedAt: dispute?.openedAt ?? input.openedAt ?? input.now,
    resolvedAt: status === "OPEN" ? null : input.now,
    resolutionReason: input.resolutionReason ?? null,
    lastEventSeq: seq,
    lastEventDigest: eventPayload.recordContentDigest,
    createdAt: dispute?.createdAt ?? input.now,
    updatedAt: input.now,
  };

  await deps.disputeRepository.appendEventAndProjection(context, eventPayload, projection);
  const updated = await deps.disputeRepository.getById(context, input.disputeId);
  if (!updated) {
    throw new InvoiceDisputeNotFoundError(input.disputeId);
  }
  return updated;
}

export function createBillingGovernanceService(
  deps: BillingGovernanceServiceDeps,
): BillingGovernanceService {
  return {
    async findOpenDisputeForInvoice(context, invoiceId) {
      return deps.disputeRepository.findOpenByInvoiceId(context, invoiceId);
    },

    async openInvoiceDispute(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const now = input.now ?? new Date();
      const invoice = await deps.invoiceRepository.getById(scoped, input.invoiceId);
      if (!invoice) {
        throw new InvoiceDisputeInvoiceNotFoundError(input.invoiceId);
      }
      if (!isInvoiceDisputable(invoice.status)) {
        throw new InvoiceDisputeInvalidInvoiceStatusError(input.invoiceId, invoice.status);
      }

      const existing = await deps.disputeRepository.findOpenByInvoiceId(scoped, input.invoiceId);
      if (existing) {
        throw new InvoiceDisputeAlreadyOpenError(input.invoiceId);
      }

      const disputeId = crypto.randomUUID();
      const dispute = await appendDisputeEvent(deps, scoped, null, {
        disputeId,
        invoiceId: invoice.id,
        exchangeAccountId: invoice.exchangeAccountId,
        eventType: "OPENED",
        reason: input.reason.trim(),
        actorType: "admin",
        actorId: input.openedBy,
        openedBy: input.openedBy,
        openedAt: now,
        now,
      });

      await deps.writeAudit({
        actorType: "admin",
        actorId: input.openedBy,
        action: traderAuditActions.invoiceDisputeOpened,
        entityType: traderEntityTypes.invoiceDispute,
        entityId: dispute.id,
        organizationId: scoped.organizationId,
        metadata: {
          invoiceId: invoice.id,
          exchangeAccountId: invoice.exchangeAccountId,
          reason: input.reason.trim(),
        },
      });

      return dispute;
    },

    async resolveInvoiceDisputeUpheld(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const now = input.now ?? new Date();
      const dispute = await deps.disputeRepository.getById(scoped, input.disputeId);
      if (!dispute) {
        throw new InvoiceDisputeNotFoundError(input.disputeId);
      }
      if (dispute.status !== "OPEN") {
        throw new InvoiceDisputeNotOpenError(input.disputeId, dispute.status);
      }

      const resolved = await appendDisputeEvent(deps, scoped, dispute, {
        disputeId: dispute.id,
        invoiceId: dispute.invoiceId,
        exchangeAccountId: dispute.exchangeAccountId,
        eventType: "RESOLVED_UPHELD",
        reason: input.resolutionReason.trim(),
        actorType: input.actorType ?? "admin",
        actorId: input.actorId ?? null,
        resolutionReason: input.resolutionReason.trim(),
        now,
      });

      await deps.writeAudit({
        actorType: input.actorType ?? "admin",
        actorId: input.actorId ?? null,
        action: traderAuditActions.invoiceDisputeResolvedUpheld,
        entityType: traderEntityTypes.invoiceDispute,
        entityId: resolved.id,
        organizationId: scoped.organizationId,
        metadata: {
          invoiceId: resolved.invoiceId,
          resolutionReason: input.resolutionReason.trim(),
        },
      });

      return resolved;
    },

    async applyOverchargeCorrection(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const now = input.now ?? new Date();
      if (!input.reason.trim()) {
        throw new InvoiceCorrectionReasonRequiredError();
      }

      const invoice = await deps.invoiceRepository.getById(scoped, input.invoiceId);
      if (!invoice) {
        throw new InvoiceDisputeInvoiceNotFoundError(input.invoiceId);
      }

      const dispute = await deps.disputeRepository.findOpenByInvoiceId(scoped, input.invoiceId);
      if (!dispute) {
        throw new InvoiceDisputeOpenRequiredForCorrectionError(input.invoiceId);
      }

      const hwmRollback = await deps.hwmLedgerService.recordHwmRollback(scoped, {
        exchangeAccountId: invoice.exchangeAccountId,
        restoredHwm: input.restoredHwm,
        sourcePeriodId: invoice.reportingPeriodId,
        reason: input.reason.trim(),
        effectiveAt: now,
      });

      const correctionPayload = buildInvoiceCorrectionPayload({
        organizationId: scoped.organizationId,
        invoiceId: invoice.id,
        disputeId: dispute.id,
        exchangeAccountId: invoice.exchangeAccountId,
        reportingPeriodId: invoice.reportingPeriodId,
        correctionType: input.correctionType,
        amount: input.amount,
        currency: invoice.currency,
        restoredHwm: input.restoredHwm,
        hwmLedgerEntryId: hwmRollback.id,
        reason: input.reason.trim(),
        actorType: input.actorType ?? "admin",
        actorId: input.actorId ?? null,
      });

      const correction = await deps.correctionRepository.insertCorrection(
        scoped,
        correctionPayload,
      );

      const resolvedDispute = await appendDisputeEvent(deps, scoped, dispute, {
        disputeId: dispute.id,
        invoiceId: dispute.invoiceId,
        exchangeAccountId: dispute.exchangeAccountId,
        eventType: "RESOLVED_CORRECTED",
        reason: input.reason.trim(),
        actorType: input.actorType ?? "admin",
        actorId: input.actorId ?? null,
        resolutionReason: input.reason.trim(),
        now,
      });

      await deps.writeAudit({
        actorType: input.actorType ?? "admin",
        actorId: input.actorId ?? null,
        action: traderAuditActions.invoiceCorrectionApplied,
        entityType: traderEntityTypes.invoiceCorrection,
        entityId: correction.id,
        organizationId: scoped.organizationId,
        metadata: {
          invoiceId: invoice.id,
          disputeId: dispute.id,
          correctionType: input.correctionType,
          amount: input.amount,
          restoredHwm: input.restoredHwm,
          hwmLedgerEntryId: hwmRollback.id,
        },
      });

      await deps.writeAudit({
        actorType: input.actorType ?? "admin",
        actorId: input.actorId ?? null,
        action: traderAuditActions.invoiceDisputeResolvedCorrected,
        entityType: traderEntityTypes.invoiceDispute,
        entityId: resolvedDispute.id,
        organizationId: scoped.organizationId,
        metadata: {
          invoiceId: invoice.id,
          correctionId: correction.id,
        },
      });

      return {
        correction,
        dispute: resolvedDispute,
        hwmLedgerEntryId: hwmRollback.id,
      };
    },
  };
}

export function createSqliteBillingGovernanceService(
  db: WaiaDb,
  deps: Partial<BillingGovernanceServiceDeps> = {},
): BillingGovernanceService {
  return createBillingGovernanceService({
    invoiceRepository: deps.invoiceRepository ?? createSqliteInvoiceRepository(db),
    disputeRepository: deps.disputeRepository ?? createSqliteInvoiceDisputeRepository(db),
    correctionRepository: deps.correctionRepository ?? createSqliteInvoiceCorrectionRepository(db),
    hwmLedgerService: deps.hwmLedgerService ?? createSqliteHwmLedgerService(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
  });
}

export function createPostgresBillingGovernanceService(
  ex: Pick<WaiaPostgresDb, "select" | "insert" | "update">,
  deps: Partial<BillingGovernanceServiceDeps> = {},
  db?: WaiaPostgresDb,
): BillingGovernanceService {
  return createBillingGovernanceService({
    invoiceRepository: deps.invoiceRepository ?? createPostgresInvoiceRepository(ex),
    disputeRepository: deps.disputeRepository ?? createPostgresInvoiceDisputeRepository(ex),
    correctionRepository:
      deps.correctionRepository ?? createPostgresInvoiceCorrectionRepository(ex),
    hwmLedgerService: deps.hwmLedgerService ?? createPostgresHwmLedgerService(ex, {}, db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
  });
}
