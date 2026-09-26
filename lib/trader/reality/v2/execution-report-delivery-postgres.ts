import { enforceServerOnly } from "@/lib/enforce-server-only";
import { and, eq, is, sql } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { readExecutionAttemptProjectionV2Postgres, readExecutionPlanV2Postgres,
  listExecutionReportPrefixV2Postgres } from "@/lib/trader/execution/v2/repository-postgres";
import { createRealitySourceReportV2 } from "./contracts";
import { routeRealityIngressV2 } from "./ingress";
import { ingestRealitySourceReportV2FromWriter } from "./ingest-postgres";
import { listRealityEventsV2, listRealitySourceReportsV2, listTruthRecordsV2,
  lockRealityScopeV2, readLatestRealityProjectionV2, type RealityAccountContext,
  type AppendRealitySourceReportV2Input } from "./repository-postgres";
import { assertDeliveryDraftCapacity, assertDeliveryLedger, assertDeliveryReportPrefix,
  captureDeliveryInput, capturedReportHead, checkDeliveryCapacity, deliveryUnsignedInteger,
  deliveryWitness, EXECUTION_REALITY_DELIVERY_LIMITS as LIMIT, ExecutionRealityDeliveryRefusal,
  findDeliverySource, refuseDelivery, type DeliveryWitness, type ExecutionRealityDeliveryInput,
} from "./execution-report-delivery-proof";

enforceServerOnly();
type Tx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
type Metadata = { row_count: string; maximum_bytes: string; total_bytes: string };
type Target = Readonly<{ reportSequence: string; reportDigestHex: string | null }>;
type Identity = ExecutionRealityDeliveryInput & Readonly<{ attemptContentDigestHex: string; capturedHead: Target }>;
export type ExecutionRealityDeliveryResult =
  | (Identity & Readonly<{ status: "NO_REPORTS"; selectedReports: 0; selectedDrafts: 0;
      deliveredSources: 0; projection: null; realityExamined: false; authority: "OBSERVATION_DELIVERY_ONLY" }>)
  | (Identity & Readonly<{ status: "DELIVERED" | "DELIVERED_WITH_UNCERTAINTY";
      selectedReports: number; selectedDrafts: number; deliveredSources: number;
      newSources: number; existingSources: number; newEvents: number; existingEvents: number;
      sources: readonly DeliveryWitness[]; authority: "OBSERVATION_DELIVERY_ONLY";
      projection: Readonly<{ projectionId: string; contentDigestHex: string; frontierSequence: string;
        frontierEventDigestHex: string | null; uncertaintyCount: number }> }>)
  | Readonly<{ status: "REFUSED"; code: string; newDeliveryCommitted: false;
      detail?: ExecutionRealityDeliveryRefusal["detail"] }>
  | Readonly<{ status: "FAILED"; code: "DELIVERY_FAILED"; newDeliveryCommitted: false }>
  | Readonly<{ status: "COMMIT_OUTCOME_UNKNOWN"; code: "COMMIT_OUTCOME_UNKNOWN";
      newDeliveryCommitted: "UNKNOWN"; retry: "REPEAT_REPORT_DELIVERY_ONLY" }>;

async function readSupportedAttempt(tx: Tx, input: ExecutionRealityDeliveryInput) {
  // Only size/identity metadata before loading sealed JSON. No order/attempt row lock.
  const meta = await tx.execute<{ attempt_bytes: string; plan_bytes: string | null }>(sql`
    SELECT octet_length(to_jsonb(a)::text)::text AS attempt_bytes,
      octet_length(to_jsonb(p)::text)::text AS plan_bytes
    FROM public.trader_execution_attempts_v2 a
    LEFT JOIN public.trader_execution_plans_v2 p ON p.id=a.execution_plan_id
      AND p.organization_id=a.organization_id AND p.account_id=a.account_id
    WHERE a.organization_id=${input.organizationId}::uuid AND a.account_id=${input.accountId}
      AND a.id=${input.executionAttemptId}::uuid LIMIT 1
  `);
  if (!meta[0]) refuseDelivery("ATTEMPT_NOT_FOUND");
  if (meta[0].plan_bytes === null) refuseDelivery("SOURCE_BINDING_INVALID");
  checkDeliveryCapacity("attemptBytes", deliveryUnsignedInteger(meta[0].attempt_bytes), LIMIT.sealedRowBytes);
  checkDeliveryCapacity("planBytes", deliveryUnsignedInteger(meta[0].plan_bytes), LIMIT.sealedRowBytes);
  const stored = await readExecutionAttemptProjectionV2Postgres(tx, input, input.executionAttemptId);
  if (!stored || stored.attempt.accountId !== input.accountId) refuseDelivery("SOURCE_BINDING_INVALID");
  const attempt = stored.attempt;
  const plan = await readExecutionPlanV2Postgres(tx, input, attempt.executionPlanId);
  // Return booleans rather than unbounded order text. Identity is compared in
  // SQL against the admitted sealed attempt, without loading unrelated metadata.
  const [order] = await tx.execute<{ binding_valid: boolean; supported: boolean }>(sql`
    SELECT (
      o.execution_plan_id=${attempt.executionPlanId}::uuid
      AND o.execution_plan_digest=${attempt.executionPlanContentDigestHex}
      AND o.execution_attempt_id=${attempt.executionAttemptId}::uuid
      AND o.execution_attempt_digest=${attempt.contentDigestHex}
      AND o.risk_allowance_id=${attempt.riskAllowanceId}::uuid
      AND o.client_order_id=${attempt.clientOrderId}
      AND o.symbol=${attempt.exactRequestPayload.symbol} AND o.side::text=${attempt.exactRequestPayload.side}
      AND o.type::text=${attempt.exactRequestPayload.type} AND o.quantity=${attempt.exactRequestPayload.quantity}
      AND o.price IS NOT DISTINCT FROM ${attempt.exactRequestPayload.price}::text
    ) AS binding_valid, (
      o.execution_mode::text='live' AND o.historical_run_id IS NULL
      AND o.historical_account_key IS NULL AND upper(o.venue)='HTX'
    ) AS supported
    FROM public.trader_orders o WHERE o.organization_id=${input.organizationId}::uuid
      AND o.id=${attempt.orderId}::uuid LIMIT 1
  `);
  const a = pgSchema.traderRiskAllowancesV2;
  const [allowance] = await tx.select({ contentDigest: a.contentDigest }).from(a).where(and(
    eq(a.organizationId, input.organizationId), eq(a.accountId, input.accountId), eq(a.id, attempt.riskAllowanceId),
  )).limit(1);
  if (!plan || !order || !allowance || plan.accountId !== input.accountId ||
    plan.contentDigestHex !== attempt.executionPlanContentDigestHex ||
    plan.riskAllowanceId !== attempt.riskAllowanceId ||
    plan.riskAllowanceContentDigestHex !== attempt.riskAllowanceContentDigestHex ||
    allowance.contentDigest !== attempt.riskAllowanceContentDigestHex ||
    order.binding_valid !== true) refuseDelivery("SOURCE_BINDING_INVALID");
  if (order.supported !== true ||
    [attempt.venue, plan.venue].some((venue) => venue.toUpperCase() !== "HTX")) {
    refuseDelivery("UNSUPPORTED_SOURCE_SCOPE");
  }
  return stored;
}

async function loadPrefix(tx: Tx, input: ExecutionRealityDeliveryInput, head: string) {
  const metadata = await tx.execute<Metadata>(sql`
    SELECT count(*)::text AS row_count, coalesce(max(bytes),0)::text AS maximum_bytes,
      coalesce(sum(bytes),0)::text AS total_bytes FROM (
      SELECT octet_length(to_jsonb(r)::text) AS bytes FROM public.trader_execution_reports_v2 r
      WHERE r.organization_id=${input.organizationId}::uuid AND r.account_id=${input.accountId}
        AND r.execution_attempt_id=${input.executionAttemptId}::uuid AND r.report_sequence<=${head}::bigint
      ORDER BY r.report_sequence LIMIT 257
    ) bounded_reports
  `);
  const row = metadata[0];
  if (!row || deliveryUnsignedInteger(row.row_count) !== BigInt(head)) refuseDelivery("REPORT_PREFIX_INVALID");
  checkDeliveryCapacity("reportRowBytes", deliveryUnsignedInteger(row.maximum_bytes), LIMIT.reportRowBytes);
  checkDeliveryCapacity("reportTotalBytes", deliveryUnsignedInteger(row.total_bytes), LIMIT.reportTotalBytes);
  return listExecutionReportPrefixV2Postgres(tx, input, input.executionAttemptId, BigInt(head), LIMIT.reports + 1);
}
const LEDGER_TABLES = ["trader_reality_source_reports_v2", "trader_reality_truth_records_v2", "trader_reality_events_v2"] as const;
async function ledgerCapacity(tx: Tx, scope: RealityAccountContext, reserve: number): Promise<void> {
  let total = 0n;
  for (const table of LEDGER_TABLES) {
    // Table names are fixed literals; identifiers and all scope values are bound.
    const count = await tx.execute<{ row_count: string }>(sql`
      SELECT count(*)::text AS row_count FROM (
        SELECT id FROM public.${sql.identifier(table)} WHERE organization_id=${scope.organizationId}::uuid
          AND account_id=${scope.accountId} LIMIT 4097
      ) bounded_ids
    `);
    if (!count[0]) refuseDelivery("REALITY_BASELINE_INVALID");
    checkDeliveryCapacity(table, deliveryUnsignedInteger(count[0].row_count) + BigInt(reserve), LIMIT.ledgerRows);
    const size = await tx.execute<Metadata>(sql`
      SELECT count(*)::text AS row_count, coalesce(max(bytes),0)::text AS maximum_bytes,
        coalesce(sum(bytes),0)::text AS total_bytes FROM (
        SELECT octet_length(to_jsonb(r)::text) AS bytes FROM public.${sql.identifier(table)} r
        WHERE r.organization_id=${scope.organizationId}::uuid AND r.account_id=${scope.accountId} LIMIT 4097
      ) bounded_rows
    `);
    if (!size[0]) refuseDelivery("REALITY_BASELINE_INVALID");
    checkDeliveryCapacity(`${table}:bytes`, deliveryUnsignedInteger(size[0].maximum_bytes), LIMIT.ledgerRowBytes);
    total += deliveryUnsignedInteger(size[0].total_bytes);
  }
  checkDeliveryCapacity("ledgerTotalBytes", total, LIMIT.ledgerTotalBytes);
}
async function readBoundedProjection(tx: Tx, scope: RealityAccountContext) {
  const [meta] = await tx.execute<{ id: string; bytes: string }>(sql`
    SELECT id, octet_length(to_jsonb(p)::text)::text AS bytes FROM public.trader_reality_projections_v2 p
    WHERE organization_id=${scope.organizationId}::uuid AND account_id=${scope.accountId}
    ORDER BY frontier_sequence DESC, knowledge_as_of DESC, id DESC LIMIT 1
  `);
  if (!meta) return null;
  checkDeliveryCapacity("projectionBytes", deliveryUnsignedInteger(meta.bytes), LIMIT.projectionBytes);
  const projection = await readLatestRealityProjectionV2(tx, scope);
  if (!projection || projection.projectionId !== meta.id) refuseDelivery("REALITY_BASELINE_INVALID");
  return projection;
}
async function loadLedger(tx: Tx, scope: RealityAccountContext) {
  return { sources: await listRealitySourceReportsV2(tx, scope),
    truths: await listTruthRecordsV2(tx, scope), events: await listRealityEventsV2(tx, scope) };
}

/** DB-only observation command: owns RC/675, never accepts caller report bodies,
 * held transactions, source readers, ingesters or provider capabilities. */
export async function catchUpExecutionRealityV2Postgres(db: WaiaPostgresDb,
  supplied: ExecutionRealityDeliveryInput): Promise<ExecutionRealityDeliveryResult> {
  let callbackFinished = false;
  let callbackError: unknown;
  let startedWrites = false;
  try {
    const input = captureDeliveryInput(supplied);
    if (!is(db, PostgresJsDatabase) || "rollback" in db) refuseDelivery("TRANSACTION_OWNER_REQUIRED");
    return await db.transaction(async (tx): Promise<ExecutionRealityDeliveryResult> => {
      try {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
        const scope = Object.freeze({ organizationId: input.organizationId, accountId: input.accountId });
        await lockRealityScopeV2(tx, scope);
        const stored = await readSupportedAttempt(tx, input);
        const head = capturedReportHead(stored.nextReportSequence, stored.lastReportDigestHex);
        const identity = Object.freeze({ ...input, attemptContentDigestHex: stored.attempt.contentDigestHex,
          capturedHead: Object.freeze({ reportSequence: head, reportDigestHex: stored.lastReportDigestHex }) });
        if (head === "0") {
          callbackFinished = true;
          return Object.freeze({ ...identity, status: "NO_REPORTS", selectedReports: 0, selectedDrafts: 0,
            deliveredSources: 0, projection: null, realityExamined: false, authority: "OBSERVATION_DELIVERY_ONLY" });
        }
        const reports = await loadPrefix(tx, input, head);
        assertDeliveryReportPrefix(input, stored.attempt.contentDigestHex, head, stored.lastReportDigestHex, reports);
        const drafts: AppendRealitySourceReportV2Input[] = [];
        for (const report of reports) {
          // Avoid allocating a huge adapter result before its count admission.
          if (report.reportType === "FILL_REPORT_OBSERVED" && Array.isArray(report.rawObservation.trades)) {
            checkDeliveryCapacity("drafts", BigInt(drafts.length + report.rawObservation.trades.length), LIMIT.drafts);
          }
          const route = routeRealityIngressV2({ kind: "EXECUTION_REPORT_V2", report });
          if (route.status !== "ADMITTED") refuseDelivery("SOURCE_BINDING_INVALID");
          drafts.push(...route.drafts);
          assertDeliveryDraftCapacity(drafts);
        }
        // Validate draft grammar without fabricating a stored knowledge timestamp.
        for (const draft of drafts) createRealitySourceReportV2({ ...draft, ...scope, knowledgeAtUtc: draft.validAtUtc });
        await ledgerCapacity(tx, scope, drafts.length);
        const before = await loadLedger(tx, scope);
        assertDeliveryLedger(scope, before, await readBoundedProjection(tx, scope));
        // The duplicate ingester may persist a projection, so both baseline and
        // previously selected source witnesses must pass before its first call.
        for (const draft of drafts) {
          const source = findDeliverySource(scope, draft, before.sources);
          if (source) deliveryWitness(source, before);
        }
        for (const draft of drafts) {
          await ledgerCapacity(tx, scope, 0);
          startedWrites = true;
          await ingestRealitySourceReportV2FromWriter(tx, scope, draft);
        }
        await ledgerCapacity(tx, scope, 0);
        const after = await loadLedger(tx, scope);
        const projection = assertDeliveryLedger(scope, after, await readBoundedProjection(tx, scope));
        if (!projection) refuseDelivery("DELIVERY_INCOMPLETE");
        const sources = drafts.map((draft) => {
          const source = findDeliverySource(scope, draft, after.sources);
          if (!source) refuseDelivery("DELIVERY_INCOMPLETE");
          return deliveryWitness(source, after);
        });
        const uniqueSources = new Set(sources.map((s) => s.sourceReportId));
        const oldSources = new Set(before.sources.map((s) => s.sourceReportId));
        const newSources = [...uniqueSources].filter((id) => !oldSources.has(id)).length;
        callbackFinished = true;
        return Object.freeze({ ...identity,
          status: projection.uncertainties.length ? "DELIVERED_WITH_UNCERTAINTY" : "DELIVERED",
          selectedReports: reports.length, selectedDrafts: drafts.length, deliveredSources: uniqueSources.size,
          newSources, existingSources: uniqueSources.size - newSources,
          newEvents: after.events.length - before.events.length,
          existingEvents: new Set(sources.filter((s) => before.events.some((e) =>
            e.realityEventId === s.admissionEventId)).map((s) => s.admissionEventId)).size,
          sources: Object.freeze(sources), authority: "OBSERVATION_DELIVERY_ONLY",
          projection: Object.freeze({ projectionId: projection.projectionId, contentDigestHex: projection.contentDigestHex,
            frontierSequence: projection.frontierSequence, frontierEventDigestHex: projection.frontierEventDigestHex,
            uncertaintyCount: projection.uncertainties.length }),
        });
      } catch (error) { callbackError = error; throw error; }
    });
  } catch (error) {
    // postgres.js returns the callback's original error after awaited rollback;
    // a different error or a post-callback rejection cannot prove rollback.
    if (callbackFinished || (startedWrites && error !== callbackError)) return Object.freeze({
      status: "COMMIT_OUTCOME_UNKNOWN", code: "COMMIT_OUTCOME_UNKNOWN", newDeliveryCommitted: "UNKNOWN",
      retry: "REPEAT_REPORT_DELIVERY_ONLY",
    });
    if (error instanceof ExecutionRealityDeliveryRefusal) return Object.freeze({
      status: "REFUSED", code: error.code, newDeliveryCommitted: false,
      ...(error.detail ? { detail: error.detail } : {}),
    });
    return Object.freeze({ status: "FAILED", code: "DELIVERY_FAILED", newDeliveryCommitted: false });
  }
}
