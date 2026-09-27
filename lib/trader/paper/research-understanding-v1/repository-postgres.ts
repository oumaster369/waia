import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { assertOrgMembershipPostgres, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { requireServiceOrgContext } from "@/lib/trader/security/service-org-context";
import { persistRequiredInformationProfileWithinTransactionV2Postgres, persistInformationSufficiencyReceiptWithinTransactionV2Postgres,
  requireInformationSufficiencyAuthorityWithinTransactionV2Postgres } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres";
import type { RequiredInformationProfileV2 } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import { lockRuntimeOrganizationV2, assertRuntimeDatabaseClockHolderV2, type DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { copy, digest, seal, assertEnvironment } from "../durable-noncapital/recorded-analysis-v1";
import { encodeBody } from "../durable-noncapital/recorded-source-read-validation-v1";
import { check, bounded, orgSchema, digestSchema, parseStrict, captureAssignmentConfig, captureProfileDefinition, rangeSchema,
  assignmentConfigurationDigest, buildResearchAssignment, assertResearchAssignment, RESEARCH_CONTRACT, RESEARCH_SERVICE_ACTOR, LIMITS,
  type ResearchAssignmentConfig, type ResearchRange, type ResearchActor } from "./contract";
import { evaluateSavedResearchUnderstanding, type ResearchEvaluation } from "./evaluate";
import { ResearchReadBudget, readBoundedResearchAssignment, readBoundedResearchProfile, readBoundedResearchCompletion,
  readBoundedResearchInputs, readBoundedResearchPredecessor, admitOptionalStoredProfile, admitOptionalStoredReceipt } from "./bounded-source-postgres";

export type ResearchRequest = { assignment: ResearchAssignmentConfig; range: ResearchRange;
  profile: { definition: unknown } | { id: string; contentDigest: string } };
export type CapturedResearchRequest = { assignment: ResearchAssignmentConfig; range: ResearchRange;
  profile: { body: RequiredInformationProfileV2 } | { id: string; contentDigest: string } };
export type ResearchCompletion = { schemaVersion: typeof RESEARCH_CONTRACT; organizationId: string; researchSessionId: string;
  sequence: number; sourceSessionId: string; sourceSequence: number; assignmentDigest: string; packetDigest: string;
  previousCompletionDigest: string | null; output: ResearchEvaluation; contentDigest: string };

export function captureResearchCommand(pool: postgres.Sql, suppliedContext: OrgContext, supplied: ResearchRequest) {
  // Actual postgres.js TransactionSql has savepoint and no root begin. No nested public transaction.
  check(typeof pool.begin === "function" && typeof (pool as unknown as { savepoint?: unknown }).savepoint !== "function", "POOL_REQUIRED");
  const context = copy(suppliedContext);
  check(Object.keys(context).every(k => k === "organizationId" || k === "userId"), "INVALID_CONTEXT");
  parseStrict(orgSchema, context.organizationId, "INVALID_ORGANIZATION");
  check(context.userId === undefined || (typeof context.userId === "string" && context.userId.trim() === context.userId &&
    context.userId.length > 0 && Buffer.byteLength(context.userId) <= LIMITS.text), "INVALID_ACTOR");
  bounded(supplied, LIMITS.assignment + LIMITS.profile, "COMMAND_LIMIT_EXCEEDED");
  const input = copy(supplied);
  check(Object.keys(input).length === 3 && Object.keys(input).every(k => ["assignment", "range", "profile"].includes(k)), "INVALID_COMMAND");
  const assignment = captureAssignmentConfig(input.assignment); const range = parseStrict(rangeSchema, input.range, "INVALID_RANGE");
  check(assignment.organizationId === context.organizationId && range.startSequence >= assignment.firstSourceSequence, "COMMAND_SCOPE_CONFLICT");
  let profile: CapturedResearchRequest["profile"];
  check(input.profile && typeof input.profile === "object" && !Array.isArray(input.profile), "INVALID_PROFILE_SELECTOR");
  if ("definition" in input.profile) {
    check(Object.keys(input.profile).length === 1, "INVALID_PROFILE_SELECTOR"); profile = { body: captureProfileDefinition(input.profile.definition) };
  } else {
    check(Object.keys(input.profile).length === 2, "INVALID_PROFILE_SELECTOR");
    profile = { id: parseStrict(digestSchema, input.profile.id, "INVALID_PROFILE_SELECTOR"),
      contentDigest: parseStrict(digestSchema, input.profile.contentDigest, "INVALID_PROFILE_SELECTOR") };
  }
  const request: CapturedResearchRequest = { assignment, range, profile };
  return { context, request };
}
function holderColumns(holder: DatabaseClockRuntimeHolderV2) {
  return { runtimeInstanceId: holder.runtimeInstanceId, leaseEpoch: holder.leaseEpoch, leaseContentDigest: holder.leaseContentDigest };
}
async function actor(db: WaiaPostgresDb, context: OrgContext): Promise<ResearchActor> {
  const trusted = await requireServiceOrgContext(context, scoped => assertOrgMembershipPostgres(db, scoped));
  return trusted.userId === undefined ? { kind: "SERVICE", id: RESEARCH_SERVICE_ACTOR } : { kind: "USER", id: trusted.userId };
}
async function settings(tx: WaiaPostgresDb): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`set local statement_timeout = '30s'`);
}
function checkRequestedProfile(profile: RequiredInformationProfileV2, request: CapturedResearchRequest) {
  const requested = request.profile;
  check("body" in requested ? digest(requested.body) === digest(profile) : requested.id === profile.id && requested.contentDigest === profile.contentDigest,
    "PROFILE_IDENTITY_CONFLICT");
}
async function readAssignment(db: WaiaPostgresDb, context: OrgContext, request: CapturedResearchRequest, budget: ResearchReadBudget) {
  const authorizedActor = await actor(db, context);
  const assignment = await readBoundedResearchAssignment(db, context.organizationId, request.assignment.researchSessionId, budget);
  if (!assignment) return null;
  const profile = await readBoundedResearchProfile(db, context.organizationId, assignment.profileId, budget);
  assertResearchAssignment(assignment, profile); checkRequestedProfile(profile, request);
  check(assignment.configurationDigest === assignmentConfigurationDigest(request.assignment, profile, authorizedActor), "ASSIGNMENT_CONFIG_CONFLICT");
  return { assignment, profile };
}
async function snapshot(db: WaiaPostgresDb, context: OrgContext, request: CapturedResearchRequest, sourceSequence: number) {
  return db.transaction(async tx => {
    await settings(tx);
    const budget = new ResearchReadBudget(LIMITS.inputAggregate);
    const saved = await readAssignment(tx, context, request, budget);
    if (!saved) return null;
    const sequence = sourceSequence - saved.assignment.firstSourceSequence;
    const completion = await readBoundedResearchCompletion(tx, saved.assignment, saved.profile, sequence);
    const input = await readBoundedResearchInputs(tx, saved.assignment, saved.profile, sourceSequence, budget);
    const predecessor = await readBoundedResearchPredecessor(tx, saved.assignment, sequence, new ResearchReadBudget(LIMITS.predecessor));
    return { ...saved, ...input, completion, predecessor, sequence, sourceSequence };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
function verifyComputed(saved: NonNullable<Awaited<ReturnType<typeof snapshot>>>) {
  const output = evaluateSavedResearchUnderstanding(saved.packet, saved.assignment, saved.profile, saved.revisions);
  if (saved.completion) check(digest(saved.completion.output) === digest(output), "REPLAY_OUTPUT_CONFLICT");
  return output;
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
    if (already) { check(digest(already) === digest(completion), "COMPLETION_CONFLICT"); return { outcome: "REPLAYED" as const, completion: already }; }
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
    async replay(sourceSequence: number) { checkSequence(sourceSequence); return replayCompletedResearch(pool, context, request, sourceSequence, assertDeadline); },
    async complete(sourceSequence: number, suppliedHolder: DatabaseClockRuntimeHolderV2) {
      checkSequence(sourceSequence); const holder = copy(suppliedHolder);
      return completeSavedResearch(pool, context, request, sourceSequence, holder, assertDeadline);
    },
  };
}
