import "server-only";
import type { TransactionSql } from "postgres";
import type { AccountObservation } from "./types";
import { financialHistoryCoverageSchema, financialHistoryRecordSchema } from "./financial-history";

/** Called only inside commitIfCurrent after the DB-time payload selection. All rows
 * roll back with lease/publication failure, including the optional expiry retry. */
export async function appendFinancialHistory(
  tx: TransactionSql,
  actual: AccountObservation,
): Promise<void> {
  const v5 = actual.htxV5;
  if (v5?.schemaVersion !== "htx-v5-observation/v2") return;
  const bills = v5.bills,
    b = actual.binding;
  const provenance = {
    binding: b,
    observationId: actual.observationId,
    scopeId: bills.scopeId,
    windowStartMs: bills.windowStartMs,
    windowEndMs: bills.windowEndMs,
    validFromMs: bills.validFromMs,
    validUntilMs: bills.validUntilMs,
    collectionCompletedAtMs: actual.collectionCompletedAtMs,
  };
  const coverage = financialHistoryCoverageSchema.parse({
    htxUid: v5.htxUid,
    provenance,
    status: bills.status,
    readStartedAtMs: bills.readStartedAtMs,
    responseReceivedAtMs: bills.responseReceivedAtMs,
    readCompletedAtMs: bills.readCompletedAtMs,
    responseGeneratedAtMs: bills.responseGeneratedAtMs,
    pageSize: 100,
    pagesRead: bills.pageScope?.pagesRead ?? null,
    nextFrom: bills.pageScope?.nextFrom ?? null,
    observedRowCount: bills.values?.length ?? null,
    completeness: "UNKNOWN",
    windowConvention: bills.windowConvention,
    error: bills.error,
    unavailableReason: bills.unavailableReason,
  });
  await tx`INSERT INTO public.trader_account_financial_coverage
    (organization_id, credential_id, exchange_account_id, observation_id, htx_uid, scope_id,
      window_start_ms, window_end_ms, collection_completed_ms, provenance, coverage)
    VALUES (${b.organizationId}, ${b.credentialId}, ${b.exchangeAccountId}, ${actual.observationId}, ${v5.htxUid},
      ${bills.scopeId}, ${bills.windowStartMs}, ${bills.windowEndMs}, ${actual.collectionCompletedAtMs},
      ${tx.json(provenance)}, ${tx.json(coverage)})`;
  if (bills.status !== "PARTIAL") return;
  const records = (bills.values ?? []).map((bill) =>
    financialHistoryRecordSchema.parse({ htxUid: v5.htxUid, bill, provenance }),
  );
  if (!records.length) return;
  const normalized = tx.json(records.map((record) => record.bill));
  // Two bounded statements for the entire page, including all-duplicate windows.
  await tx`INSERT INTO public.trader_account_financial_bills
    (organization_id, credential_id, exchange_account_id, observation_id, htx_uid,
      provider_bill_id, created_time_ms, bill, provenance)
    SELECT ${b.organizationId}, ${b.credentialId}, ${b.exchangeAccountId}, ${actual.observationId},
      ${v5.htxUid}, value->>'id', (value->>'createdTimeMs')::bigint, value, ${tx.json(provenance)}
    FROM jsonb_array_elements(${normalized}::jsonb)
    ON CONFLICT (organization_id, credential_id, exchange_account_id, htx_uid, provider_bill_id) DO NOTHING`;
  // JSONB ignores object-key order but preserves the exact raw decimal strings.
  const checked = await tx`SELECT count(*)::int AS matched
    FROM jsonb_array_elements(${normalized}::jsonb) incoming
    JOIN public.trader_account_financial_bills stored
      ON stored.organization_id=${b.organizationId} AND stored.credential_id=${b.credentialId}
      AND stored.exchange_account_id=${b.exchangeAccountId} AND stored.htx_uid=${v5.htxUid}
      AND stored.provider_bill_id=incoming.value->>'id'
      AND stored.created_time_ms=(incoming.value->>'createdTimeMs')::bigint
      AND stored.bill=incoming.value`;
  if (checked.length !== 1 || checked[0].matched !== records.length)
    throw new Error("FINANCIAL_BILL_IMMUTABLE_CONFLICT");
}
