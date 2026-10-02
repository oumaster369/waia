import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import type postgres from "postgres";
import { withResearchOwnedPostgresPoolV1 } from "./research-owned-postgres-pool-v1";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as query } from "drizzle-orm";
import * as schema from "@/db/schema.postgres";
import { withPostgresSerializableTransactionRetry, withPostgresSessionTransaction } from "@/db/postgres-session-transaction";
import { deterministicUuidV8 } from "@/lib/trader/execution/deterministic-execution-id";
import { captureHistoricalMockLedgerScope } from "@/lib/trader/execution/historical-mock-ledger-scope";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { deepFreezeInquiry } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { canonicalJsonString, computeStableJsonDigest } from "./digest";
import { captureResearchIssuedTrainingRequestV2, RESEARCH_ISSUED_TRAINING_DIAGNOSTIC_V2, type ResearchIssuedTrainingRequestV2 } from "./research-issued-training-contract-v2";
import { readResearchIssuedSourceAndExperimentV2 } from "./research-issued-attempt-postgres-v2";
import { readResearchDevelopmentSourceRowsV1 } from "./research-development-source-read-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "./research-executable-runtime-identity-v1";
import { resolveResearchTrainingPolicyV1 } from "./research-training-policy-v1";
import { validateResearchTrainingCyclesV1 } from "./research-training-payload-postgres-v1";
import { evaluateResearchFeatureInvocationV1 } from "./research-feature-invocation-v1";
import { runOwnedResearchModeledStageV1 } from "./research-modeled-stage-kernel-v1";
import type { ResearchModeledStageSourceV1 } from "./research-modeled-stage-source-v1";
import { bindInputUseReceipt, buildResearchTrainingTraceV1, readCurrentTrace,
  readResearchStageLedgerProofV1, verifyCommittedTrace, isResearchAccountingFrontierConflictV1,
  type DiagnosticRow, type VerifiedTrace } from "./research-training-trace-internal-v1";

type Runtime = ReturnType<typeof resolveCurrentResearchExecutableIdentityV1>;
type IssuedTrace = VerifiedTrace & Readonly<{ sourceIssuanceDigest: string;
  sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED" }>;
type IssuedRow = DiagnosticRow & { source_run_id: string; source_issuance_digest: string };
type Attempt = { id: string; organization_id: string; schema_version: string;
  spec_sha256: string; source_run_id: string; source_issuance_digest: string; command_id: string };
type Outcome = Readonly<{ status: "COMMITTED" | "REPLAYED" | "CONFIRMED_AFTER_UNCERTAINTY"; trace: IssuedTrace }> |
  Readonly<{ status: "COMMIT_UNCERTAIN"; trace: null }>;

function refuse(reason: string): never { throw new Error(`RESEARCH_ISSUED_TRAINING_REFUSED:${reason}`); }

/** Construct codecs before BEGIN. The transport has no root-pool dispatch,
 * transaction, reserve, or close method: every statement uses the held backend. */
function heldExecutor(pool: postgres.Sql, signal: AbortSignal, deadline: number) {
  let held: postgres.Sql | undefined;
  const checkDeadline = () => {
    signal.throwIfAborted();
    if (performance.now() > deadline) refuse("DEADLINE");
  };
  const transport = { options: pool.options, unsafe: (...args: Parameters<postgres.Sql["unsafe"]>) => {
    checkDeadline();
    if (!held) refuse("HELD_TRANSACTION_REQUIRED");
    return held.unsafe(...args);
  } };
  const db = drizzle({ client: transport as unknown as postgres.Sql, schema });
  const executor = Object.freeze({ select: db.select.bind(db), insert: db.insert.bind(db),
    update: db.update.bind(db), execute: db.execute.bind(db) });
  return { executor, checkDeadline, bind(tx: postgres.Sql) {
    if (held || typeof (tx as unknown as postgres.TransactionSql).savepoint !== "function" ||
        typeof tx.begin === "function") refuse("HELD_TRANSACTION_INVALID");
    held = tx;
  }, unbind() { held = undefined; } };
}

async function ownedSession<T>(url: string, signal: AbortSignal, deadline: number, readOnly: boolean,
  work: (tx: postgres.Sql, executor: ReturnType<typeof heldExecutor>["executor"], checkDeadline: () => void) => Promise<T>) {
  signal.throwIfAborted();
  if (performance.now() > deadline) refuse("DEADLINE");
  return withResearchOwnedPostgresPoolV1(url, signal, 180_000, async pool => {
    const held = heldExecutor(pool, signal, deadline);
    const enter = async (tx: postgres.Sql) => {
      held.checkDeadline(); held.bind(tx);
      try {
        if (readOnly) await tx`SET TRANSACTION READ ONLY`;
        const result = await work(tx, held.executor, held.checkDeadline);
        held.checkDeadline(); return result;
      } finally { held.unbind(); }
    };
    return await (readOnly ? withPostgresSessionTransaction(pool, "REPEATABLE READ", enter)
      : withPostgresSerializableTransactionRetry(pool, enter));
  });
}

async function readInput(tx: postgres.Sql, request: ResearchIssuedTrainingRequestV2,
  runtime: Runtime, readOnly: boolean) {
  const rows = await tx<Attempt[]>`SELECT id::text,organization_id::text,schema_version,
    spec_sha256,source_run_id,source_issuance_digest,command_id
    FROM public.trader_research_issued_attempts_v2
    WHERE organization_id=${request.organizationId}::uuid AND id=${request.attemptId}::uuid
    ${readOnly ? tx`` : tx`FOR UPDATE`}`;
  const attempt = rows[0];
  if (rows.length !== 1 || !attempt || attempt.schema_version !== "waia.research.issued-attempt.v2" ||
      attempt.id !== deterministicUuidV8(computeStableJsonDigest({ schemaVersion: "waia.research.issued-attempt.v2",
        organizationId: request.organizationId, commandId: attempt.command_id }))) refuse("ISSUED_ATTEMPT_REQUIRED");
  const bound = await readResearchIssuedSourceAndExperimentV2(tx, request.organizationId,
    attempt.spec_sha256, attempt.source_run_id, runtime);
  if (attempt.source_issuance_digest !== bound.issuance.contentDigest) refuse("ISSUANCE_CHANGED");
  const parameters = bound.experiment.spec.orderedTrials[request.trialIndex];
  if (!parameters) refuse("TRIAL_NOT_DECLARED");
  const policy = resolveResearchTrainingPolicyV1(bound.experiment.spec);
  if (bound.issuance.training.barCount > request.limits.maxBars) refuse("BAR_LIMIT");
  const existingRows = await tx<IssuedRow[]>`SELECT organization_id::text,attempt_id::text,trial_index,
    stage_run_id::text,experiment_spec_sha256,source_run_id,source_issuance_digest,
    scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
    FROM public.trader_research_issued_training_diagnostics_v2
    WHERE organization_id=${request.organizationId}::uuid AND attempt_id=${request.attemptId}::uuid
      AND trial_index=${request.trialIndex}`;
  if (existingRows.length > 1) refuse("DIAGNOSTIC_IDENTITY");
  const existing = existingRows[0];
  if (readOnly && !existing) refuse("COMMITTED_RESULT_REQUIRED");
  if (existing) readCurrentTrace(existing, RESEARCH_ISSUED_TRAINING_DIAGNOSTIC_V2);
  // All supported policy, trial, runtime and durable metadata checks precede payload.
  const checked = await readResearchDevelopmentSourceRowsV1(tx, bound.issuance,
    { maxBytes: request.limits.maxBytes });
  const start = checked.issuance.request.observationBarCount + checked.issuance.request.gapBarCount;
  const cycles = validateResearchTrainingCyclesV1(checked.cycles.slice(start),
    bound.experiment.spec.replay.volumeQualificationSha256);
  const identity = Object.freeze({ schemaVersion: "waia.research.issued_training_ledger_scope.v2",
    organizationId: request.organizationId, attemptId: attempt.id,
    experimentSpecSha256: attempt.spec_sha256, sourceRunId: attempt.source_run_id,
    sourceIssuanceDigest: attempt.source_issuance_digest, trialIndex: request.trialIndex,
    parameters, partitionSha256: bound.experiment.spec.partitions.train.contentSha256 });
  const contentDigest = computeStableJsonDigest(identity);
  const stageRunId = deterministicUuidV8(contentDigest);
  const scope = Object.freeze({ authority: "ROW_SCOPE_ONLY" as const, identity, contentDigest,
    logicalAccountKey: bound.experiment.spec.replay.accountKey,
    ledgerScope: captureHistoricalMockLedgerScope({ organizationId: request.organizationId,
      historicalRunId: stageRunId, historicalAccountKey: `research-issued-stage:${stageRunId}` }) });
  const source: ResearchModeledStageSourceV1 = Object.freeze({
    authority: "TRAINING_EXECUTION_INPUT_INTEGRITY_ONLY", source: "PRE_HOLDOUT_DEVELOPMENT_AUTHORITY_V2",
    sourceRunId: attempt.source_run_id, datasetAuthorityDigest: bound.issuance.qualificationReceiptDigest,
    scope, partition: bound.experiment.spec.partitions.train, bars: checked.training,
    cycles, experiment: bound.experiment, volumeQualificationSha256: bound.issuance.volumeQualificationDigest });
  return { source, policy, existing, stageRunId, sourceIssuanceDigest: attempt.source_issuance_digest };
}

async function executeOrVerify(tx: postgres.Sql, executor: ReturnType<typeof heldExecutor>["executor"],
  request: ResearchIssuedTrainingRequestV2, runtime: Runtime, confirmationDigest?: string,
  verificationOnly = confirmationDigest !== undefined) {
  const bound = await readInput(tx, request, runtime, verificationOnly);
  const { source, policy, stageRunId, sourceIssuanceDigest, existing } = bound;
  const { organizationId } = request;
  const accountKey = source.scope.ledgerScope.historicalAccountKey;
  const model = createHistoricalExecutionModelV1();
  if (computeStableJsonDigest(model) !== policy.historicalExecutionModelSha256) refuse("MODEL_CHANGED");
  const { ledger, readLedgerDigest } = await readResearchStageLedgerProofV1(executor,
    { organizationId, stageRunId, accountKey });
  if (existing) {
    if (existing.source_run_id !== source.sourceRunId || existing.source_issuance_digest !== sourceIssuanceDigest) {
      refuse("DIAGNOSTIC_SOURCE_CHANGED");
    }
    const invocations = source.cycles.map((cycle, index) => evaluateResearchFeatureInvocationV1({
      parameters: source.scope.identity.parameters, bars: source.bars,
      symbol: source.experiment.spec.universe.symbol, interval: "1m", index,
      sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId }).invocationReceipt);
    const trace = verifyCommittedTrace(existing, { organizationId, attemptId: request.attemptId,
      trialIndex: request.trialIndex, stageRunId, specSha256: source.experiment.specSha256,
      scopeDigest: source.scope.contentDigest, policyDigest: policy.guardianResolvedPolicySha256,
      observedExecutableIdentity: runtime, inputUseReceipt: bindInputUseReceipt(source, policy, runtime, invocations),
      traceSchemaVersion: RESEARCH_ISSUED_TRAINING_DIAGNOSTIC_V2, sourceIssuanceDigest }) as IssuedTrace;
    // V2's visible lineage must describe the checked input itself. A canonical
    // reseal of labels cannot borrow authority from an unchanged input receipt.
    const expectedLineage = {
      sourceRunId: source.sourceRunId, experimentSpecSha256: source.experiment.specSha256,
      trainPartitionSha256: source.partition.contentSha256,
      historicalExecutionModelSha256: policy.historicalExecutionModelSha256,
      requestedExecutableSourceSha256: policy.requestedExecutableSourceSha256,
      requestedPointInTimeEvidenceSha256: policy.requestedPointInTimeEvidenceSha256,
      barCount: source.bars.length,
    };
    if (Object.entries(expectedLineage).some(([key, value]) => trace[key] !== value)) {
      refuse("COMMITTED_TRACE_LINEAGE_MISMATCH");
    }
    const [last] = await executor.execute<{ semantic_content_digest: string }>(query`
      SELECT semantic_content_digest FROM public.trader_accounting_frontier
      WHERE organization_id=${organizationId}::uuid AND account_key=${accountKey} AND run_id=${stageRunId}
      ORDER BY accounting_sequence DESC LIMIT 1`);
    if (ledger.order_count !== String(trace.orderCount) || ledger.fill_count !== String(trace.fillCount) ||
        ledger.frontier_count !== String(trace.accountingSequence) ||
        last?.semantic_content_digest !== trace.finalAccountingDigestHex ||
        await readLedgerDigest() !== trace.ledgerDigestHex ||
        (confirmationDigest !== undefined && confirmationDigest !== trace.traceSha256)) refuse("COMMITTED_LEDGER_DIVERGENT");
    return { status: "REPLAYED" as const, trace: deepFreezeInquiry(trace) };
  }
  if (verificationOnly) refuse("COMMIT_NOT_CONFIRMED");
  if (ledger.order_count !== "0" || ledger.fill_count !== "0" || ledger.frontier_count !== "0") refuse("UNCOMMITTED_LEDGER");
  const stage = await runOwnedResearchModeledStageV1({ tx: executor, source, request, policy, model });
  const trace = buildResearchTrainingTraceV1({ source, request, policy, observedExecutableIdentity: runtime,
    stage, ledgerDigestHex: await readLedgerDigest() });
  const canonical = canonicalJsonString(trace);
  if (Buffer.byteLength(canonical, "utf8") > 16 * 1024 * 1024) refuse("TRACE_BYTE_LIMIT");
  const digest = computeStableJsonDigest(trace);
  await tx`INSERT INTO public.trader_research_issued_training_diagnostics_v2
    (organization_id,attempt_id,trial_index,stage_run_id,experiment_spec_sha256,source_run_id,
      source_issuance_digest,scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256)
    VALUES (${organizationId}::uuid,${request.attemptId}::uuid,${request.trialIndex},${stageRunId}::uuid,
      ${source.experiment.specSha256},${source.sourceRunId},${sourceIssuanceDigest},${source.scope.contentDigest},
      ${policy.guardianResolvedPolicySha256},${canonical},${digest})`;
  return { status: "COMMITTED" as const,
    trace: deepFreezeInquiry({ ...trace, traceSha256: digest }) as IssuedTrace };
}

/** Owned noncapital DEVELOPMENT diagnostic. No public callback can replace its
 * source, transaction, evaluator or qualification result. */
export async function runResearchIssuedTrainingDiagnosticPostgresV2(supplied: unknown): Promise<Outcome> {
  const deadline = performance.now() + 180_000;
  const signal = AbortSignal.timeout(180_000);
  const request = captureResearchIssuedTrainingRequestV2(supplied);
  const runtime = resolveCurrentResearchExecutableIdentityV1();
  const url = process.env.DATABASE_URL_POSTGRES;
  if (!url) refuse("DATABASE_REQUIRED");
  let candidate: IssuedTrace | undefined;
  try {
    return await ownedSession(url, signal, deadline, false, async (tx, executor, checkDeadline) => {
      candidate = undefined; // A known serialization retry never carries its predecessor's trace.
      const result = await executeOrVerify(tx, executor, request, runtime);
      checkDeadline(); candidate = result.trace;
      return Object.freeze(result);
    });
  } catch (error) {
    if (isResearchAccountingFrontierConflictV1(error)) {
      // The driver has rolled back a known uniqueness failure. A concurrently
      // committed identical result may be verified, but no fresh effects run.
      try {
        return await ownedSession(url, signal, deadline, true, (tx, executor) =>
          executeOrVerify(tx, executor, request, runtime, undefined, true));
      } catch { throw error; }
    }
    const code = (error as { code?: string } | null)?.code ?? "";
    if (!candidate || (/^[0-9A-Z]{5}$/.test(code) && !/^(08|57)/.test(code))) throw error;
    const expected = candidate;
    try {
      const confirmed = await ownedSession(url, signal, deadline, true, (tx, executor) =>
        executeOrVerify(tx, executor, request, runtime, expected.traceSha256));
      return Object.freeze({ status: "CONFIRMED_AFTER_UNCERTAINTY", trace: confirmed.trace });
    } catch {
      return Object.freeze({ status: "COMMIT_UNCERTAIN", trace: null });
    }
  }
}
