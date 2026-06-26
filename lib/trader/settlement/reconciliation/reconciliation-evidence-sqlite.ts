import { and, eq } from "drizzle-orm";

import * as sqliteSchema from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { ReconciliationEvidenceReader } from "@/lib/trader/settlement/reconciliation/reconciliation-evidence.types";
import type { ReconciliationEvidenceSnapshot } from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type SqliteExecutor = Pick<WaiaDb, "select">;

export function createSqliteReconciliationEvidenceReader(
  ex: SqliteExecutor,
): ReconciliationEvidenceReader {
  return {
    async buildEvidence(context, settlement) {
      return buildEvidenceSqlite(ex, context, settlement);
    },
  };
}

async function buildEvidenceSqlite(
  ex: SqliteExecutor,
  context: OrgContext,
  settlement: SettlementRecordView,
): Promise<ReconciliationEvidenceSnapshot> {
  const scoped = requireOrgContext(context.organizationId);

  const paymentRows = await ex
    .select({
      paymentId: sqliteSchema.payments.paymentId,
      settlementNetwork: sqliteSchema.payments.settlementNetwork,
      settlementAsset: sqliteSchema.payments.settlementAsset,
      settlementAmount: sqliteSchema.payments.settlementAmount,
      settlementTxHash: sqliteSchema.payments.settlementTxHash,
      transferIndex: sqliteSchema.payments.transferIndex,
    })
    .from(sqliteSchema.payments)
    .where(
      and(
        orgScopedWhere(sqliteSchema.payments.organizationId, scoped),
        eq(sqliteSchema.payments.paymentId, settlement.paymentId),
      ),
    )
    .limit(1);

  const invoiceRows = await ex
    .select({
      id: sqliteSchema.traderInvoices.id,
      status: sqliteSchema.traderInvoices.status,
      performanceFee: sqliteSchema.traderInvoices.performanceFee,
      periodStart: sqliteSchema.traderInvoices.periodStart,
    })
    .from(sqliteSchema.traderInvoices)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderInvoices.organizationId, scoped),
        eq(sqliteSchema.traderInvoices.exchangeAccountId, settlement.exchangeAccountId),
        eq(sqliteSchema.traderInvoices.status, "ISSUED"),
      ),
    );

  const applicationRows = await ex
    .select({
      id: sqliteSchema.traderSettlementApplications.id,
      invoiceId: sqliteSchema.traderSettlementApplications.invoiceId,
      appliedAmount: sqliteSchema.traderSettlementApplications.appliedAmount,
      applicationSource: sqliteSchema.traderSettlementApplications.applicationSource,
    })
    .from(sqliteSchema.traderSettlementApplications)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderSettlementApplications.organizationId, scoped),
        eq(sqliteSchema.traderSettlementApplications.settlementId, settlement.id),
      ),
    );

  const payment = paymentRows[0] ?? null;

  return {
    settlement: {
      id: settlement.id,
      outcome: settlement.outcome,
      exceptionReason: settlement.exceptionReason,
      valuedAmount: settlement.valuedAmount,
      valuationCurrency: settlement.valuationCurrency,
      settlementNetwork: settlement.settlementNetwork,
      settlementTxHash: settlement.settlementTxHash,
      onChainAmount: settlement.onChainAmount,
      asset: settlement.asset,
      exchangeAccountId: settlement.exchangeAccountId,
      paymentId: settlement.paymentId,
    },
    payment: payment
      ? {
          paymentId: payment.paymentId,
          settlementNetwork: payment.settlementNetwork,
          settlementAsset: payment.settlementAsset,
          settlementAmount: payment.settlementAmount,
          settlementTxHash: payment.settlementTxHash,
          transferIndex: payment.transferIndex,
        }
      : null,
    invoiceCandidates: invoiceRows.map((row) => ({
      id: row.id,
      status: row.status,
      performanceFee: row.performanceFee,
      periodStart: row.periodStart.toISOString(),
    })),
    applications: applicationRows.map((row) => ({
      id: row.id,
      invoiceId: row.invoiceId,
      appliedAmount: row.appliedAmount,
      applicationSource: row.applicationSource,
    })),
  };
}
