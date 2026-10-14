import "server-only";
import type { TransactionSql } from "postgres";
import {
  financialHistoryRequestSchema,
  financialHistoryResponseSchema,
  financialHistoryRecordSchema,
  financialHistoryCoverageSchema,
  type FinancialHistoryRequest,
  type FinancialHistoryResponse,
} from "./financial-history";
import {
  decodeFinancialHistoryCursor,
  encodeFinancialHistoryCursor,
} from "./financial-history-cursor";
import { parseAccountObservation, sameObservationBinding } from "./validation";

/** Caller supplies a read-only repeatable-read scoped transaction. No provider/credential reads. */
export async function readPersistedFinancialHistory(
  tx: TransactionSql,
  input: FinancialHistoryRequest,
  cursorKey: Uint8Array,
): Promise<FinancialHistoryResponse | null> {
  const request = financialHistoryRequestSchema.parse(input),
    b = request.binding;
  const current = await tx`SELECT o.observation_id, o.payload, state.symbols,
      floor(extract(epoch from clock_timestamp()) * 1000)::text AS now_ms, pg_current_snapshot()::text AS snapshot
    FROM public.exchange_credentials c JOIN public.trader_account_collection_state state
      ON state.organization_id=c.organization_id AND state.credential_id=c.id AND state.exchange_account_id=c.exchange_account_id
    JOIN public.trader_account_observations o
      ON o.organization_id=state.organization_id AND o.credential_id=state.credential_id
      AND o.exchange_account_id=state.exchange_account_id AND o.observation_id=state.last_observation_id
    WHERE c.organization_id=${b.organizationId} AND c.id=${b.credentialId}
      AND c.exchange_account_id=${b.exchangeAccountId} AND c.venue='htx' AND c.status='active'
      AND c.observation_revision::text=${b.credentialRevision} AND state.configuration_revision=${b.configurationRevision}
      AND o.credential_revision=c.observation_revision AND o.configuration_revision=state.configuration_revision`;
  if (current.length !== 1) return null;
  const o = parseAccountObservation(current[0].payload);
  if (
    !sameObservationBinding(o.binding, b) ||
    o.observationId !== current[0].observation_id ||
    JSON.stringify(o.trades.map((t) => t.symbol)) !== JSON.stringify(current[0].symbols)
  )
    throw new Error("FINANCIAL_HISTORY_CURRENT_INVALID");
  const uid = o.htxV5?.htxUid;
  if (!uid) return null;
  const cursor = decodeFinancialHistoryCursor(
    request,
    uid,
    Number(current[0].now_ms),
    cursorKey,
    current[0].snapshot,
  );
  const { windowStartMs: start, windowEndMs: end } = request.filters;
  const sourceProvenance = tx`jsonb_build_object('binding', source.payload->'binding',
    'observationId', source.observation_id::text, 'scopeId', source.payload#>'{htxV5,bills,scopeId}',
    'windowStartMs', source.payload#>'{htxV5,bills,windowStartMs}', 'windowEndMs', source.payload#>'{htxV5,bills,windowEndMs}',
    'validFromMs', source.payload#>'{htxV5,bills,validFromMs}', 'validUntilMs', source.payload#>'{htxV5,bills,validUntilMs}',
    'collectionCompletedAtMs', source.payload->'collectionCompletedAtMs')`;
  const sourceIdentity = tx`source.credential_revision::text=source.payload#>>'{binding,credentialRevision}'
    AND source.configuration_revision=source.payload#>>'{binding,configurationRevision}'
    AND source.organization_id::text=source.payload#>>'{binding,organizationId}'
    AND source.credential_id::text=source.payload#>>'{binding,credentialId}'
    AND source.exchange_account_id=source.payload#>>'{binding,exchangeAccountId}'
    AND f.htx_uid=source.payload#>>'{htxV5,htxUid}' AND f.provenance=${sourceProvenance}`;
  const bills = cursor.billsDone
    ? []
    : await tx`SELECT f.bill, f.provenance, f.htx_uid,
      f.provider_bill_id, f.created_time_ms::text, f.observation_id,
      (${sourceIdentity} AND source.payload#>>'{htxV5,bills,status}'='PARTIAL'
        AND source.payload#>'{htxV5,bills,values}' @> jsonb_build_array(f.bill)) AS source_valid
    FROM public.trader_account_financial_bills f JOIN public.trader_account_observations source
      ON source.organization_id=f.organization_id AND source.credential_id=f.credential_id
      AND source.exchange_account_id=f.exchange_account_id AND source.observation_id=f.observation_id
    WHERE f.organization_id=${b.organizationId} AND f.credential_id=${b.credentialId} AND f.exchange_account_id=${b.exchangeAccountId}
      AND f.htx_uid=${uid} AND pg_visible_in_snapshot(f.recorded_xid, ${cursor.snapshot}::pg_snapshot)
      AND (${start}::bigint IS NULL OR f.created_time_ms >= ${start})
      AND (${end}::bigint IS NULL OR f.created_time_ms < ${end})
      AND (${cursor.bills === null} OR (f.created_time_ms, f.provider_bill_id COLLATE "C") >
        (${cursor.bills?.time ?? 0}::bigint, ${cursor.bills?.id ?? ""}::text COLLATE "C"))
    ORDER BY f.created_time_ms, f.provider_bill_id COLLATE "C" LIMIT ${request.pageSize + 1}`;
  const facts = cursor.coverageDone
    ? []
    : await tx`SELECT f.coverage, f.provenance, f.htx_uid, f.observation_id,
      f.scope_id, f.window_start_ms::text, f.window_end_ms::text, f.collection_completed_ms::text,
      (${sourceIdentity} AND f.coverage - 'provenance' - 'htxUid' = jsonb_build_object(
        'status', source.payload#>'{htxV5,bills,status}',
        'readStartedAtMs', source.payload#>'{htxV5,bills,readStartedAtMs}',
        'responseReceivedAtMs', source.payload#>'{htxV5,bills,responseReceivedAtMs}',
        'readCompletedAtMs', source.payload#>'{htxV5,bills,readCompletedAtMs}',
        'responseGeneratedAtMs', source.payload#>'{htxV5,bills,responseGeneratedAtMs}',
        'pageSize', 100, 'pagesRead', coalesce(source.payload#>'{htxV5,bills,pageScope,pagesRead}', 'null'::jsonb),
        'nextFrom', coalesce(source.payload#>'{htxV5,bills,pageScope,nextFrom}', 'null'::jsonb),
        'observedRowCount', CASE WHEN source.payload#>>'{htxV5,bills,status}'='PARTIAL'
          THEN to_jsonb(jsonb_array_length(source.payload#>'{htxV5,bills,values}')) ELSE 'null'::jsonb END,
        'completeness', 'UNKNOWN', 'windowConvention', 'START_INCLUSIVE_END_EXCLUSIVE',
        'error', source.payload#>'{htxV5,bills,error}', 'unavailableReason', source.payload#>'{htxV5,bills,unavailableReason}')) AS source_valid
    FROM public.trader_account_financial_coverage f JOIN public.trader_account_observations source
      ON source.organization_id=f.organization_id AND source.credential_id=f.credential_id
      AND source.exchange_account_id=f.exchange_account_id AND source.observation_id=f.observation_id
    WHERE f.organization_id=${b.organizationId} AND f.credential_id=${b.credentialId} AND f.exchange_account_id=${b.exchangeAccountId}
      AND f.htx_uid=${uid} AND pg_visible_in_snapshot(f.recorded_xid, ${cursor.snapshot}::pg_snapshot)
      AND (${start}::bigint IS NULL OR f.window_end_ms > ${start})
      AND (${end}::bigint IS NULL OR f.window_start_ms < ${end})
      AND (${cursor.coverage === null} OR (f.collection_completed_ms, f.observation_id) >
        (${cursor.coverage?.time ?? 0}::bigint, ${cursor.coverage?.id ?? "00000000-0000-0000-0000-000000000000"}::uuid))
    ORDER BY f.collection_completed_ms, f.observation_id LIMIT ${request.pageSize + 1}`;
  // Validate even the lookahead row: it controls cursor creation. Payload fields
  // cannot replace physical keys or invent the originating observation/window.
  const validatedBills = bills.map((row) => {
    const record = financialHistoryRecordSchema.parse({
      htxUid: row.htx_uid,
      bill: row.bill,
      provenance: row.provenance,
    });
    if (
      row.source_valid !== true ||
      record.bill.id !== row.provider_bill_id ||
      String(record.bill.createdTimeMs) !== row.created_time_ms ||
      record.provenance.observationId !== row.observation_id
    )
      throw new Error("FINANCIAL_HISTORY_STORED_RECORD_INVALID");
    return record;
  });
  const validatedFacts = facts.map((row) => {
    const fact = financialHistoryCoverageSchema.parse(row.coverage),
      p = fact.provenance;
    if (
      row.source_valid !== true ||
      fact.htxUid !== row.htx_uid ||
      p.observationId !== row.observation_id ||
      p.scopeId !== row.scope_id ||
      String(p.windowStartMs) !== row.window_start_ms ||
      String(p.windowEndMs) !== row.window_end_ms ||
      String(p.collectionCompletedAtMs) !== row.collection_completed_ms ||
      JSON.stringify(p) !==
        JSON.stringify(
          financialHistoryCoverageSchema.parse({ ...row.coverage, provenance: row.provenance })
            .provenance,
        )
    )
      throw new Error("FINANCIAL_HISTORY_STORED_COVERAGE_INVALID");
    return fact;
  });
  const records = validatedBills.slice(0, request.pageSize),
    coverage = validatedFacts.slice(0, request.pageSize);
  const lastBill = records.at(-1)?.bill,
    lastFact = coverage.at(-1)?.provenance;
  const next = {
    ...cursor,
    bills: lastBill ? { time: lastBill.createdTimeMs, id: lastBill.id } : cursor.bills,
    coverage: lastFact
      ? { time: lastFact.collectionCompletedAtMs, id: lastFact.observationId }
      : cursor.coverage,
    billsDone: bills.length <= request.pageSize,
    coverageDone: facts.length <= request.pageSize,
  };
  return financialHistoryResponseSchema.parse({
    binding: b,
    htxUid: uid,
    currentFinancialStatus:
      o.htxV5?.schemaVersion === "htx-v5-observation/v2" ? o.htxV5.bills.status : "NOT_CONFIGURED",
    records,
    coverage,
    nextCursor:
      next.billsDone && next.coverageDone ? null : encodeFinancialHistoryCursor(next, cursorKey),
    source: "PERSISTED_COLLECTOR_RECORDS_ONLY",
    providerRequests: 0,
    completeness: "UNKNOWN",
  });
}
