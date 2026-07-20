import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

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
  applySettlementApplication,
  type ApplySettlementApplicationDeps,
} from "@/lib/trader/settlement/apply-settlement-application";
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
import {
  createCaseOnExceptionFromSettlement,
  type CreateCaseDeps,
} from "@/lib/trader/settlement/reconciliation/create-case";
import { createPostgresReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-postgres";
import { createSqliteReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-sqlite";
import { createPostgresReconciliationEvidenceReader } from "@/lib/trader/settlement/reconciliation/reconciliation-evidence-postgres";
import { createSqliteReconciliationEvidenceReader } from "@/lib/trader/settlement/reconciliation/reconciliation-evidence-sqlite";
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
  createCaseOnException?: (
    context: OrgContext,
    settlement: SettlementRecordView,
    input: { exceptionReason: string | null; exchangeAccountId: string },
  ) => Promise<void>;
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
    if (deps.createCaseOnException) {
      await deps.createCaseOnException(scoped, settlement, {
        exceptionReason: evaluation.exceptionReason,
        exchangeAccountId: evaluation.exchangeAccountId,
      });
    }
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

  const applyDeps: ApplySettlementApplicationDeps = {
    settlementApplicationsRepository: deps.settlementApplicationsRepository,
    invoiceSettlementRepository: deps.invoiceSettlementRepository,
    accountStatusRepository: deps.accountStatusRepository,
    writeAudit: deps.writeAudit,
  };

  await applySettlementApplication(applyDeps, scoped, {
    applicationPayload,
    applicationSource: "AUTO",
    paymentId: payment.paymentId,
    exchangeAccountId: evaluation.exchangeAccountId,
    now,
  });

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

function buildCreateCaseDepsFromExecutor(
  executor: Pick<WaiaPostgresDb, "select" | "insert" | "update">,
  writeAudit: (input: TraderAuditInput) => string | Promise<string>,
): CreateCaseDeps {
  return {
    caseRepository: createPostgresReconciliationCaseRepository(executor),
    evidenceReader: createPostgresReconciliationEvidenceReader(executor),
    writeAudit,
  };
}

function buildCreateCaseDepsFromSqlite(
  db: WaiaDb,
  writeAudit: (input: TraderAuditInput) => string | Promise<string>,
): CreateCaseDeps {
  return {
    caseRepository: createSqliteReconciliationCaseRepository(db),
    evidenceReader: createSqliteReconciliationEvidenceReader(db),
    writeAudit,
  };
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
  const buildDeps = (): SettlementServiceDeps => {
    const writeAudit = overrides.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input));
    return {
      settlementsRepository:
        overrides.settlementsRepository ?? createSqliteSettlementsRepository(db),
      settlementApplicationsRepository:
        overrides.settlementApplicationsRepository ??
        createSqliteSettlementApplicationsRepository(db),
      accountStatusRepository:
        overrides.accountStatusRepository ?? createSqliteAccountStatusRepository(db),
      invoiceSettlementRepository:
        overrides.invoiceSettlementRepository ?? createSqliteInvoiceSettlementRepository(db),
      writeAudit,
      allocationPolicy: overrides.allocationPolicy,
      valuationPolicy: overrides.valuationPolicy,
      amountTolerance: overrides.amountTolerance,
      now: overrides.now,
      createCaseOnException:
        overrides.createCaseOnException ??
        (async (context, settlement) => {
          await createCaseOnExceptionFromSettlement(
            buildCreateCaseDepsFromSqlite(db, writeAudit),
            context,
            settlement,
          );
        }),
    };
  };

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
  ): SettlementServiceDeps => {
    const writeAudit =
      overrides.writeAudit ?? ((input) => writeTraderAuditLogPostgres(executor, input));
    return {
      settlementsRepository:
        overrides.settlementsRepository ?? createPostgresSettlementsRepository(executor),
      settlementApplicationsRepository:
        overrides.settlementApplicationsRepository ??
        createPostgresSettlementApplicationsRepository(executor),
      accountStatusRepository:
        overrides.accountStatusRepository ?? createPostgresAccountStatusRepository(executor),
      invoiceSettlementRepository:
        overrides.invoiceSettlementRepository ??
        createPostgresInvoiceSettlementRepository(executor),
      writeAudit,
      allocationPolicy: overrides.allocationPolicy,
      valuationPolicy: overrides.valuationPolicy,
      amountTolerance: overrides.amountTolerance,
      now: overrides.now,
      createCaseOnException:
        overrides.createCaseOnException ??
        (async (context, settlement) => {
          await createCaseOnExceptionFromSettlement(
            buildCreateCaseDepsFromExecutor(executor, writeAudit),
            context,
            settlement,
          );
        }),
    };
  };

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
