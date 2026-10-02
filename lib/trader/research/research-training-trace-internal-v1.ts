import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import { RESEARCH_ISSUED_TRAINING_DIAGNOSTIC_V2 } from "./research-issued-training-contract-v2";
import type { runOwnedResearchModeledStageV1 } from "./research-modeled-stage-kernel-v1";
import { sql } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { canonicalJsonString, computeStableJsonDigest } from "./digest";
import type { ResearchModeledStageSourceV1 } from "./research-modeled-stage-source-v1";
import type { resolveResearchTrainingPolicyV1 } from "./research-training-policy-v1";
import type { resolveCurrentResearchExecutableIdentityV1 } from "./research-executable-runtime-identity-v1";
import type { ResearchFeatureInvocationReceiptV1 } from "./research-feature-invocation-v1";
export const RESEARCH_TRAINING_DIAGNOSTIC_V1 = "waia.research.training-diagnostic.v1" as const;
export const RESEARCH_TRAINING_DIAGNOSTIC_V2 = "waia.research.training-diagnostic.v2" as const;
function refuse(reason: string): never { throw new Error(`RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:${reason}`); }

export type DiagnosticRow = Readonly<{
  organization_id: string; attempt_id: string; trial_index: number;
  stage_run_id: string; experiment_spec_sha256: string; scope_digest_hex: string;
  policy_digest_hex: string; trace_canonical_json: string; trace_sha256: string;
}>;
type CheckedInput = ResearchModeledStageSourceV1;

/** Binds actual calls, including NONE, to all checked modeled-execution input.
 * Cycle metadata/volume can affect fills even if the OHLCV bars are unchanged.
 * These hashes establish input use, not historical source or PIT provenance. */
export function bindInputUseReceipt(
  source: CheckedInput,
  policy: ReturnType<typeof resolveResearchTrainingPolicyV1>,
  observedExecutableIdentity: ReturnType<typeof resolveCurrentResearchExecutableIdentityV1>,
  invocations: readonly ResearchFeatureInvocationReceiptV1[],
) {
  if (invocations.length !== source.bars.length) refuse("INPUT_USE_INVOCATION_COUNT");
  const issued = source.scope.identity.sourceIssuanceDigest;
  const body = Object.freeze({ schemaVersion: issued ? "waia.research.issued-development-input-use.v2" as const : "waia.research.development-input-use.v1" as const,
    ...(issued ? { sourceIssuanceDigest: issued } : {}),
    authority: "DEVELOPMENT_INPUT_USE_INTEGRITY_ONLY" as const,
    sourceQualification: "NOT_ESTABLISHED" as const,
    organizationId: source.scope.identity.organizationId,
    experimentSpecSha256: source.scope.identity.experimentSpecSha256,
    attemptId: source.scope.identity.attemptId, trialIndex: source.scope.identity.trialIndex,
    scopeDigestHex: source.scope.contentDigest,
    sourceRunId: source.sourceRunId, sourceClass: source.source,
    datasetAuthorityDigest: source.datasetAuthorityDigest,
    partition: "DEVELOPMENT" as const, partitionIdentity: source.partition,
    symbol: source.experiment.spec.universe.symbol, interval: source.experiment.spec.universe.interval,
    executionCyclesSha256: computeStableJsonDigest(source.cycles),
    policyDigestHex: policy.guardianResolvedPolicySha256, observedExecutableIdentity,
    invocationCount: invocations.length, invocations: Object.freeze([...invocations]) });
  return Object.freeze({ ...body, contentDigestHex: computeStableJsonDigest(body) });
}
export type VerifiedTrace = Readonly<Record<string, unknown> & {
  authority: "TRAINING_ENGINEERING_TRACE_ONLY"; capitalEligible: false; scientificQualified: false;
  stageRunId: string; scopeDigestHex: string; decisions: readonly unknown[];
  orders: readonly unknown[]; openPositions: readonly unknown[];
  equity: string; netUnrealizedPnl: string; strategyGuardianQualification: "UNQUALIFIED";
  accountGuardianQualification: "UNQUALIFIED";
  appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY";
  orderCount: number; fillCount: number; accountingSequence: number;
  finalAccountingDigestHex: string; ledgerDigestHex: string; traceSha256: string;
  inputUseReceipt: ReturnType<typeof bindInputUseReceipt>;
}>;

/** This known rollback permits verification only, never another stage write. */
export function isResearchAccountingFrontierConflictV1(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const pg = error as Record<string, unknown>;
  return pg.code === "23505" && pg.schema_name === "public" &&
    pg.table_name === "trader_accounting_frontier" && pg.constraint_name === "trader_accounting_frontier_pkey";
}

export function readCurrentTrace(row: Pick<DiagnosticRow, "trace_canonical_json" | "trace_sha256">, schemaVersion: string = RESEARCH_TRAINING_DIAGNOSTIC_V2) {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(row.trace_canonical_json) as Record<string, unknown>; }
  catch { return refuse("COMMITTED_TRACE_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      canonicalJsonString(parsed) !== row.trace_canonical_json ||
      computeStableJsonDigest(parsed) !== row.trace_sha256) refuse("COMMITTED_TRACE_INVALID");
  if (parsed.schemaVersion === RESEARCH_TRAINING_DIAGNOSTIC_V1) {
    refuse("LEGACY_TRACE_REQUIRES_NEW_ATTEMPT");
  }
  if (parsed.schemaVersion !== schemaVersion) refuse("COMMITTED_TRACE_INVALID");
  return parsed;
}

export function verifyCommittedTrace(row: DiagnosticRow, expected: Readonly<{
  organizationId: string; attemptId: string; trialIndex: number; stageRunId: string;
  specSha256: string; scopeDigest: string; policyDigest: string;
  observedExecutableIdentity: ReturnType<typeof resolveCurrentResearchExecutableIdentityV1>;
  inputUseReceipt: ReturnType<typeof bindInputUseReceipt>;
  traceSchemaVersion?: string; sourceIssuanceDigest?: string;
}>) {
  if (row.organization_id !== expected.organizationId || row.attempt_id !== expected.attemptId ||
      row.trial_index !== expected.trialIndex || row.stage_run_id !== expected.stageRunId ||
      row.experiment_spec_sha256 !== expected.specSha256 || row.scope_digest_hex !== expected.scopeDigest ||
      row.policy_digest_hex !== expected.policyDigest) refuse("COMMITTED_SCOPE_MISMATCH");
  const parsed = readCurrentTrace(row, expected.traceSchemaVersion);
  if (expected.sourceIssuanceDigest !== undefined &&
      (parsed.sourceIssuanceDigest !== expected.sourceIssuanceDigest ||
       parsed.sourceAvailability !== "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED")) {
    refuse("COMMITTED_ISSUED_SOURCE_MISMATCH");
  }
  if (parsed.sourceQualification !== "NOT_ESTABLISHED" ||
      parsed.authority !== "TRAINING_ENGINEERING_TRACE_ONLY" ||
      parsed.capitalEligible !== false || parsed.scientificQualified !== false ||
      parsed.organizationId !== expected.organizationId || parsed.attemptId !== expected.attemptId ||
      parsed.trialIndex !== expected.trialIndex || parsed.stageRunId !== expected.stageRunId ||
      parsed.scopeDigestHex !== expected.scopeDigest || parsed.policyDigestHex !== expected.policyDigest ||
      !parsed.observedExecutableIdentity || typeof parsed.observedExecutableIdentity !== "object" ||
      canonicalJsonString(parsed.observedExecutableIdentity) !==
        canonicalJsonString(expected.observedExecutableIdentity) ||
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
  if (!parsed.inputUseReceipt || canonicalJsonString(parsed.inputUseReceipt) !==
      canonicalJsonString(expected.inputUseReceipt)) refuse("COMMITTED_INPUT_USE_MISMATCH");
  return Object.freeze({ ...parsed, traceSha256: row.trace_sha256 }) as VerifiedTrace;
}

/** Internal verification only; counts never substitute for full current ledger bytes. */
export async function readResearchStageLedgerProofV1(tx: Pick<WaiaPostgresDb, "execute">,
  scope: Readonly<{ organizationId: string; stageRunId: string; accountKey: string }>) {
  const { organizationId, stageRunId, accountKey } = scope;
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
  return { ledger, readLedgerDigest };
}

export function buildResearchTrainingTraceV1(input: Readonly<{
  source: ResearchModeledStageSourceV1;
  request: Readonly<{ attemptId: string; trialIndex: number }>;
  policy: ReturnType<typeof resolveResearchTrainingPolicyV1>;
  observedExecutableIdentity: ReturnType<typeof resolveCurrentResearchExecutableIdentityV1>;
  stage: Awaited<ReturnType<typeof runOwnedResearchModeledStageV1>>;
  ledgerDigestHex: string;
}>) {
  const { source, request, policy, observedExecutableIdentity, ledgerDigestHex } = input;
  const { scope } = source;
  const { organizationId } = scope.identity;
  const stageRunId = scope.ledgerScope.historicalRunId;
  const { accounting, decisions, advances, fillDetails, orderRows, openOrderIds, invocations } = input.stage;
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
    const trace = Object.freeze({ schemaVersion: scope.identity.sourceIssuanceDigest ? RESEARCH_ISSUED_TRAINING_DIAGNOSTIC_V2 : RESEARCH_TRAINING_DIAGNOSTIC_V2,
      ...(scope.identity.sourceIssuanceDigest ? { sourceIssuanceDigest: scope.identity.sourceIssuanceDigest,
        sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED" as const } : {}),
      inputUseReceipt: bindInputUseReceipt(source, policy, observedExecutableIdentity, invocations),
      authority: "TRAINING_ENGINEERING_TRACE_ONLY" as const, capitalEligible: false as const,
      scientificQualified: false as const, strategyGuardianQualification: "UNQUALIFIED" as const,
      accountGuardianQualification: "UNQUALIFIED" as const,
      appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY" as const,
      sourceQualification: "NOT_ESTABLISHED" as const,
      organizationId, attemptId: request.attemptId, trialIndex: request.trialIndex,
      stageRunId, scopeDigestHex: scope.contentDigest,
      experimentSpecSha256: scope.identity.experimentSpecSha256,
      sourceRunId: source.sourceRunId, trainPartitionSha256: source.partition.contentSha256,
      policyDigestHex: policy.guardianResolvedPolicySha256,
      historicalExecutionModelSha256: policy.historicalExecutionModelSha256,
      requestedExecutableSourceSha256: policy.requestedExecutableSourceSha256,
      observedExecutableIdentity,
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
  return trace;
}
