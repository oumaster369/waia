import "server-only";

import { and, eq } from "drizzle-orm";

import { traderHwmLedger, traderInvoices } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { runSqliteTransaction } from "@/db/types";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  extractPeriodDisclosure,
  type PeriodDisclosureSnapshot,
} from "@/lib/trader/billing/draft-invoice-service";
import {
  HwmLedgerNotBootstrappedError,
  HwmLedgerRatchetNotAllowedError,
} from "@/lib/trader/billing/hwm-ledger.errors";
import { getCurrentHwmLedgerEntrySqlite } from "@/lib/trader/billing/hwm-ledger-repository-sqlite";
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
import { getInvoiceByIdSqlite } from "@/lib/trader/billing/invoice-repository-sqlite";
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

function toIssuedInvoiceView(
  invoice: NonNullable<ReturnType<typeof getInvoiceByIdSqlite>>,
): IssuedInvoiceView {
  if (invoice.status !== "ISSUED" || !invoice.issuedAt) {
    throw new Error("[trader] expected issued invoice view");
  }
  return invoice as IssuedInvoiceView;
}

function findRatchetBySourceInvoiceSqlite(
  db: WaiaDb,
  context: OrgContext,
  sourceInvoiceId: string,
) {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderHwmLedger)
    .where(
      and(
        orgScopedWhere(traderHwmLedger.organizationId, scoped),
        eq(traderHwmLedger.sourceInvoiceId, sourceInvoiceId),
        eq(traderHwmLedger.entryType, "RATCHET_UP"),
      ),
    )
    .limit(1)
    .all()[0];
}

function buildIdempotentIssuanceResultSqlite(
  db: WaiaDb,
  context: OrgContext,
  invoice: IssuedInvoiceView,
): ExecuteInvoiceIssuanceRepoResult {
  const ratchet = findRatchetBySourceInvoiceSqlite(db, context, invoice.id);
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
  invoice: NonNullable<ReturnType<typeof getInvoiceByIdSqlite>>,
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

export async function executeInvoiceIssuanceAtomicSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: ExecuteInvoiceIssuanceRepoInput,
): Promise<ExecuteInvoiceIssuanceRepoResult> {
  return runSqliteTransaction(db, (tx) => {
    const scoped = requireOrgContext(context.organizationId);
    const invoice = getInvoiceByIdSqlite(tx, scoped, input.invoiceId);
    if (!invoice) {
      throw new IssuanceInvoiceNotFoundError(input.invoiceId);
    }

    if (invoice.status === "ISSUED") {
      return buildIdempotentIssuanceResultSqlite(tx, scoped, toIssuedInvoiceView(invoice));
    }

    if (invoice.status !== "DRAFT") {
      throw new IssuanceNotDraftError(invoice.id, invoice.status);
    }

    const disclosure = input.disclosure;
    const currentHwm = getCurrentHwmLedgerEntrySqlite(tx, scoped, invoice.exchangeAccountId);
    if (!currentHwm) {
      throw new HwmLedgerNotBootstrappedError(invoice.exchangeAccountId);
    }

    verifyIssuancePreconditions(invoice, input, disclosure, currentHwm.highWaterMark);

    const now = input.issuedAt;
    const updated = tx
      .update(traderInvoices)
      .set({
        status: "ISSUED",
        issuedAt: input.issuedAt,
        issuedBy: input.issuedBy,
        updatedAt: now,
      })
      .where(
        and(
          eq(traderInvoices.id, input.invoiceId),
          orgScopedWhere(traderInvoices.organizationId, scoped),
          eq(traderInvoices.status, "DRAFT"),
        ),
      )
      .run();

    if (updated.changes === 0) {
      const raced = getInvoiceByIdSqlite(tx, scoped, input.invoiceId);
      if (raced?.status === "ISSUED") {
        return buildIdempotentIssuanceResultSqlite(tx, scoped, toIssuedInvoiceView(raced));
      }
      throw new IssuanceConcurrentConflictError(input.invoiceId);
    }

    const hwmLedgerEntryId = crypto.randomUUID();
    const hwmNow = new Date();
    tx.insert(traderHwmLedger)
      .values(
        hwmLedgerPayloadToInsertValues(
          hwmLedgerEntryId,
          scoped.organizationId,
          input.hwmPayload,
          hwmNow,
          hwmNow,
        ),
      )
      .run();

    const auditLogId = writeTraderAuditLogSqlite(tx, {
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

    const issuedRow = tx
      .select()
      .from(traderInvoices)
      .where(
        and(
          eq(traderInvoices.id, input.invoiceId),
          orgScopedWhere(traderInvoices.organizationId, scoped),
        ),
      )
      .limit(1)
      .all()[0];

    if (!issuedRow) {
      throw new Error("[trader] issued invoice read failed");
    }

    return {
      invoice: toIssuedInvoiceView(mapInvoiceRow(issuedRow)),
      hwmLedgerEntryId,
      auditLogId,
    };
  });
}

/** Re-export for tests that need disclosure extraction in issuance repo parity checks. */
export { extractPeriodDisclosure };
