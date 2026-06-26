import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import type { SettlementAllocationPolicy } from "@/lib/trader/settlement/allocation-policy";
import { fifoAllocationPolicy } from "@/lib/trader/settlement/allocation-policy";
import {
  createPostgresAccountStatusRepository,
  createPostgresInvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository-postgres";
import {
  createSqliteAccountStatusRepository,
  createSqliteInvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository-sqlite";
import type {
  AccountStatusRepository,
  InvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository.types";
import {
  resolveStatusAfterReactivation,
  shouldAppendReactivationEvent,
} from "@/lib/trader/settlement/account-status.transitions";
import { SettlementAlreadyExistsError } from "@/lib/trader/settlement/settlement.errors";
import { evaluateSettlement } from "@/lib/trader/settlement/settlement-matching";
import { createPostgresSettlementApplicationsRepository } from "@/lib/trader/settlement/settlement-applications-repository-postgres";
import { createSqliteSettlementApplicationsRepository } from "@/lib/trader/settlement/settlement-applications-repository-sqlite";
import { createPostgresSettlementsRepository } from "@/lib/trader/settlement/settlements-repository-postgres";
import { createSqliteSettlementsRepository } from "@/lib/trader/settlement/settlements-repository-sqlite";
import type {
  SettlementApplicationsRepository,
  SettlementsRepository,
} from "@/lib/trader/settlement/settlements-repository.types";
import {
  buildAccountStatusEventPayload,
  buildSettlementApplicationPayload,
  buildSettlementRecordPayload,
} from "@/lib/trader/settlement/serialize-settlement";
import type {
  ConfirmedPaymentForSettlement,
  SettlementRecordView,
} from "@/lib/trader/settlement/settlement.types";
import { settlementExceptionReasons } from "@/lib/trader/settlement/settlement.types";
import type { SettlementValuationPolicy } from "@/lib/trader/settlement/valuation-policy";
import { parityUsdtUsdValuation } from "@/lib/trader/settlement/valuation-policy";
import { isUniqueConstraintError } from "@/lib/trader/execution/order-repository.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type SettlementServiceDeps = {
  settlementsRepository: SettlementsRepository;
  settlementApplicationsRepository: SettlementApplicationsRepository;
  accountStatusRepository: AccountStatusRepository;
  invoiceSettlementRepository: InvoiceSettlementRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  allocationPolicy?: SettlementAllocationPolicy;
  valuationPolicy?: SettlementValuationPolicy;
  amountTolerance?: string;
  runAtomic?: <T>(fn: (atomicDeps: SettlementServiceDeps) => Promise<T>) => Promise<T>;
  now?: () => Date;
};

export type SettlementService = {
  applySettlementForPayment(
    context: OrgContext,
    payment: ConfirmedPaymentForSettlement,
  ): Promise<SettlementRecordView>;
};

function isSettlementUniqueViolation(error: unknown): boolean {
  if (error instanceof SettlementAlreadyExistsError) {
    return true;
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") {
      return true;
    }
  }
  if (isUniqueConstraintError(error)) {
    return true;
  }
  if (error && typeof error === "object" && "message" in error) {
    return /UNIQUE constraint failed/i.test(String((error as { message: unknown }).message));
  }
  return false;
}

async function appendReactivationIfNeeded(
  deps: SettlementServiceDeps,
  context: OrgContext,
  exchangeAccountId: string,
  paymentId: string,
  invoiceId: string,
  now: Date,
): Promise<void> {
  const current = await deps.accountStatusRepository.getProjection(context, exchangeAccountId);
  if (!shouldAppendReactivationEvent(current?.status ?? null)) {
    return;
  }

  const events = await deps.accountStatusRepository.listEventsForAccount(
    context,
    exchangeAccountId,
  );
  const lastEvent = events.at(-1) ?? null;
  const seq = (lastEvent?.seq ?? 0) + 1;
  const eventPayload = buildAccountStatusEventPayload({
    organizationId: context.organizationId,
    exchangeAccountId,
    seq,
    eventType: "REACTIVATED",
    reason: "confirmed_settlement",
    sourcePaymentId: paymentId,
    sourceInvoiceId: invoiceId,
    prevEventDigest: lastEvent?.recordContentDigest ?? null,
  });

  const projection = {
    organizationId: context.organizationId,
    exchangeAccountId,
    status: resolveStatusAfterReactivation(),
    reason: "confirmed_settlement",
    lastEventSeq: seq,
    lastEventDigest: eventPayload.recordContentDigest,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  await deps.accountStatusRepository.appendEventAndProjection(context, eventPayload, projection);
  await deps.writeAudit({
    actorType: "service",
    actorId: null,
    action: traderAuditActions.accountReactivated,
    entityType: traderEntityTypes.accountStatus,
    entityId: exchangeAccountId,
    organizationId: context.organizationId,
    metadata: {
      paymentId,
      invoiceId,
      previousStatus: current?.status ?? null,
    },
  });
}

async function applySettlementInner(
  deps: SettlementServiceDeps,
  context: OrgContext,
  payment: ConfirmedPaymentForSettlement,
): Promise<SettlementRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  const now = deps.now?.() ?? new Date();
  const allocationPolicy = deps.allocationPolicy ?? fifoAllocationPolicy;
  const valuationPolicy = deps.valuationPolicy ?? parityUsdtUsdValuation;

  const existing = await deps.settlementsRepository.findByPaymentId(payment.paymentId);
  if (existing) {
    return existing;
  }

  const exchangeAccountId = payment.exchangeAccountId?.trim();
  const candidates = exchangeAccountId
    ? await deps.invoiceSettlementRepository.listIssuedInvoicesForAccount(scoped, exchangeAccountId)
    : [];

  let evaluation = evaluateSettlement({
    payment,
    candidates,
    amountTolerance: deps.amountTolerance,
    allocationPolicy,
    valuationPolicy,
  });

  if (evaluation.outcome === "APPLIED" && evaluation.invoiceId) {
    const locked = await deps.invoiceSettlementRepository.getInvoiceForSettlementLock(
      scoped,
      evaluation.invoiceId,
    );
    if (!locked) {
      evaluation = {
        ...evaluation,
        outcome: "EXCEPTION",
        exceptionReason: settlementExceptionReasons.invoiceNotFound,
        appliedAmount: null,
      };
    } else if (locked.status !== "ISSUED") {
      evaluation = {
        ...evaluation,
        outcome: "EXCEPTION",
        exceptionReason: settlementExceptionReasons.invoiceNotIssued,
        appliedAmount: null,
      };
    } else if (locked.organizationId !== scoped.organizationId) {
      evaluation = {
        ...evaluation,
        outcome: "EXCEPTION",
        exceptionReason: settlementExceptionReasons.invoiceNotFound,
        appliedAmount: null,
      };
    }
  }

  const settlementPayload = buildSettlementRecordPayload({
    organizationId: scoped.organizationId,
    exchangeAccountId: evaluation.exchangeAccountId,
    paymentId: payment.paymentId,
    settlementNetwork: payment.settlementNetwork,
    settlementTxHash: payment.settlementTxHash,
    transferIndex: payment.transferIndex,
    blockHeight: payment.blockHeight,
    asset: payment.settlementAsset,
    onChainAmount: payment.settlementAmount,
    valuedAmount: evaluation.valuedAmount,
    valuationCurrency: evaluation.valuationCurrency,
    valuationBasis: evaluation.valuationBasis,
    outcome: evaluation.outcome,
    exceptionReason: evaluation.exceptionReason,
    prevEventDigest: null,
  });

  let settlement: SettlementRecordView;
  try {
    settlement = await deps.settlementsRepository.insertSettlement(scoped, settlementPayload);
  } catch (error) {
    if (isSettlementUniqueViolation(error)) {
      const raced = await deps.settlementsRepository.findByPaymentId(payment.paymentId);
      if (raced) {
        return raced;
      }
    }
    throw error;
  }

  if (evaluation.outcome === "EXCEPTION") {
    await deps.writeAudit({
      actorType: "service",
      actorId: null,
      action: traderAuditActions.settlementException,
      entityType: traderEntityTypes.settlement,
      entityId: settlement.id,
      organizationId: scoped.organizationId,
      metadata: {
        paymentId: payment.paymentId,
        exceptionReason: evaluation.exceptionReason,
        exchangeAccountId: evaluation.exchangeAccountId,
      },
    });
    return settlement;
  }

  const applicationPayload = buildSettlementApplicationPayload({
    settlementId: settlement.id,
    organizationId: scoped.organizationId,
    invoiceId: evaluation.invoiceId!,
    appliedAmount: evaluation.appliedAmount!,
    invoiceStatusAfter: "PAID",
  });

  await deps.settlementApplicationsRepository.insertApplication(scoped, applicationPayload);
  await deps.invoiceSettlementRepository.markInvoicePaid(scoped, {
    invoiceId: evaluation.invoiceId!,
    settledAmount: evaluation.appliedAmount!,
    paidAt: now,
  });
  await appendReactivationIfNeeded(
    deps,
    scoped,
    evaluation.exchangeAccountId,
    payment.paymentId,
    evaluation.invoiceId!,
    now,
  );

  await deps.writeAudit({
    actorType: "service",
    actorId: null,
    action: traderAuditActions.settlementApplied,
    entityType: traderEntityTypes.settlement,
    entityId: settlement.id,
    organizationId: scoped.organizationId,
    metadata: {
      paymentId: payment.paymentId,
      invoiceId: evaluation.invoiceId,
      appliedAmount: evaluation.appliedAmount,
    },
  });
  await deps.writeAudit({
    actorType: "service",
    actorId: null,
    action: traderAuditActions.invoicePaid,
    entityType: traderEntityTypes.invoice,
    entityId: evaluation.invoiceId!,
    organizationId: scoped.organizationId,
    metadata: {
      paymentId: payment.paymentId,
      settlementId: settlement.id,
      settledAmount: evaluation.appliedAmount,
    },
  });

  return settlement;
}

export function createSettlementService(deps: SettlementServiceDeps): SettlementService {
  const runAtomic =
    deps.runAtomic ??
    (async <T>(fn: (atomicDeps: SettlementServiceDeps) => Promise<T>) => fn(deps));

  return {
    applySettlementForPayment(context, payment) {
      return runAtomic((atomicDeps) => applySettlementInner(atomicDeps, context, payment));
    },
  };
}

export function createSqliteSettlementService(
  db: WaiaDb,
  overrides: Partial<SettlementServiceDeps> = {},
): SettlementService {
  const buildDeps = (): SettlementServiceDeps => ({
    settlementsRepository: overrides.settlementsRepository ?? createSqliteSettlementsRepository(db),
    settlementApplicationsRepository:
      overrides.settlementApplicationsRepository ??
      createSqliteSettlementApplicationsRepository(db),
    accountStatusRepository:
      overrides.accountStatusRepository ?? createSqliteAccountStatusRepository(db),
    invoiceSettlementRepository:
      overrides.invoiceSettlementRepository ?? createSqliteInvoiceSettlementRepository(db),
    writeAudit: overrides.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    allocationPolicy: overrides.allocationPolicy,
    valuationPolicy: overrides.valuationPolicy,
    amountTolerance: overrides.amountTolerance,
    now: overrides.now,
  });

  return createSettlementService({
    ...buildDeps(),
    runAtomic: async (fn) => fn(buildDeps()),
  });
}

export function createPostgresSettlementService(
  ex: Pick<WaiaPostgresDb, "select" | "insert" | "update">,
  overrides: Partial<SettlementServiceDeps> = {},
  db?: WaiaPostgresDb,
): SettlementService {
  const buildDeps = (
    executor: Pick<WaiaPostgresDb, "select" | "insert" | "update">,
  ): SettlementServiceDeps => ({
    settlementsRepository:
      overrides.settlementsRepository ?? createPostgresSettlementsRepository(executor),
    settlementApplicationsRepository:
      overrides.settlementApplicationsRepository ??
      createPostgresSettlementApplicationsRepository(executor),
    accountStatusRepository:
      overrides.accountStatusRepository ?? createPostgresAccountStatusRepository(executor),
    invoiceSettlementRepository:
      overrides.invoiceSettlementRepository ?? createPostgresInvoiceSettlementRepository(executor),
    writeAudit: overrides.writeAudit ?? ((input) => writeTraderAuditLogPostgres(executor, input)),
    allocationPolicy: overrides.allocationPolicy,
    valuationPolicy: overrides.valuationPolicy,
    amountTolerance: overrides.amountTolerance,
    now: overrides.now,
  });

  return createSettlementService({
    ...buildDeps(ex),
    runAtomic: async (fn) => {
      if (!db) {
        return fn(buildDeps(ex));
      }
      return runWaiaPostgresTransaction(db, (tx) => fn(buildDeps(tx)));
    },
  });
}
