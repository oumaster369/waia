import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import type postgres from "postgres";
import { createAccountingFrontierRepositoryPostgres } from "@/lib/trader/accounting/accounting-frontier-repository-postgres";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { TERMINAL_ORDER_STATES } from "@/lib/trader/execution/order-state-machine";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { buildResearchTrainingFamilyReceiptV1, captureResearchTrainingFamilyRequestV1,
  requireCanonicalResearchSelectionDecimalV1,
  type ResearchTrainingFamilyReceiptV1, type ResearchTrainingFamilyRequestV1,
  type ResearchTrainingTrialSummaryV1 } from "./research-training-family-contract-v1";
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
import { readResearchEvaluationSourceIssuanceV1 } from "./research-development-evaluation-source-read-v1";
import { captureResearchDevelopmentEvaluationClaimRequestV1, RESEARCH_DEVELOPMENT_EVALUATION_CLAIM_V1,
  type ResearchDevelopmentEvaluationClaimRequestV1 } from "./research-development-evaluation-claim-contract-v1";
import { strategyAdmissionHypothesisId } from "./strategy-admission-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "./research-executable-runtime-identity-v1";
import { resolveResearchTrainingPolicyV1 } from "./research-training-policy-v1";
import { validateResearchTrainingCyclesV1 } from "./research-training-payload-postgres-v1";
import { evaluateResearchFeatureInvocationV1 } from "./research-feature-invocation-v1";
import { runOwnedResearchModeledStageV1, sealOwnedResearchModeledStageDescriptorV1 } from "./research-modeled-stage-kernel-v1";
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

async function readIssuedMetadata(tx: postgres.Sql, request: Pick<ResearchIssuedTrainingRequestV2, "organizationId" | "attemptId">,
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
  return { attempt, bound };
}

async function readInput(tx: postgres.Sql, request: ResearchIssuedTrainingRequestV2,
  runtime: Runtime, readOnly: boolean) {
  const { attempt, bound } = await readIssuedMetadata(tx, request, runtime, readOnly);
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
  const stage = await runOwnedResearchModeledStageV1({
    executor,
    descriptor: sealOwnedResearchModeledStageDescriptorV1({
      attemptId: request.attemptId, trialIndex: request.trialIndex, policy, model,
    }),
    payload: source,
  });
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

type FamilyRow = { organization_id: string; attempt_id: string; experiment_spec_sha256: string;
  source_run_id: string; source_issuance_digest: string; receipt_canonical_json: string; receipt_sha256: string };
type FamilyOutcome = Readonly<{ status: "COMMITTED" | "REPLAYED" | "CONFIRMED_AFTER_UNCERTAINTY";
  receipt: ResearchTrainingFamilyReceiptV1 }> | Readonly<{ status: "COMMIT_UNCERTAIN"; receipt: null }>;

function familyRefuse(reason: string): never { throw new Error(`RESEARCH_FAMILY_SELECTION_REFUSED:${reason}`); }

/** Uses only the existing verification branch: a missing trial cannot cause a
 * modeled execution. All family evidence is checked in this owned snapshot. */
async function verifyFamilyAndPersist(tx: postgres.Sql, executor: ReturnType<typeof heldExecutor>["executor"],
  request: ResearchTrainingFamilyRequestV1, runtime: Runtime, readOnly: boolean,
  checkDeadline: () => void, expectedDigest?: string) {
  const { attempt, bound } = await readIssuedMetadata(tx, request, runtime, readOnly);
  const { spec } = bound.experiment;
  const policy = resolveResearchTrainingPolicyV1(spec);
  if (bound.issuance.training.barCount > request.limits.maxBars) familyRefuse("BAR_LIMIT");
  const metadata = await tx<{ trial_index: number; experiment_spec_sha256: string; source_run_id: string;
    source_issuance_digest: string; trace_sha256: string; trace_bytes: number }[]>`
    SELECT trial_index,experiment_spec_sha256,source_run_id,source_issuance_digest,trace_sha256,
      octet_length(trace_canonical_json) AS trace_bytes
    FROM public.trader_research_issued_training_diagnostics_v2
    WHERE organization_id=${request.organizationId}::uuid AND attempt_id=${request.attemptId}::uuid
    ORDER BY trial_index`;
  if (metadata.length !== spec.orderedTrials.length || metadata.some((row, index) =>
    row.trial_index !== index || row.experiment_spec_sha256 !== attempt.spec_sha256 ||
    row.source_run_id !== attempt.source_run_id || row.source_issuance_digest !== attempt.source_issuance_digest ||
    !/^[a-f0-9]{64}$/.test(row.trace_sha256))) {
    familyRefuse("COMPLETE_ISSUED_FAMILY_REQUIRED");
  }
  if (metadata.some(row => !Number.isSafeInteger(row.trace_bytes) || row.trace_bytes < 1) ||
      metadata.reduce((sum, row) => sum + row.trace_bytes, 0) > request.limits.maxTraceBytes) {
    familyRefuse("TRACE_BYTE_LIMIT");
  }
  // PostgreSQL must not parse trace JSON until the whole family's byte budget
  // is proved. Check every schema now, before any trial can read source payload.
  const schemas = await tx<{ trial_index: number; schema_version: string | null }[]>`
    SELECT trial_index,trace_canonical_json::jsonb->>'schemaVersion' AS schema_version
    FROM public.trader_research_issued_training_diagnostics_v2
    WHERE organization_id=${request.organizationId}::uuid AND attempt_id=${request.attemptId}::uuid
    ORDER BY trial_index`;
  if (schemas.length !== metadata.length || schemas.some((row, index) =>
    row.trial_index !== index || row.schema_version !== RESEARCH_ISSUED_TRAINING_DIAGNOSTIC_V2)) {
    familyRefuse("COMPLETE_ISSUED_FAMILY_REQUIRED");
  }
  const rows = await tx<FamilyRow[]>`SELECT organization_id::text,attempt_id::text,experiment_spec_sha256,
    source_run_id,source_issuance_digest,receipt_canonical_json,receipt_sha256
    FROM public.trader_research_training_family_selections_v1
    WHERE organization_id=${request.organizationId}::uuid AND attempt_id=${request.attemptId}::uuid`;
  if (rows.length > 1 || (readOnly && rows.length !== 1)) familyRefuse("COMMITTED_SELECTION_REQUIRED");
  const existing = rows[0];
  const trials: ResearchTrainingTrialSummaryV1[] = [];
  for (let trialIndex = 0; trialIndex < spec.orderedTrials.length; trialIndex += 1) {
    checkDeadline();
    const { trace } = await executeOrVerify(tx, executor, { ...request, trialIndex }, runtime, undefined, true);
    if (trace.traceSha256 !== metadata[trialIndex]!.trace_sha256 ||
        trace.sourceRunId !== attempt.source_run_id || trace.sourceIssuanceDigest !== attempt.source_issuance_digest ||
        trace.experimentSpecSha256 !== attempt.spec_sha256 || trace.trainPartitionSha256 !== spec.partitions.train.contentSha256 ||
        trace.policyDigestHex !== policy.guardianResolvedPolicySha256) familyRefuse("TRIAL_BINDING_CHANGED");
    const accountKey = `research-issued-stage:${trace.stageRunId}`;
    const frontier = await createAccountingFrontierRepositoryPostgres(executor).loadLatest(
      { organizationId: request.organizationId }, { accountKey, runId: trace.stageRunId });
    if (!frontier || frontier.organizationId !== request.organizationId || frontier.accountKey !== accountKey ||
        frontier.runId !== trace.stageRunId || frontier.accountingSequence !== trace.accountingSequence ||
        frontier.semanticContentDigest !== trace.finalAccountingDigestHex ||
        computeAccountingSemanticDigest(frontier) !== frontier.semanticContentDigest) familyRefuse("ACCOUNTING_IDENTITY");
    const netRealizedPnl = requireCanonicalResearchSelectionDecimalV1(frontier.netRealizedPnl);
    if (requireCanonicalResearchSelectionDecimalV1(trace.netRealizedPnl) !== netRealizedPnl) familyRefuse("METRIC_MISMATCH");
    const orders = await tx<{ state: string }[]>`SELECT state FROM public.trader_orders
      WHERE organization_id=${request.organizationId}::uuid AND historical_run_id=${trace.stageRunId}
        AND historical_account_key=${accountKey}`;
    if (orders.length !== trace.orderCount || orders.some(order => !TERMINAL_ORDER_STATES.some(state => state === order.state)) ||
        Object.values(frontier.positions).some(position => [position.quantity, position.grossPositionBasis,
          position.netPositionBasis].some(value => compareDecimal(value, "0") !== 0)) ||
        trace.openPositions.length !== 0 || !Array.isArray(trace.openOrderIds) || trace.openOrderIds.length !== 0 ||
        compareDecimal(requireCanonicalResearchSelectionDecimalV1(trace.netUnrealizedPnl), "0") !== 0) {
      familyRefuse("FAMILY_TRIAL_NOT_TERMINAL_FLAT");
    }
    trials.push({ trialIndex, stageRunId: trace.stageRunId, traceSha256: trace.traceSha256,
      scopeDigestHex: trace.scopeDigestHex, ledgerDigestHex: trace.ledgerDigestHex,
      finalAccountingDigestHex: trace.finalAccountingDigestHex, netRealizedPnl,
      orderCount: trace.orderCount, fillCount: trace.fillCount });
  }
  checkDeadline();
  const receipt = buildResearchTrainingFamilyReceiptV1({ organizationId: request.organizationId,
    attemptId: request.attemptId, spec, experimentSpecSha256: attempt.spec_sha256,
    sourceRunId: attempt.source_run_id, sourceIssuanceDigest: attempt.source_issuance_digest,
    observedExecutableIdentity: runtime, policyDigestHex: policy.guardianResolvedPolicySha256, trials });
  const { contentDigest, ...body } = receipt;
  const canonical = canonicalJsonString(body);
  if (Buffer.byteLength(canonical, "utf8") > 262144) familyRefuse("RECEIPT_BYTE_LIMIT");
  if (expectedDigest !== undefined && expectedDigest !== contentDigest) familyRefuse("CONFIRMATION_MISMATCH");
  if (existing) {
    if (existing.organization_id !== request.organizationId || existing.attempt_id !== request.attemptId ||
        existing.experiment_spec_sha256 !== attempt.spec_sha256 || existing.source_run_id !== attempt.source_run_id ||
        existing.source_issuance_digest !== attempt.source_issuance_digest ||
        existing.receipt_canonical_json !== canonical || existing.receipt_sha256 !== contentDigest) {
      familyRefuse("COMMITTED_SELECTION_CHANGED");
    }
    return Object.freeze({ status: "REPLAYED" as const, receipt });
  }
  if (readOnly) familyRefuse("COMMITTED_SELECTION_REQUIRED");
  await tx`INSERT INTO public.trader_research_training_family_selections_v1
    (organization_id,attempt_id,experiment_spec_sha256,source_run_id,source_issuance_digest,receipt_canonical_json,receipt_sha256)
    VALUES (${request.organizationId}::uuid,${request.attemptId}::uuid,${attempt.spec_sha256},${attempt.source_run_id},
      ${attempt.source_issuance_digest},${canonical},${contentDigest})`;
  return Object.freeze({ status: "COMMITTED" as const, receipt });
}

/** Closed, nonqualifying selection of the entire predeclared DEVELOPMENT family.
 * It verifies existing diagnostics only; it cannot execute even a missing trial. */
export async function selectResearchIssuedTrainingFamilyPostgresV1(supplied: unknown): Promise<FamilyOutcome> {
  const deadline = performance.now() + 180_000;
  const signal = AbortSignal.timeout(180_000);
  const request = captureResearchTrainingFamilyRequestV1(supplied);
  const runtime = resolveCurrentResearchExecutableIdentityV1();
  const url = process.env.DATABASE_URL_POSTGRES;
  if (!url) familyRefuse("DATABASE_REQUIRED");
  let candidate: ResearchTrainingFamilyReceiptV1 | undefined;
  try {
    return await ownedSession(url, signal, deadline, false, async (tx, executor, checkDeadline) => {
      candidate = undefined;
      const result = await verifyFamilyAndPersist(tx, executor, request, runtime, false, checkDeadline);
      checkDeadline(); candidate = result.receipt; return result;
    });
  } catch (error) {
    const pg = error as { code?: string; schema_name?: string; table_name?: string; constraint_name?: string } | null;
    const unique = pg?.code === "23505" && pg.schema_name === "public" &&
      pg.table_name === "trader_research_training_family_selections_v1" &&
      pg.constraint_name === "research_training_family_selection_pkey";
    if (unique) {
      try { return await ownedSession(url, signal, deadline, true, (tx, executor, checkDeadline) =>
        verifyFamilyAndPersist(tx, executor, request, runtime, true, checkDeadline)); }
      catch { throw error; }
    }
    const code = pg?.code ?? "";
    if (!candidate || (/^[0-9A-Z]{5}$/.test(code) && !/^(08|57)/.test(code))) throw error;
    const expectedDigest = candidate.contentDigest;
    try {
      const confirmed = await ownedSession(url, signal, deadline, true, (tx, executor, checkDeadline) =>
        verifyFamilyAndPersist(tx, executor, request, runtime, true, checkDeadline, expectedDigest));
      return Object.freeze({ status: "CONFIRMED_AFTER_UNCERTAINTY", receipt: confirmed.receipt });
    } catch { return Object.freeze({ status: "COMMIT_UNCERTAIN", receipt: null }); }
  }
}

type EvaluationClaimRow = {
  claim_id: string; organization_id: string; command_id: string; attempt_id: string;
  spec_sha256: string; hypothesis_id: string; split: string; selection_sha256: string;
  evaluation_source_id: string; evaluation_source_digest: string;
  receipt_canonical_json: string; receipt_sha256: string;
};
function claimRefuse(reason: string): never { throw new Error(`RESEARCH_EVALUATION_CLAIM_REFUSED:${reason}`); }

/** This private operation reads evaluation metadata only. Training verification
 * cannot execute a missing trial; all its payload belongs to already spent train. */
async function buildVerifiedEvaluationClaim(tx: postgres.Sql, executor: ReturnType<typeof heldExecutor>["executor"],
  request: ResearchDevelopmentEvaluationClaimRequestV1, runtime: Runtime, checkDeadline: () => void) {
  const { attempt, bound } = await readIssuedMetadata(tx, request, runtime, true);
  const evaluation = await readResearchEvaluationSourceIssuanceV1(tx, request.organizationId, request.evaluationSourceId);
  if (!evaluation) claimRefuse("COMMITTED_EVALUATION_SOURCE_REQUIRED");
  const m = evaluation.metadata;
  const train = bound.issuance;
  const { spec } = bound.experiment;
  const partition = (value: typeof m.validation) => ({ contentSha256: value.contentSha256,
    firstOpenMs: value.firstOpenMs, lastCloseMs: value.lastCloseMs, barCount: value.barCount });
  if (m.request.trainingSourceRunId !== attempt.source_run_id ||
      m.request.trainingSourceIssuanceDigest !== attempt.source_issuance_digest ||
      m.releaseSha !== runtime.releaseSha || m.request.symbol !== spec.universe.symbol ||
      m.sourceReleaseSha !== train.sourceReleaseSha || m.qualificationReceiptDigest !== train.qualificationReceiptDigest ||
      m.runtimeRequalificationDigest !== train.runtimeRequalificationDigest ||
      m.partitionRawSha256 !== train.partitionRawSha256 || m.partitionSemanticDigest !== train.partitionSemanticDigest ||
      m.volumeQualificationDigest !== train.volumeQualificationDigest ||
      canonicalJsonString(partition(m.validation)) !== canonicalJsonString(spec.partitions.validation) ||
      canonicalJsonString(m.walkForward.map(partition)) !== canonicalJsonString(spec.partitions.walkForward)) {
    claimRefuse("REGISTERED_EVALUATION_SOURCE_BINDING_MISMATCH");
  }
  const verified = await verifyFamilyAndPersist(tx, executor, request, runtime, true, checkDeadline);
  const family = verified.receipt;
  // This is the admission journal's existing string-valued parameter convention,
  // not a new identity namespace derived from attempt, source or command IDs.
  const parameters = Object.fromEntries(Object.entries(family.selectedParameters).map(([key, value]) => [key, String(value)]));
  const hypothesisId = strategyAdmissionHypothesisId(attempt.spec_sha256, parameters);
  const claimId = deterministicUuidV8(computeStableJsonDigest({ schemaVersion: RESEARCH_DEVELOPMENT_EVALUATION_CLAIM_V1,
    organizationId: request.organizationId, commandId: request.commandId }));
  const body = { schemaVersion: RESEARCH_DEVELOPMENT_EVALUATION_CLAIM_V1,
    authority: "PRE_DISCLOSURE_VALIDATION_RESERVATION_ONLY" as const,
    scientificQualified: false as const, capitalEligible: false as const,
    sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED" as const,
    claimId, organizationId: request.organizationId, commandId: request.commandId, attemptId: request.attemptId,
    experimentSpecSha256: attempt.spec_sha256, hypothesisId, split: "validation" as const,
    trainingSourceRunId: attempt.source_run_id, trainingSourceIssuanceDigest: attempt.source_issuance_digest,
    trainingFamilyReceiptSha256: family.contentDigest,
    selectedIndex: family.selectedIndex, selectedParameters: family.selectedParameters,
    observedExecutableIdentity: runtime, policyDigestHex: family.policyDigestHex,
    historicalExecutionModelSha256: family.historicalExecutionModelSha256,
    evaluationSourceId: request.evaluationSourceId, evaluationSourceIssuanceDigest: evaluation.contentDigest,
    evaluationRowSetSha256: evaluation.rowSetSha256,
    validation: spec.partitions.validation, walkForward: spec.partitions.walkForward };
  return deepFreezeInquiry({ ...body, contentDigest: computeStableJsonDigest(body) });
}
export type ResearchDevelopmentEvaluationClaimReceiptV1 = Awaited<ReturnType<typeof buildVerifiedEvaluationClaim>>;
type EvaluationClaimOutcome = Readonly<{ status: "COMMITTED" | "REPLAYED" | "CONFIRMED_AFTER_UNCERTAINTY";
  receipt: ResearchDevelopmentEvaluationClaimReceiptV1 }> | Readonly<{ status: "COMMIT_UNCERTAIN"; receipt: null }>;

async function reserveOrVerifyEvaluationClaim(tx: postgres.Sql, executor: ReturnType<typeof heldExecutor>["executor"],
  request: ResearchDevelopmentEvaluationClaimRequestV1, runtime: Runtime, readOnly: boolean,
  checkDeadline: () => void, expectedDigest?: string) {
  if (!readOnly) await tx`SELECT pg_advisory_xact_lock(hashtextextended(
    ${`research-evaluation-claim-v1:${request.organizationId}:${request.commandId}`},0))`;
  const receipt = await buildVerifiedEvaluationClaim(tx, executor, request, runtime, checkDeadline);
  const { contentDigest, ...body } = receipt;
  const canonical = canonicalJsonString(body);
  if (Buffer.byteLength(canonical, "utf8") > 262144) claimRefuse("RECEIPT_BYTE_LIMIT");
  if (expectedDigest !== undefined && contentDigest !== expectedDigest) claimRefuse("CONFIRMATION_MISMATCH");
  const readRows = () => tx<EvaluationClaimRow[]>`
    SELECT claim_id::text,organization_id::text,command_id,attempt_id::text,spec_sha256,hypothesis_id,split,
      selection_sha256,evaluation_source_id,evaluation_source_digest,receipt_canonical_json,receipt_sha256
    FROM public.trader_research_development_evaluation_claims_v1
    WHERE organization_id=${request.organizationId}::uuid AND command_id=${request.commandId}
      AND octet_length(receipt_canonical_json)<=262144`;
  const assertExact = (rows: EvaluationClaimRow[]) => {
    const row = rows[0];
    if (rows.length !== 1 || !row || row.claim_id !== receipt.claimId || row.organization_id !== request.organizationId ||
        row.command_id !== request.commandId || row.attempt_id !== request.attemptId ||
        row.spec_sha256 !== receipt.experimentSpecSha256 || row.hypothesis_id !== receipt.hypothesisId ||
        row.split !== "validation" || row.selection_sha256 !== receipt.trainingFamilyReceiptSha256 ||
        row.evaluation_source_id !== receipt.evaluationSourceId ||
        row.evaluation_source_digest !== receipt.evaluationSourceIssuanceDigest ||
        row.receipt_canonical_json !== canonical || row.receipt_sha256 !== contentDigest) claimRefuse("COMMITTED_CLAIM_CHANGED");
  };
  const rows = await readRows();
  if (rows.length) {
    assertExact(rows);
    const consumed = await tx`SELECT spec_sha256 FROM public.trader_strategy_admission_split_consume
      WHERE spec_sha256=${receipt.experimentSpecSha256} AND hypothesis_id=${receipt.hypothesisId} AND split='validation'`;
    if (consumed.length !== 1) claimRefuse("COMMITTED_CONSUME_REQUIRED");
    return Object.freeze({ status: "REPLAYED" as const, receipt });
  }
  if (readOnly) claimRefuse("COMMITTED_CLAIM_REQUIRED");
  // The existing global primary key arbitrates both legacy and this new owner.
  // SERIALIZABLE conflict with an invisible winner retries the whole snapshot.
  // A visible spent key is never adopted merely by supplying a new command.
  const inserted = await tx`INSERT INTO public.trader_strategy_admission_split_consume(spec_sha256,hypothesis_id,split)
    VALUES (${receipt.experimentSpecSha256},${receipt.hypothesisId},'validation')
    ON CONFLICT (spec_sha256,hypothesis_id,split) DO NOTHING RETURNING spec_sha256`;
  if (inserted.length !== 1) claimRefuse("VALIDATION_ALREADY_CONSUMED");
  await tx`INSERT INTO public.trader_research_development_evaluation_claims_v1
    (organization_id,claim_id,command_id,attempt_id,spec_sha256,hypothesis_id,split,selection_sha256,
     evaluation_source_id,evaluation_source_digest,receipt_canonical_json,receipt_sha256)
    VALUES (${request.organizationId}::uuid,${receipt.claimId}::uuid,${request.commandId},${request.attemptId}::uuid,
      ${receipt.experimentSpecSha256},${receipt.hypothesisId},'validation',${receipt.trainingFamilyReceiptSha256},
      ${receipt.evaluationSourceId},${receipt.evaluationSourceIssuanceDigest},${canonical},${contentDigest})`;
  assertExact(await readRows());
  checkDeadline();
  return Object.freeze({ status: "COMMITTED" as const, receipt });
}

/** Closed reservation only. Owns a root commit before returning metadata; never
 * exposes evaluation payload or invokes a validation/WF kernel. */
export async function reserveResearchDevelopmentEvaluationPostgresV1(supplied: unknown): Promise<EvaluationClaimOutcome> {
  const deadline = performance.now() + 180_000;
  const signal = AbortSignal.timeout(180_000);
  const request = captureResearchDevelopmentEvaluationClaimRequestV1(supplied);
  const runtime = resolveCurrentResearchExecutableIdentityV1();
  const url = process.env.DATABASE_URL_POSTGRES;
  if (!url) claimRefuse("DATABASE_REQUIRED");
  let candidate: ResearchDevelopmentEvaluationClaimReceiptV1 | undefined;
  try {
    return await ownedSession(url, signal, deadline, false, async (tx, executor, checkDeadline) => {
      candidate = undefined;
      const result = await reserveOrVerifyEvaluationClaim(tx, executor, request, runtime, false, checkDeadline);
      checkDeadline(); candidate = result.receipt; return result;
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? "";
    if (!candidate || (/^[0-9A-Z]{5}$/.test(code) && !/^(08|57)/.test(code))) throw error;
    const expectedDigest = candidate.contentDigest;
    try {
      const confirmed = await ownedSession(url, signal, deadline, true, (tx, executor, checkDeadline) =>
        reserveOrVerifyEvaluationClaim(tx, executor, request, runtime, true, checkDeadline, expectedDigest));
      return Object.freeze({ status: "CONFIRMED_AFTER_UNCERTAINTY", receipt: confirmed.receipt });
    } catch { return Object.freeze({ status: "COMMIT_UNCERTAIN", receipt: null }); }
  }
}
