import "server-only";

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import type { PeriodDisclosureSnapshot } from "@/lib/trader/billing/draft-invoice-service";
import {
  HwmLedgerNotBootstrappedError,
  HwmLedgerRatchetNotAllowedError,
} from "@/lib/trader/billing/hwm-ledger.errors";
import { getCurrentHwmLedgerEntryPostgres } from "@/lib/trader/billing/hwm-ledger-repository-postgres";
import { hwmLedgerPayloadToInsertValues } from "@/lib/trader/billing/hwm-ledger-row-mapper";
import {
  IssuanceConcurrentConflictError,
  IssuanceHwmInconsistentError,
  IssuanceInvoiceNotFoundError,
  IssuanceNotDraftError,
} from "@/lib/trader/billing/invoice-issuance.errors";
import type {
  ExecuteInvoiceIssuanceRepoInput,
  ExecuteInvoiceIssuanceRepoResult,
} from "@/lib/trader/billing/invoice-issuance-repository.types";
import { getInvoiceByIdPostgres } from "@/lib/trader/billing/invoice-repository-postgres";
import { mapInvoiceRow } from "@/lib/trader/billing/invoice-row-mapper";
import type { IssuedInvoiceView } from "@/lib/trader/billing/invoice.types";
import {
  verifyDraftInvoiceCanonicalBinding,
  verifyInvoiceRecordDigest,
} from "@/lib/trader/billing/serialize-invoice";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgIssuanceExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function toIssuedInvoiceView(
  invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceByIdPostgres>>>,
): IssuedInvoiceView {
  if (invoice.status !== "ISSUED" || !invoice.issuedAt) {
    throw new Error("[trader] expected issued invoice view");
  }
  return invoice as IssuedInvoiceView;
}

async function findRatchetBySourceInvoicePostgres(
  ex: PgIssuanceExecutor,
  context: OrgContext,
  sourceInvoiceId: string,
) {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderHwmLedger)
    .where(
      and(
        orgScopedWhere(pgSchema.traderHwmLedger.organizationId, scoped),
        eq(pgSchema.traderHwmLedger.sourceInvoiceId, sourceInvoiceId),
        eq(pgSchema.traderHwmLedger.entryType, "RATCHET_UP"),
      ),
    )
    .limit(1);
  return rows[0];
}

async function buildIdempotentIssuanceResultPostgres(
  ex: PgIssuanceExecutor,
  context: OrgContext,
  invoice: IssuedInvoiceView,
): Promise<ExecuteInvoiceIssuanceRepoResult> {
  const ratchet = await findRatchetBySourceInvoicePostgres(ex, context, invoice.id);
  if (!ratchet) {
    throw new IssuanceHwmInconsistentError(
      invoice.id,
      invoice.previousHighWaterMark,
      "missing ratchet entry",
    );
  }
  return {
    invoice,
    hwmLedgerEntryId: ratchet.id,
    auditLogId: "idempotent",
  };
}

function verifyIssuancePreconditions(
  invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceByIdPostgres>>>,
  input: ExecuteInvoiceIssuanceRepoInput,
  disclosure: PeriodDisclosureSnapshot,
  currentHwmHighWaterMark: string,
): void {
  verifyDraftInvoiceCanonicalBinding(invoice, input.artifact, input.period, disclosure);
  verifyInvoiceRecordDigest(invoice);

  if (currentHwmHighWaterMark !== invoice.previousHighWaterMark) {
    throw new IssuanceHwmInconsistentError(
      invoice.id,
      invoice.previousHighWaterMark,
      currentHwmHighWaterMark,
    );
  }

  if (compareDecimal(input.hwmPayload.highWaterMark, currentHwmHighWaterMark) <= 0) {
    throw new HwmLedgerRatchetNotAllowedError(
      invoice.exchangeAccountId,
      input.hwmPayload.highWaterMark,
      currentHwmHighWaterMark,
    );
  }
}

async function executeInvoiceIssuanceAtomicPostgresInner(
  ex: PgIssuanceExecutor,
  context: OrgContext,
  input: ExecuteInvoiceIssuanceRepoInput,
): Promise<ExecuteInvoiceIssuanceRepoResult> {
  const scoped = requireOrgContext(context.organizationId);
  const invoice = await getInvoiceByIdPostgres(ex, scoped, input.invoiceId);
  if (!invoice) {
    throw new IssuanceInvoiceNotFoundError(input.invoiceId);
  }

  if (invoice.status === "ISSUED") {
    return buildIdempotentIssuanceResultPostgres(ex, scoped, toIssuedInvoiceView(invoice));
  }

  if (invoice.status !== "DRAFT") {
    throw new IssuanceNotDraftError(invoice.id, invoice.status);
  }

  const currentHwm = await getCurrentHwmLedgerEntryPostgres(ex, scoped, invoice.exchangeAccountId);
  if (!currentHwm) {
    throw new HwmLedgerNotBootstrappedError(invoice.exchangeAccountId);
  }

  verifyIssuancePreconditions(invoice, input, input.disclosure, currentHwm.highWaterMark);

  const now = input.issuedAt;
  await ex
    .update(pgSchema.traderInvoices)
    .set({
      status: "ISSUED",
      issuedAt: input.issuedAt,
      issuedBy: input.issuedBy,
      updatedAt: now,
    })
    .where(
      and(
        eq(pgSchema.traderInvoices.id, input.invoiceId),
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
        eq(pgSchema.traderInvoices.status, "DRAFT"),
      ),
    );

  const issuedCheck = await getInvoiceByIdPostgres(ex, scoped, input.invoiceId);
  if (!issuedCheck || issuedCheck.status !== "ISSUED") {
    const raced = await getInvoiceByIdPostgres(ex, scoped, input.invoiceId);
    if (raced?.status === "ISSUED") {
      return buildIdempotentIssuanceResultPostgres(ex, scoped, toIssuedInvoiceView(raced));
    }
    throw new IssuanceConcurrentConflictError(input.invoiceId);
  }

  const hwmLedgerEntryId = crypto.randomUUID();
  const hwmNow = new Date();
  await ex
    .insert(pgSchema.traderHwmLedger)
    .values(
      hwmLedgerPayloadToInsertValues(
        hwmLedgerEntryId,
        scoped.organizationId,
        input.hwmPayload,
        hwmNow,
        hwmNow,
      ),
    );

  const auditLogId = await writeTraderAuditLogPostgres(ex, {
    actorType: "user",
    actorId: input.issuedBy,
    action: traderAuditActions.invoiceIssued,
    entityType: traderEntityTypes.invoice,
    entityId: input.invoiceId,
    organizationId: scoped.organizationId,
    metadata: {
      ...input.auditMetadata,
      hwmLedgerEntryId,
    },
  });

  const issuedRow = await ex
    .select()
    .from(pgSchema.traderInvoices)
    .where(
      and(
        eq(pgSchema.traderInvoices.id, input.invoiceId),
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
      ),
    )
    .limit(1);

  const row = issuedRow[0];
  if (!row) {
    throw new Error("[trader] issued invoice read failed");
  }

  return {
    invoice: toIssuedInvoiceView(mapInvoiceRow(row)),
    hwmLedgerEntryId,
    auditLogId,
  };
}

export function executeInvoiceIssuanceAtomicPostgres(
  ex: PgIssuanceExecutor,
  context: OrgContext,
  input: ExecuteInvoiceIssuanceRepoInput,
): Promise<ExecuteInvoiceIssuanceRepoResult> {
  return executeInvoiceIssuanceAtomicPostgresInner(ex, context, input);
}

export function executeInvoiceIssuanceAtomicPostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: ExecuteInvoiceIssuanceRepoInput,
): Promise<ExecuteInvoiceIssuanceRepoResult> {
  return runWaiaPostgresTransaction(db, (tx) =>
    executeInvoiceIssuanceAtomicPostgresInner(tx, context, input),
  );
}
