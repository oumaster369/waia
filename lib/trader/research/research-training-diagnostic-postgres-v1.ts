import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import { loadRegisteredResearchTrainingExecutionInputPostgresV1 } from "@/lib/trader/research/research-training-payload-postgres-v1";
import { resolveResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";
import { runOwnedResearchModeledStageV1 } from "@/lib/trader/research/research-modeled-stage-kernel-v1";

export const RESEARCH_TRAINING_DIAGNOSTIC_V1 = "waia.research.training-diagnostic.v1" as const;
const REQUEST = z.object({
  attemptId: z.string().uuid(), trialIndex: z.number().int().min(0).max(31),
  limits: z.object({ maxBars: z.number().int().min(1).max(4096),
    maxBytes: z.number().int().min(1).max(32 * 1024 * 1024) }).strict(),
}).strict();

function refuse(reason: string): never {
  throw new Error(`RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:${reason}`);
}

type DiagnosticRow = Readonly<{
  organization_id: string; attempt_id: string; trial_index: number;
  stage_run_id: string; experiment_spec_sha256: string; scope_digest_hex: string;
  policy_digest_hex: string; trace_canonical_json: string; trace_sha256: string;
}>;
type VerifiedTrace = Readonly<Record<string, unknown> & {
  authority: "TRAINING_ENGINEERING_TRACE_ONLY"; capitalEligible: false; scientificQualified: false;
  stageRunId: string; scopeDigestHex: string; decisions: readonly unknown[];
  orders: readonly unknown[]; openPositions: readonly unknown[];
  equity: string; netUnrealizedPnl: string; strategyGuardianQualification: "UNQUALIFIED";
  accountGuardianQualification: "UNQUALIFIED";
  appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY";
  orderCount: number; fillCount: number; accountingSequence: number;
  finalAccountingDigestHex: string; ledgerDigestHex: string; traceSha256: string;
}>;

function verifyCommittedTrace(row: DiagnosticRow, expected: Readonly<{
  organizationId: string; attemptId: string; trialIndex: number; stageRunId: string;
  specSha256: string; scopeDigest: string; policyDigest: string;
}>) {
  if (row.organization_id !== expected.organizationId || row.attempt_id !== expected.attemptId ||
      row.trial_index !== expected.trialIndex || row.stage_run_id !== expected.stageRunId ||
      row.experiment_spec_sha256 !== expected.specSha256 || row.scope_digest_hex !== expected.scopeDigest ||
      row.policy_digest_hex !== expected.policyDigest) refuse("COMMITTED_SCOPE_MISMATCH");
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(row.trace_canonical_json) as Record<string, unknown>; }
  catch { return refuse("COMMITTED_TRACE_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      canonicalJsonString(parsed) !== row.trace_canonical_json ||
      computeStableJsonDigest(parsed) !== row.trace_sha256 ||
      parsed.authority !== "TRAINING_ENGINEERING_TRACE_ONLY" ||
      parsed.capitalEligible !== false || parsed.scientificQualified !== false ||
      parsed.organizationId !== expected.organizationId || parsed.attemptId !== expected.attemptId ||
      parsed.trialIndex !== expected.trialIndex || parsed.stageRunId !== expected.stageRunId ||
      parsed.scopeDigestHex !== expected.scopeDigest || parsed.policyDigestHex !== expected.policyDigest ||
      !Array.isArray(parsed.decisions) || !Array.isArray(parsed.orders) ||
      !Array.isArray(parsed.openPositions) || typeof parsed.equity !== "string" ||
      typeof parsed.netUnrealizedPnl !== "string" ||
      parsed.strategyGuardianQualification !== "UNQUALIFIED" ||
      parsed.accountGuardianQualification !== "UNQUALIFIED" ||
      parsed.appliedProtectionScope !== "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY" ||
      !Number.isSafeInteger(parsed.orderCount) || !Number.isSafeInteger(parsed.fillCount) ||
      !Number.isSafeInteger(parsed.accountingSequence) ||
      typeof parsed.finalAccountingDigestHex !== "string" ||
      typeof parsed.ledgerDigestHex !== "string") {
    refuse("COMMITTED_TRACE_INVALID");
  }
  return Object.freeze({ ...parsed, traceSha256: row.trace_sha256 }) as VerifiedTrace;
}

/** A non-qualifying diagnostic of one preregistered DEVELOPMENT trial. The
 * caller supplies no bars, results, policy, scorer, order port or authority
 * callback. All effects and the result share the locked root transaction. */
export async function runRegisteredResearchTrainingDiagnosticPostgresV1(
  db: WaiaPostgresDb, context: OrgContext, supplied: z.infer<typeof REQUEST>,
) {
  assertResearchRootPostgresDbV1(db);
  const organizationId = requireOrgContext(context.organizationId).organizationId.toLowerCase();
  const parsedRequest = REQUEST.parse(supplied);
  const request = Object.freeze({ ...parsedRequest,
    attemptId: parsedRequest.attemptId.toLowerCase() });
  const captured = Object.freeze({ organizationId });
  const source = await loadRegisteredResearchTrainingExecutionInputPostgresV1(db, captured, request);
  const policy = resolveResearchTrainingPolicyV1(source.experiment.spec);
  const { scope } = source;
  const stageRunId = scope.ledgerScope.historicalRunId;
  const accountKey = scope.ledgerScope.historicalAccountKey;
  const expected = Object.freeze({ organizationId, attemptId: request.attemptId,
    trialIndex: request.trialIndex, stageRunId, specSha256: scope.identity.experimentSpecSha256,
    scopeDigest: scope.contentDigest, policyDigest: policy.guardianResolvedPolicySha256 });
  const model = createHistoricalExecutionModelV1();
  if (computeStableJsonDigest(model) !== policy.historicalExecutionModelSha256 ||
      source.bars.length > request.limits.maxBars || source.cycles.length !== source.bars.length) {
    refuse("MODEL_OR_INPUT_MISMATCH");
  }

  try {
  return await db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '180s'`);
    await tx.execute(sql`set local lock_timeout = '30s'`);
    await tx.execute(sql`set local time zone 'UTC'`);
    const [attempt] = await tx.execute<{ id: string; spec_sha256: string; source_run_id: string }>(sql`
      select id::text,spec_sha256,source_run_id from public.trader_research_attempts_v1
      where organization_id=${organizationId}::uuid and id=${request.attemptId}::uuid for update`);
    if (!attempt || attempt.spec_sha256 !== expected.specSha256 ||
        attempt.source_run_id !== source.sourceRunId) refuse("ATTEMPT_LOCK_IDENTITY");
    const [existing] = await tx.execute<DiagnosticRow>(sql`
      select organization_id::text,attempt_id::text,trial_index,stage_run_id::text,
        experiment_spec_sha256,scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
      from public.trader_research_training_diagnostics_v1
      where organization_id=${organizationId}::uuid and attempt_id=${request.attemptId}::uuid
        and trial_index=${request.trialIndex}`);
    const [ledger] = await tx.execute<{ order_count: string; fill_count: string;
      frontier_count: string; foreign_order_count: string; foreign_frontier_count: string }>(sql`
      select
        (select count(*)::text from public.trader_orders o where o.historical_run_id=${stageRunId}
          and o.organization_id=${organizationId}::uuid and o.historical_account_key=${accountKey}) as order_count,
        (select count(*)::text from public.trader_fills f join public.trader_orders o on o.id=f.order_id
          where o.historical_run_id=${stageRunId} and o.organization_id=${organizationId}::uuid
            and o.historical_account_key=${accountKey}) as fill_count,
        (select count(*)::text from public.trader_accounting_frontier a where a.run_id=${stageRunId}
          and a.organization_id=${organizationId}::uuid and a.account_key=${accountKey}) as frontier_count,
        (select count(*)::text from public.trader_orders o where o.historical_run_id=${stageRunId}
          and (o.organization_id<>${organizationId}::uuid or o.historical_account_key<>${accountKey})) as foreign_order_count,
        (select count(*)::text from public.trader_accounting_frontier a where a.run_id=${stageRunId}
          and (a.organization_id<>${organizationId}::uuid or a.account_key<>${accountKey})) as foreign_frontier_count`);
    if (!ledger || ledger.foreign_order_count !== "0" || ledger.foreign_frontier_count !== "0") {
      refuse("FOREIGN_STAGE_LEDGER");
    }
    // Exact durable material, including mutable parent state, lifecycle events,
    // fill economics and every accounting frontier. Counts alone permit a
    // same-row alteration to masquerade as the prior committed trace.
    const readLedgerDigest = async () => {
      const [value] = await tx.execute<{ digest: string }>(sql`
        select encode(sha256(convert_to(jsonb_build_object(
          'orders', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
            from public.trader_orders o where o.organization_id=${organizationId}::uuid
              and o.historical_run_id=${stageRunId} and o.historical_account_key=${accountKey}),
          'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.order_id,e.seq), '[]'::jsonb)
            from public.trader_order_events e join public.trader_orders o on o.id=e.order_id
            where o.organization_id=${organizationId}::uuid and o.historical_run_id=${stageRunId}
              and o.historical_account_key=${accountKey}),
          'fills', (select coalesce(jsonb_agg(to_jsonb(f) order by f.order_id,f.id), '[]'::jsonb)
            from public.trader_fills f join public.trader_orders o on o.id=f.order_id
            where o.organization_id=${organizationId}::uuid and o.historical_run_id=${stageRunId}
              and o.historical_account_key=${accountKey}),
          'economics', (select coalesce(jsonb_agg(to_jsonb(e) order by e.order_id,e.fill_id), '[]'::jsonb)
            from public.trader_fill_execution_economics e
            join public.trader_orders o on o.id=e.order_id
            where o.organization_id=${organizationId}::uuid and o.historical_run_id=${stageRunId}
              and o.historical_account_key=${accountKey}),
          'frontiers', (select coalesce(jsonb_agg(to_jsonb(a) order by a.accounting_sequence), '[]'::jsonb)
            from public.trader_accounting_frontier a where a.organization_id=${organizationId}::uuid
              and a.run_id=${stageRunId} and a.account_key=${accountKey})
        )::text, 'UTF8')), 'hex') as digest`);
      if (!value || !/^[a-f0-9]{64}$/.test(value.digest)) refuse("LEDGER_DIGEST_UNAVAILABLE");
      return value.digest;
    };
    if (existing) {
      const committed = verifyCommittedTrace(existing, expected);
      if (ledger.order_count !== String(committed.orderCount) ||
          ledger.fill_count !== String(committed.fillCount) ||
          ledger.frontier_count !== String(committed.accountingSequence)) {
        refuse("COMMITTED_LEDGER_DIVERGENT");
      }
      const [last] = await tx.execute<{ semantic_content_digest: string }>(sql`
        select semantic_content_digest from public.trader_accounting_frontier
        where organization_id=${organizationId}::uuid and account_key=${accountKey} and run_id=${stageRunId}
        order by accounting_sequence desc limit 1`);
      if (last?.semantic_content_digest !== committed.finalAccountingDigestHex) {
        refuse("COMMITTED_ACCOUNTING_DIVERGENT");
      }
      if (await readLedgerDigest() !== committed.ledgerDigestHex) {
        refuse("COMMITTED_LEDGER_DIVERGENT");
      }
      return committed;
    }
    if (ledger.order_count !== "0" || ledger.fill_count !== "0" || ledger.frontier_count !== "0") {
      refuse("UNCOMMITTED_STAGE_LEDGER_EXISTS");
    }

    const { accounting, decisions, advances, fillDetails, orderRows, openOrderIds } =
      await runOwnedResearchModeledStageV1({ tx, source, request, policy, model });
    const finalPositions = Object.entries(accounting.positions).filter(([, position]) =>
      compareDecimal(position.quantity, "0") > 0).map(([symbol, position]) => ({
      symbol, quantity: position.quantity, netPositionBasis: position.netPositionBasis,
      markPrice: accounting.marks[symbol]?.price ?? null }));
    const feePaid = fillDetails.reduce((sum, entry) => {
      const economics = entry.economics as { feeAmount: string };
      return addDecimal(sum, economics.feeAmount);
    }, "0");
    const remainingNetBasis = Object.values(accounting.positions).reduce((sum, position) =>
      addDecimal(sum, position.netPositionBasis), "0");
    const ledgerDigestHex = await readLedgerDigest();
    const trace = Object.freeze({ schemaVersion: RESEARCH_TRAINING_DIAGNOSTIC_V1,
      authority: "TRAINING_ENGINEERING_TRACE_ONLY" as const, capitalEligible: false as const,
      scientificQualified: false as const, strategyGuardianQualification: "UNQUALIFIED" as const,
      accountGuardianQualification: "UNQUALIFIED" as const,
      appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY" as const,
      sourceQualification: "NOT_ESTABLISHED" as const,
      organizationId, attemptId: request.attemptId, trialIndex: request.trialIndex,
      stageRunId, scopeDigestHex: scope.contentDigest,
      experimentSpecSha256: expected.specSha256,
      sourceRunId: source.sourceRunId, trainPartitionSha256: source.partition.contentSha256,
      policyDigestHex: policy.guardianResolvedPolicySha256,
      historicalExecutionModelSha256: policy.historicalExecutionModelSha256,
      requestedExecutableSourceSha256: policy.requestedExecutableSourceSha256,
      requestedPointInTimeEvidenceSha256: policy.requestedPointInTimeEvidenceSha256,
      barCount: source.bars.length, orderCount: orderRows.length,
      fillCount: fillDetails.length, accountingSequence: accounting.accountingSequence,
      ledgerDigestHex,
      finalAccountingDigestHex: accounting.semanticContentDigest,
      cash: accounting.cash, grossRealizedPnl: accounting.grossRealizedPnl,
      netRealizedPnl: accounting.netRealizedPnl,
      netUnrealizedPnl: subtractDecimal(accounting.markedPositionValue, remainingNetBasis),
      markedPositionValue: accounting.markedPositionValue, equity: accounting.equity,
      accountDrawdownBps: accounting.accountDrawdownBps,
      monthlyDrawdownBps: accounting.monthlyDrawdownBps,
      feesPaid: feePaid, openPositions: Object.freeze(finalPositions),
      openOrderIds: Object.freeze(openOrderIds),
      orders: Object.freeze(orderRows.map(order => Object.freeze({ id: order.id, side: order.side,
        state: order.state, quantity: order.quantity, filledQuantity: order.filledQuantity,
        avgFillPrice: order.avgFillPrice, decisionId: order.allocationDecisionId }))),
      decisions: Object.freeze(decisions), advances: Object.freeze(advances),
      fillDetails: Object.freeze(fillDetails) });
    const traceCanonicalJson = canonicalJsonString(trace);
    if (Buffer.byteLength(traceCanonicalJson, "utf8") > 16 * 1024 * 1024) refuse("TRACE_BYTE_LIMIT");
    const traceSha256 = computeStableJsonDigest(trace);
    await tx.execute(sql`insert into public.trader_research_training_diagnostics_v1 (
      organization_id,attempt_id,trial_index,stage_run_id,experiment_spec_sha256,
      scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
    ) values (${organizationId}::uuid,${request.attemptId}::uuid,${request.trialIndex},
      ${stageRunId}::uuid,${expected.specSha256},${scope.contentDigest},
      ${policy.guardianResolvedPolicySha256},${traceCanonicalJson},${traceSha256})`);
    return Object.freeze({ ...trace, traceSha256 });
  }, { isolationLevel: "serializable" });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "40001") refuse("SERIALIZATION_RETRY_REQUIRED");
    if (code === "55P03") refuse("LOCK_TIMEOUT_RETRY_REQUIRED");
    throw error;
  }
}
