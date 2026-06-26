import "server-only";

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ReconciliationEvidenceReader } from "@/lib/trader/settlement/reconciliation/reconciliation-evidence.types";
import type { ReconciliationEvidenceSnapshot } from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select">;

export function createPostgresReconciliationEvidenceReader(
  ex: PgExecutor,
): ReconciliationEvidenceReader {
  return {
    async buildEvidence(context, settlement) {
      return buildEvidencePostgres(ex, context, settlement);
    },
  };
}

async function buildEvidencePostgres(
  ex: PgExecutor,
  context: OrgContext,
  settlement: SettlementRecordView,
): Promise<ReconciliationEvidenceSnapshot> {
  const scoped = requireOrgContext(context.organizationId);

  const paymentRows = await ex
    .select({
      paymentId: pgSchema.payments.paymentId,
      settlementNetwork: pgSchema.payments.settlementNetwork,
      settlementAsset: pgSchema.payments.settlementAsset,
      settlementAmount: pgSchema.payments.settlementAmount,
      settlementTxHash: pgSchema.payments.settlementTxHash,
      transferIndex: pgSchema.payments.transferIndex,
    })
    .from(pgSchema.payments)
    .where(
      and(
        orgScopedWhere(pgSchema.payments.organizationId, scoped),
        eq(pgSchema.payments.paymentId, settlement.paymentId),
      ),
    )
    .limit(1);

  const invoiceRows = await ex
    .select({
      id: pgSchema.traderInvoices.id,
      status: pgSchema.traderInvoices.status,
      performanceFee: pgSchema.traderInvoices.performanceFee,
      periodStart: pgSchema.traderInvoices.periodStart,
    })
    .from(pgSchema.traderInvoices)
    .where(
      and(
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
        eq(pgSchema.traderInvoices.exchangeAccountId, settlement.exchangeAccountId),
        eq(pgSchema.traderInvoices.status, "ISSUED"),
      ),
    );

  const applicationRows = await ex
    .select({
      id: pgSchema.traderSettlementApplications.id,
      invoiceId: pgSchema.traderSettlementApplications.invoiceId,
      appliedAmount: pgSchema.traderSettlementApplications.appliedAmount,
      applicationSource: pgSchema.traderSettlementApplications.applicationSource,
    })
    .from(pgSchema.traderSettlementApplications)
    .where(
      and(
        orgScopedWhere(pgSchema.traderSettlementApplications.organizationId, scoped),
        eq(pgSchema.traderSettlementApplications.settlementId, settlement.id),
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
