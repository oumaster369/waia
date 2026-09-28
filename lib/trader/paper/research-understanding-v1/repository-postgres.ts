import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { type OrgContext } from "@/lib/waia-core/scope/org-context";
import { persistRequiredInformationProfileWithinTransactionV2Postgres } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres";
import { lockRuntimeOrganizationV2, assertRuntimeDatabaseClockHolderV2, type DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { claimSavedResearchWithinHeldTransactionV1, lockSavedResearchOrganizationV1, assertSavedResearchHolderWithinHeldTransactionV1,
  assertSavedUnderstandingRootWithinHeldTransactionV1, type SavedResearchHolderV1 } from "@/lib/trader/runtime-authority/v2/noncapital-domain-lease-postgres-v1";
import { copy, assertEnvironment, RecordedAnalysisRefusal } from "../durable-noncapital/recorded-analysis-v1";
import { encodeBody } from "../durable-noncapital/recorded-source-read-validation-v1";
import { check, buildResearchAssignment, LIMITS, ResearchRefusal } from "./contract";
import { ResearchReadBudget, readBoundedResearchProfile, admitOptionalStoredProfile } from "./bounded-source-postgres";

import { ResearchCompletionDeadline, captureFixedResearchCompletionSnapshot, prepareFixedResearchCompletion,
  writeFixedResearchCompletion } from "./completion-write-postgres";

export type { ResearchRequest, CapturedResearchRequest, ResearchCompletion } from "./held-replay";
import { captureResearchReplaySelector, researchActor as actor, checkRequestedProfile,
  readResearchAssignmentWithinHeldTransaction as readAssignment, readResearchSnapshotWithinHeldTransaction,
  verifyResearchSnapshotComputed as verifyComputed, readSavedDomainResearchAssignmentWithinHeldTransaction,
  HeldResearchAccounting, prepareHeldSavedDomainResearchReplay, type ResearchRequest, type CapturedResearchRequest } from "./held-replay";

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

type AssignmentLease = { domain: "CAPITAL_LEGACY_V2"; holder: DatabaseClockRuntimeHolderV2; lifetime: ResearchCompletionDeadline }
  | { domain: "SAVED_RESEARCH_V1"; holder: SavedResearchHolderV1; lifetime: HeldResearchAccounting };
async function assignmentCurrent(tx: WaiaPostgresDb, lease: AssignmentLease) {
  return lease.domain === "SAVED_RESEARCH_V1" ? assertSavedResearchHolderWithinHeldTransactionV1(tx, lease.holder, lease.lifetime.noncapitalControls)
    : assertRuntimeDatabaseClockHolderV2(tx, lease.holder);
}
async function ensureAssignmentWithinTransaction(tx: WaiaPostgresDb, context: OrgContext, request: CapturedResearchRequest,
  lease: AssignmentLease, raceProbe: boolean) {
  if (lease.domain === "SAVED_RESEARCH_V1") await lockSavedResearchOrganizationV1(tx, context.organizationId);
  else await lockRuntimeOrganizationV2(tx, context.organizationId);
  const assignedAt = await assignmentCurrent(tx, lease); lease.lifetime.assertDeadline();
  const authorizedActor = await actor(tx, context);
  const inputBudget = lease.domain === "SAVED_RESEARCH_V1" ? lease.lifetime.budget(LIMITS.inputAggregate) : new ResearchReadBudget(LIMITS.inputAggregate);
  // Read the genuine existing assignment first; a fixed domain predicate must
  // not hide an observed foreign root as absence at this ensure boundary.
  const existing = await readAssignment(tx, context, request, inputBudget);
  if (existing) {
    if (lease.domain === "SAVED_RESEARCH_V1" && raceProbe) await assertSavedUnderstandingRootWithinHeldTransactionV1(tx,
      { organizationId: context.organizationId, researchSessionId: request.assignment.researchSessionId,
        expectedAssignmentDigest: existing.assignment.contentDigest }, lease.lifetime.noncapitalControls);
    if (lease.domain === "SAVED_RESEARCH_V1") {
      // The same existing immutable assignment was already admitted at the
      // original root probe, or at the one observed-root race probe above.
      const scoped = await readSavedDomainResearchAssignmentWithinHeldTransaction(tx, context, request, inputBudget);
      check(scoped?.assignment.contentDigest === existing.assignment.contentDigest, "ASSIGNMENT_DOMAIN_CONFLICT");
    }
    return existing;
  }
  const profile = "body" in request.profile ? request.profile.body
    : await readBoundedResearchProfile(tx, context.organizationId, request.profile.id, inputBudget);
  checkRequestedProfile(profile, request);
  const assignment = buildResearchAssignment(request.assignment, profile, authorizedActor, assignedAt);
  await admitOptionalStoredProfile(tx, context.organizationId, profile.id,
    lease.domain === "SAVED_RESEARCH_V1" ? lease.lifetime.budget(LIMITS.profile) : undefined);
  lease.lifetime.assertDeadline();
  await persistRequiredInformationProfileWithinTransactionV2Postgres(tx, context, profile);
  await tx.insert(schema.traderResearchUnderstandingAssignmentsV1).values({ organizationId: assignment.organizationId,
    sessionId: assignment.researchSessionId, contentDigest: assignment.contentDigest, bodyJson: encodeBody(assignment),
    profileId: profile.id, profileContentDigest: profile.contentDigest, sourceSessionId: assignment.sourceSessionId,
    sourceConfigDigest: assignment.sourceConfigDigest, ...holderColumns(lease.holder), ownershipDomain: lease.domain });
  await assignmentCurrent(tx, lease);
  lease.lifetime.assertDeadline(); return { assignment, profile };
}
async function ensureAssignment(db: WaiaPostgresDb, context: OrgContext, request: CapturedResearchRequest,
  holder: DatabaseClockRuntimeHolderV2, lifetime: ResearchCompletionDeadline) {
  return db.transaction(async tx => {
    await settings(tx); return ensureAssignmentWithinTransaction(tx, context, request, { domain: "CAPITAL_LEGACY_V2", holder, lifetime }, false);
  }, { isolationLevel: "read committed" });
}

/** Fixed command boundary. All computation and the held writer are private; no supplied output/callback. */
async function completeSavedResearch(pool: postgres.Sql, context: OrgContext, request: CapturedResearchRequest,
  sourceSequence: number, holder: DatabaseClockRuntimeHolderV2, lifetime: ResearchCompletionDeadline) {
  const assertDeadline = () => lifetime.assertDeadline();
  assertDeadline(); assertEnvironment(); check(holder.organizationId === context.organizationId, "HOLDER_SCOPE_CONFLICT");
  const db = drizzle(pool, { schema }); await ensureAssignment(db, context, request, holder, lifetime);
  assertDeadline();
  const snapshotHandle = await db.transaction(async tx => {
    await settings(tx);
    return captureFixedResearchCompletionSnapshot(tx, context, request, sourceSequence, lifetime);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  assertDeadline();
  const prepared = prepareFixedResearchCompletion(snapshotHandle, lifetime);
  if (prepared.outcome === "REPLAYED") return { outcome: prepared.outcome, completion: prepared.completion };
  return db.transaction(async tx => {
    await settings(tx);
    return writeFixedResearchCompletion(tx, prepared.prepared, holder, lifetime);
  }, { isolationLevel: "read committed" });
}

/** Sole public command composition: input is captured once before any await. No held-writer API. */
export function createSavedResearchOwner(pool: postgres.Sql, suppliedContext: OrgContext, supplied: ResearchRequest) {
  const { context, request } = captureResearchCommand(pool, suppliedContext, supplied);
  const lifetime = new ResearchCompletionDeadline();
  const assertDeadline = () => lifetime.assertDeadline();
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
      const result = await completeSavedResearch(pool, context, request, sourceSequence, holder, lifetime);
      // A late COMMIT acknowledgement refuses this result, not the already committed
      // immutable completion. A fresh invocation can replay it without another write.
      assertDeadline(); return result;
    },
  };
}

/** New fixed domain command: one captured range, privately minted holder and
 * one actual dispatch/input/deadline ledger. Old public APIs above stay legacy. */
export function createSavedDomainResearchOwner(pool: postgres.Sql, suppliedContext: OrgContext, supplied: ResearchRequest) {
  const { context, request } = captureResearchCommand(pool, suppliedContext, supplied);
  // Held replay accepts only the strict public selector. The captured definition
  // remains private for assignment creation; subsequent reads pin its exact seal.
  const replayRequest: ResearchRequest = { assignment: request.assignment, range: request.range, profile: "body" in request.profile
    ? { id: request.profile.body.id, contentDigest: request.profile.body.contentDigest } : request.profile };
  const accounting = new HeldResearchAccounting();
  type Bound = ReturnType<ReturnType<typeof prepareHeldSavedDomainResearchReplay>["bindHeld"]>;
  let holder: SavedResearchHolderV1 | null = null, assignmentReady = false;
  async function transaction<T>(mode: "read committed" | "repeatable read read only", work: (bound: Bound) => Promise<T>) {
    const prepared = prepareHeldSavedDomainResearchReplay(pool, accounting);
    accounting.reserveFinalization(1); accounting.beforeStatement();
    const result = await pool.begin(`isolation level ${mode}`, async held => {
      try {
        const bound = prepared.bindHeld(held);
        await bound.executor.execute(sql`set local lock_timeout = '5s'`);
        await bound.executor.execute(sql`set local statement_timeout = '30s'`);
        const value = await work(bound); accounting.assertDeadline(); accounting.beforeFinalizationStatement(); return value;
      } catch (error) { accounting.beforeFinalizationStatement(); throw error; }
    });
    accounting.assertDeadline(); return result as T;
  }
  return Object.freeze({ async execute() {
    assertEnvironment(); accounting.assertDeadline();
    const completed: Array<{ sequence: number; sourceSequence: number; outcome: "COMMITTED" | "REPLAYED";
      disposition: string; completionDigest: string; packetDigest: string }> = [];
    try {
      for (let offset = 0; offset < request.range.count; offset++) {
        const sourceSequence = request.range.startSequence + offset;
        const inspected = await transaction("repeatable read read only", async bound => {
          const replayed = await bound.replay(context, replayRequest, sourceSequence);
          if (replayed) return { replayed, observedAssignment: null };
          if (holder) return { replayed: null, observedAssignment: null };
          const saved = await readAssignment(bound.executor as WaiaPostgresDb, context, request, accounting.budget(LIMITS.inputAggregate));
          const root = await assertSavedUnderstandingRootWithinHeldTransactionV1(bound.executor, {
            organizationId: context.organizationId, researchSessionId: request.assignment.researchSessionId,
            ...(saved ? { expectedAssignmentDigest: saved.assignment.contentDigest } : {}),
          }, accounting.noncapitalControls);
          return { replayed: null, observedAssignment: root };
        });
        let result: { outcome: "COMMITTED" | "REPLAYED"; completion: import("./held-replay").ResearchCompletion };
        if (inspected.replayed) result = { outcome: "REPLAYED", completion: inspected.replayed.completion };
        else {
          if (!holder) holder = await transaction("read committed", bound => claimSavedResearchWithinHeldTransactionV1(bound.executor,
            { organizationId: context.organizationId, runtimeInstanceId: `saved-research:${randomUUID()}`, durationMs: request.range.leaseDurationMs },
            accounting.noncapitalControls));
          if (!holder) return { status: "LEASE_BUSY" as const, completed };
          if (!assignmentReady) {
            const selectedHolder = holder;
            await transaction("read committed", bound => ensureAssignmentWithinTransaction(bound.executor as WaiaPostgresDb, context, request,
              { domain: "SAVED_RESEARCH_V1", holder: selectedHolder, lifetime: accounting }, !inspected.observedAssignment));
            assignmentReady = true;
          }
          const prepared = await transaction("repeatable read read only", bound => bound.prepareCompletion(context, replayRequest, sourceSequence));
          if (prepared.outcome === "REPLAYED") result = { outcome: prepared.outcome, completion: prepared.completion };
          else {
            const selectedHolder = holder;
            result = await transaction("read committed", bound => bound.writeSavedDomainCompletion(prepared.prepared, selectedHolder));
          }
        }
        accounting.assertDeadline(); const completion = result.completion;
        completed.push({ sequence: completion.sequence, sourceSequence, outcome: result.outcome, disposition: completion.output.disposition,
          completionDigest: completion.contentDigest, packetDigest: completion.packetDigest });
      }
      return { status: "COMPLETE" as const, completed };
    } catch (error) {
      if (error instanceof ResearchRefusal || error instanceof RecordedAnalysisRefusal) return { status: error.code, completed };
      if (error instanceof Error && error.message === "RUNTIME_CONTROL_LEASE_STALE_HOLDER") return { status: "LEASE_LOST", completed };
      throw error;
    }
  } });
}
