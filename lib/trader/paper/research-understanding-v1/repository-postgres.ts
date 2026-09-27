import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { type OrgContext } from "@/lib/waia-core/scope/org-context";
import { persistRequiredInformationProfileWithinTransactionV2Postgres, persistInformationSufficiencyReceiptWithinTransactionV2Postgres,
  requireInformationSufficiencyAuthorityWithinTransactionV2Postgres } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres";
import { lockRuntimeOrganizationV2, assertRuntimeDatabaseClockHolderV2, type DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { copy, digest, seal, assertEnvironment } from "../durable-noncapital/recorded-analysis-v1";
import { encodeBody } from "../durable-noncapital/recorded-source-read-validation-v1";
import { check, bounded, buildResearchAssignment, RESEARCH_CONTRACT, LIMITS } from "./contract";
import { ResearchReadBudget, readBoundedResearchProfile, readBoundedResearchCompletion,
  readBoundedResearchInputs, readBoundedResearchPredecessor, admitOptionalStoredProfile, admitOptionalStoredReceipt } from "./bounded-source-postgres";

export type { ResearchRequest, CapturedResearchRequest, ResearchCompletion } from "./held-replay";
import { captureResearchReplaySelector, researchActor as actor, checkRequestedProfile,
  readResearchAssignmentWithinHeldTransaction as readAssignment, readResearchSnapshotWithinHeldTransaction,
  verifyResearchSnapshotComputed as verifyComputed, type ResearchRequest, type CapturedResearchRequest, type ResearchCompletion } from "./held-replay";

export function captureResearchCommand(pool: postgres.Sql, suppliedContext: OrgContext, supplied: ResearchRequest) {
  // Actual postgres.js TransactionSql has savepoint and no root begin. No nested public transaction.
  check(typeof pool.begin === "function" && typeof (pool as unknown as { savepoint?: unknown }).savepoint !== "function", "POOL_REQUIRED");
  return captureResearchReplaySelector(suppliedContext, supplied);
}
function holderColumns(holder: DatabaseClockRuntimeHolderV2) {
  return { runtimeInstanceId: holder.runtimeInstanceId, leaseEpoch: holder.leaseEpoch, leaseContentDigest: holder.leaseContentDigest };
}
async function settings(tx: WaiaPostgresDb): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`set local statement_timeout = '30s'`);
}
async function snapshot(db: WaiaPostgresDb, context: OrgContext, request: CapturedResearchRequest, sourceSequence: number) {
  return db.transaction(async tx => {
    await settings(tx);
    return readResearchSnapshotWithinHeldTransaction(tx, context, request, sourceSequence);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Read-only completed replay owns its fixed computation; no provider, clock reselection or lease claim. */
async function replayCompletedResearch(pool: postgres.Sql, context: OrgContext, request: CapturedResearchRequest, sourceSequence: number, assertDeadline: () => void) {
  const saved = await snapshot(drizzle(pool, { schema }), context, request, sourceSequence);
  assertDeadline();
  if (!saved?.completion) return null;
  verifyComputed(saved);
  assertDeadline();
  return { outcome: "REPLAYED" as const, completion: saved.completion };
}

async function ensureAssignment(db: WaiaPostgresDb, context: OrgContext, request: CapturedResearchRequest, holder: DatabaseClockRuntimeHolderV2, assertDeadline: () => void) {
  return db.transaction(async tx => {
    await settings(tx); await lockRuntimeOrganizationV2(tx, context.organizationId);
    const assignedAt = await assertRuntimeDatabaseClockHolderV2(tx, holder); assertDeadline();
    const authorizedActor = await actor(tx, context);
    const existing = await readAssignment(tx, context, request, new ResearchReadBudget(LIMITS.inputAggregate));
    if (existing) return existing;
    const profile = "body" in request.profile ? request.profile.body : await readBoundedResearchProfile(tx, context.organizationId, request.profile.id);
    checkRequestedProfile(profile, request);
    const assignment = buildResearchAssignment(request.assignment, profile, authorizedActor, assignedAt);
    // The original held writer is reused only after its possible existing exact row is bounded.
    await admitOptionalStoredProfile(tx, context.organizationId, profile.id);
    assertDeadline();
    await persistRequiredInformationProfileWithinTransactionV2Postgres(tx, context, profile);
    await tx.insert(schema.traderResearchUnderstandingAssignmentsV1).values({ organizationId: assignment.organizationId,
      sessionId: assignment.researchSessionId, contentDigest: assignment.contentDigest, bodyJson: encodeBody(assignment),
      profileId: profile.id, profileContentDigest: profile.contentDigest, sourceSessionId: assignment.sourceSessionId,
      sourceConfigDigest: assignment.sourceConfigDigest, ...holderColumns(holder) });
    await assertRuntimeDatabaseClockHolderV2(tx, holder);
    assertDeadline(); return { assignment, profile };
  }, { isolationLevel: "read committed" });
}

/** Fixed command boundary. All computation and the held writer are private; no supplied output/callback. */
async function completeSavedResearch(pool: postgres.Sql, context: OrgContext, request: CapturedResearchRequest,
  sourceSequence: number, holder: DatabaseClockRuntimeHolderV2, assertDeadline: () => void) {
  assertDeadline(); assertEnvironment(); check(holder.organizationId === context.organizationId, "HOLDER_SCOPE_CONFLICT");
  const db = drizzle(pool, { schema }); await ensureAssignment(db, context, request, holder, assertDeadline);
  assertDeadline();
  const saved = await snapshot(db, context, request, sourceSequence); check(saved, "ASSIGNMENT_MISSING");
  assertDeadline();
  const output = verifyComputed(saved);
  assertDeadline();
  if (saved.completion) return { outcome: "REPLAYED" as const, completion: saved.completion };
  const completion: ResearchCompletion = seal({ schemaVersion: RESEARCH_CONTRACT, organizationId: context.organizationId,
    researchSessionId: saved.assignment.researchSessionId, sequence: saved.sequence, sourceSessionId: saved.assignment.sourceSessionId,
    sourceSequence, assignmentDigest: saved.assignment.contentDigest, packetDigest: saved.packet.contentDigest,
    previousCompletionDigest: saved.predecessor, output });
  bounded(completion, LIMITS.completion, "COMPLETION_LIMIT_EXCEEDED");
  return db.transaction(async tx => {
    await settings(tx); await lockRuntimeOrganizationV2(tx, context.organizationId); await assertRuntimeDatabaseClockHolderV2(tx, holder);
    assertDeadline();
    const budget = new ResearchReadBudget(LIMITS.inputAggregate);
    const current = await readAssignment(tx, context, request, budget); check(current, "ASSIGNMENT_MISSING");
    check(current.assignment.contentDigest === saved.assignment.contentDigest, "ASSIGNMENT_IDENTITY_CONFLICT");
    const already = await readBoundedResearchCompletion(tx, current.assignment, current.profile, saved.sequence);
    assertDeadline();
    if (already) {
      check(digest(already) === digest(completion), "COMPLETION_CONFLICT");
      assertDeadline(); return { outcome: "REPLAYED" as const, completion: already };
    }
    const input = await readBoundedResearchInputs(tx, current.assignment, current.profile, sourceSequence, budget);
    check(input.packet.contentDigest === saved.packet.contentDigest && digest(input.revisions) === digest(saved.revisions), "SOURCE_SNAPSHOT_CONFLICT");
    const predecessor = await readBoundedResearchPredecessor(tx, current.assignment, saved.sequence, new ResearchReadBudget(LIMITS.predecessor));
    check(predecessor === saved.predecessor, "PREDECESSOR_CONFLICT");
    await admitOptionalStoredReceipt(tx, context.organizationId, output.receipt.id);
    await persistInformationSufficiencyReceiptWithinTransactionV2Postgres(tx, context, output.receipt);
    await requireInformationSufficiencyAuthorityWithinTransactionV2Postgres(tx, context, saved.profile, output.receipt);
    assertDeadline();
    await tx.insert(schema.traderResearchUnderstandingCompletionsV1).values({ organizationId: context.organizationId,
      sessionId: completion.researchSessionId, sequence: completion.sequence, contentDigest: completion.contentDigest,
      bodyJson: encodeBody(completion), assignmentDigest: completion.assignmentDigest, sourceSessionId: completion.sourceSessionId,
      sourceSequence, packetDigest: completion.packetDigest, receiptId: output.receipt.id,
      previousCompletionDigest: completion.previousCompletionDigest, ...holderColumns(holder) });
    await assertRuntimeDatabaseClockHolderV2(tx, holder);
    assertDeadline(); return { outcome: "COMMITTED" as const, completion };
  }, { isolationLevel: "read committed" });
}

/** Sole public command composition: input is captured once before any await. No held-writer API. */
export function createSavedResearchOwner(pool: postgres.Sql, suppliedContext: OrgContext, supplied: ResearchRequest) {
  const { context, request } = captureResearchCommand(pool, suppliedContext, supplied);
  const started = performance.now();
  const assertDeadline = () => check(performance.now() - started <= LIMITS.durationMs, "INVOCATION_DEADLINE_EXCEEDED");
  const checkSequence = (sourceSequence: number) => {
    assertDeadline();
    check(Number.isSafeInteger(sourceSequence) && sourceSequence >= request.range.startSequence &&
      sourceSequence - request.range.startSequence < request.range.count, "INVALID_RANGE");
  };
  return {
    organizationId: context.organizationId, range: copy(request.range),
    async replay(sourceSequence: number) {
      checkSequence(sourceSequence);
      const result = await replayCompletedResearch(pool, context, request, sourceSequence, assertDeadline);
      assertDeadline(); return result;
    },
    async complete(sourceSequence: number, suppliedHolder: DatabaseClockRuntimeHolderV2) {
      checkSequence(sourceSequence); const holder = copy(suppliedHolder);
      const result = await completeSavedResearch(pool, context, request, sourceSequence, holder, assertDeadline);
      // A late COMMIT acknowledgement refuses this result, not the already committed
      // immutable completion. A fresh invocation can replay it without another write.
      assertDeadline(); return result;
    },
  };
}
