import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import { loadRegisteredResearchTrainingExecutionInputPostgresV1 } from "@/lib/trader/research/research-training-payload-postgres-v1";
import { resolveResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";
import { runOwnedResearchModeledStageV1 } from "@/lib/trader/research/research-modeled-stage-kernel-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "@/lib/trader/research/research-executable-runtime-identity-v1";
import { loadResearchTrainingLedgerScopePostgresV1 } from "@/lib/trader/research/research-attempt-registry-postgres-v1";
import { loadRegisteredResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { evaluateResearchFeatureInvocationV1 } from "@/lib/trader/research/research-feature-invocation-v1";

import { bindInputUseReceipt, verifyCommittedTrace, readCurrentTrace, readResearchStageLedgerProofV1, buildResearchTrainingTraceV1,
  isResearchAccountingFrontierConflictV1,
  type DiagnosticRow, type VerifiedTrace } from "./research-training-trace-internal-v1";
export { RESEARCH_TRAINING_DIAGNOSTIC_V1, RESEARCH_TRAINING_DIAGNOSTIC_V2 } from "./research-training-trace-internal-v1";
const REQUEST = z.object({
  attemptId: z.string().uuid(), trialIndex: z.number().int().min(0).max(31),
  limits: z.object({ maxBars: z.number().int().min(1).max(4096),
    maxBytes: z.number().int().min(1).max(32 * 1024 * 1024) }).strict(),
}).strict();

function refuse(reason: string): never {
  throw new Error(`RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:${reason}`);
}

/** A non-qualifying diagnostic of one preregistered DEVELOPMENT trial. The
 * caller supplies no bars, results, policy, scorer, order port or authority
 * callback. All effects and the result share the locked root transaction. */
export async function runRegisteredResearchTrainingDiagnosticPostgresV1(
  db: WaiaPostgresDb, context: OrgContext, supplied: z.infer<typeof REQUEST>,
) {
  return runRegisteredDiagnosticInternal(db, context, supplied, false);
}

async function runRegisteredDiagnosticInternal(
  db: WaiaPostgresDb, context: OrgContext, supplied: z.infer<typeof REQUEST>, verificationOnly: boolean,
): Promise<VerifiedTrace | (ReturnType<typeof buildResearchTrainingTraceV1> & { traceSha256: string })> {
  assertResearchRootPostgresDbV1(db);
  const organizationId = requireOrgContext(context.organizationId).organizationId.toLowerCase();
  const parsedRequest = REQUEST.parse(supplied);
  const request = Object.freeze({ ...parsedRequest,
    attemptId: parsedRequest.attemptId.toLowerCase() });
  const captured = Object.freeze({ organizationId });
  const observedExecutableIdentity = resolveCurrentResearchExecutableIdentityV1();
  // Only committed attempt/spec metadata is read before the executable matches.
  // Requested identity never substitutes for the deployment owner's assertion.
  const preflightScope = await loadResearchTrainingLedgerScopePostgresV1(db, captured, {
    attemptId: request.attemptId, trialIndex: request.trialIndex,
  });
  const preflightExperiment = await loadRegisteredResearchExperimentPostgresV1(
    db, captured, preflightScope.identity.experimentSpecSha256,
  );
  if (preflightExperiment.spec.executable.sourceSha256 !== observedExecutableIdentity.sourceSha256) {
    refuse("EXECUTABLE_IDENTITY_MISMATCH");
  }
  // Unsupported policy/sidecar is a metadata-only refusal before price access.
  const policy = resolveResearchTrainingPolicyV1(preflightExperiment.spec);
  // Legacy evidence must refuse even if its old source rows are unavailable.
  // This early read grants nothing; current V2 is re-read under the stage lock.
  const [preflightTrace] = await db.execute<Pick<DiagnosticRow, "trace_canonical_json" | "trace_sha256">>(sql`
    select trace_canonical_json,trace_sha256 from public.trader_research_training_diagnostics_v1
    where organization_id=${organizationId}::uuid and attempt_id=${request.attemptId}::uuid
      and trial_index=${request.trialIndex}`);
  if (preflightTrace) readCurrentTrace(preflightTrace);
  else if (verificationOnly) refuse("COMMITTED_RESULT_REQUIRED");
  const source = await loadRegisteredResearchTrainingExecutionInputPostgresV1(db, captured, request);
  if (source.scope.contentDigest !== preflightScope.contentDigest ||
      source.experiment.specSha256 !== preflightExperiment.specSha256) {
    refuse("PREFLIGHT_SOURCE_IDENTITY_CHANGED");
  }
  const { scope } = source;
  const stageRunId = scope.ledgerScope.historicalRunId;
  const accountKey = scope.ledgerScope.historicalAccountKey;
  const expected = Object.freeze({ organizationId, attemptId: request.attemptId,
    trialIndex: request.trialIndex, stageRunId, specSha256: scope.identity.experimentSpecSha256,
    scopeDigest: scope.contentDigest, policyDigest: policy.guardianResolvedPolicySha256,
    observedExecutableIdentity });
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
      where organization_id=${organizationId}::uuid and id=${request.attemptId}::uuid
        ${verificationOnly ? sql`` : sql`for update`}`);
    if (!attempt || attempt.spec_sha256 !== expected.specSha256 ||
        attempt.source_run_id !== source.sourceRunId) refuse("ATTEMPT_LOCK_IDENTITY");
    const [existing] = await tx.execute<DiagnosticRow>(sql`
      select organization_id::text,attempt_id::text,trial_index,stage_run_id::text,
        experiment_spec_sha256,scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
      from public.trader_research_training_diagnostics_v1
      where organization_id=${organizationId}::uuid and attempt_id=${request.attemptId}::uuid
        and trial_index=${request.trialIndex}`);
    const { ledger, readLedgerDigest } = await readResearchStageLedgerProofV1(tx, { organizationId, stageRunId, accountKey });
    if (existing) {
      // Recompute only pure evaluator calls on retry; never replay order effects.
      const invocations = source.cycles.map((cycle, index) =>
        evaluateResearchFeatureInvocationV1({ parameters: scope.identity.parameters,
          bars: source.bars, symbol: source.experiment.spec.universe.symbol, interval: "1m",
          index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId }).invocationReceipt);
      const committed = verifyCommittedTrace(existing, { ...expected,
        inputUseReceipt: bindInputUseReceipt(source, policy, observedExecutableIdentity, invocations) });
      const expectedLineage = {
        sourceRunId: source.sourceRunId, experimentSpecSha256: source.experiment.specSha256,
        trainPartitionSha256: source.partition.contentSha256,
        historicalExecutionModelSha256: policy.historicalExecutionModelSha256,
        requestedExecutableSourceSha256: policy.requestedExecutableSourceSha256,
        requestedPointInTimeEvidenceSha256: policy.requestedPointInTimeEvidenceSha256,
        barCount: source.bars.length,
      };
      if (Object.entries(expectedLineage).some(([key, value]) => committed[key] !== value)) {
        refuse("COMMITTED_TRACE_LINEAGE_MISMATCH");
      }
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
    if (verificationOnly) refuse("COMMITTED_RESULT_REQUIRED");
    if (ledger.order_count !== "0" || ledger.fill_count !== "0" || ledger.frontier_count !== "0") {
      refuse("UNCOMMITTED_STAGE_LEDGER_EXISTS");
    }

    const { accounting, decisions, advances, fillDetails, orderRows, openOrderIds, invocations } =
      await runOwnedResearchModeledStageV1({ tx, source, request, policy, model });
    const trace = buildResearchTrainingTraceV1({ source, request, policy, observedExecutableIdentity,
      stage: { accounting, decisions, advances, fillDetails, orderRows, openOrderIds, invocations },
      ledgerDigestHex: await readLedgerDigest() });
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
  }, { isolationLevel: "serializable", ...(verificationOnly ? { accessMode: "read only" as const } : {}) });
  } catch (error) {
    if (!verificationOnly && isResearchAccountingFrontierConflictV1(error)) {
      try {
        // Re-enter only the private read-only route, including a fresh source
        // read. This cannot enter the stage kernel or mutate any result.
        return await runRegisteredDiagnosticInternal(db, captured, request, true);
      } catch { throw error; }
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "40001") refuse("SERIALIZATION_RETRY_REQUIRED");
    if (code === "55P03") refuse("LOCK_TIMEOUT_RETRY_REQUIRED");
    throw error;
  }
}
