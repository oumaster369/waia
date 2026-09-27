import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { assertOrgMembershipPostgres, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { requireServiceOrgContext } from "@/lib/trader/security/service-org-context";
import type { RequiredInformationProfileV2 } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import { APPLICATION_LIMITS } from "../research-application-v1/contract";
import { copy, digest } from "../durable-noncapital/recorded-analysis-v1";
import { check, bounded, orgSchema, digestSchema, parseStrict, captureAssignmentConfig, captureProfileDefinition, rangeSchema,
  assignmentConfigurationDigest, assertResearchAssignment, RESEARCH_CONTRACT, RESEARCH_SERVICE_ACTOR, LIMITS,
  type ResearchAssignmentConfig, type ResearchRange, type ResearchActor } from "./contract";
import { evaluateSavedResearchUnderstanding, type ResearchEvaluation } from "./evaluate";
import { ResearchReadBudget, readBoundedResearchAssignment, readBoundedResearchProfile, readBoundedResearchCompletion,
  readBoundedResearchInputs, readBoundedResearchPredecessor } from "./bounded-source-postgres";

export type ResearchRequest = { assignment: ResearchAssignmentConfig; range: ResearchRange;
  profile: { definition: unknown } | { id: string; contentDigest: string } };
export type CapturedResearchRequest = { assignment: ResearchAssignmentConfig; range: ResearchRange;
  profile: { body: RequiredInformationProfileV2 } | { id: string; contentDigest: string } };
export type ResearchCompletion = { schemaVersion: typeof RESEARCH_CONTRACT; organizationId: string; researchSessionId: string;
  sequence: number; sourceSessionId: string; sourceSequence: number; assignmentDigest: string; packetDigest: string;
  previousCompletionDigest: string | null; output: ResearchEvaluation; contentDigest: string };

/** Capture data only; authorization is checked by the actual selected read. */
export function captureResearchReplaySelector(suppliedContext: OrgContext, supplied: ResearchRequest) {
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
export async function researchActor(db: WaiaPostgresDb, context: OrgContext): Promise<ResearchActor> {
  const trusted = await requireServiceOrgContext(context, scoped => assertOrgMembershipPostgres(db, scoped));
  return trusted.userId === undefined ? { kind: "SERVICE", id: RESEARCH_SERVICE_ACTOR } : { kind: "USER", id: trusted.userId };
}
export function checkRequestedProfile(profile: RequiredInformationProfileV2, request: CapturedResearchRequest) {
  const requested = request.profile;
  check("body" in requested ? digest(requested.body) === digest(profile) : requested.id === profile.id && requested.contentDigest === profile.contentDigest,
    "PROFILE_IDENTITY_CONFLICT");
}
export async function readResearchAssignmentWithinHeldTransaction(db: WaiaPostgresDb, context: OrgContext, request: CapturedResearchRequest, budget: ResearchReadBudget) {
  budget.checkDeadline();
  const authorizedActor = await researchActor(db, context); budget.checkDeadline();
  const assignment = await readBoundedResearchAssignment(db, context.organizationId, request.assignment.researchSessionId, budget); budget.checkDeadline();
  if (!assignment) return null;
  const profile = await readBoundedResearchProfile(db, context.organizationId, assignment.profileId, budget); budget.checkDeadline();
  assertResearchAssignment(assignment, profile); checkRequestedProfile(profile, request);
  check(assignment.configurationDigest === assignmentConfigurationDigest(request.assignment, profile, authorizedActor), "ASSIGNMENT_CONFIG_CONFLICT");
  return { assignment, profile };
}

/** One invocation's accounting; no caller-selected caps, clock or evaluator. */
export class HeldResearchAccounting {
  private readonly started = performance.now();
  private count = 0;
  private reserved = 0;
  readonly inputs = new ResearchReadBudget(APPLICATION_LIMITS.uniqueInputAggregate, undefined, () => this.assertDeadline());
  get statements() { return this.count; }
  assertDeadline(): void { check(performance.now() - this.started <= APPLICATION_LIMITS.durationMs, "INVOCATION_DEADLINE_EXCEEDED"); }
  beforeStatement(): void {
    this.assertDeadline(); check(this.count + this.reserved < APPLICATION_LIMITS.queries, "STATEMENT_LIMIT_EXCEEDED"); this.count++;
  }
  /** The owning command reserves cleanup before dispatch; this does not execute SQL. */
  reserveFinalization(count: number): void {
    this.assertDeadline(); check(Number.isSafeInteger(count) && count > 0 && this.count + this.reserved + count <= APPLICATION_LIMITS.queries, "STATEMENT_LIMIT_EXCEEDED");
    this.reserved += count;
  }
  /** Cleanup remains possible after the deadline, but must use a reserved slot. */
  beforeFinalizationStatement(): void {
    check(this.reserved > 0, "FINALIZATION_SLOT_REQUIRED"); this.reserved--; this.count++;
  }
  budget(maximum: number) { this.assertDeadline(); return new ResearchReadBudget(maximum, this.inputs); }
}

/** Extracted fixed reader. No transaction control, writes or alternate evaluator. */
export async function readResearchSnapshotWithinHeldTransaction(db: WaiaPostgresDb, context: OrgContext,
  request: CapturedResearchRequest, sourceSequence: number, accounting?: HeldResearchAccounting) {
  accounting?.assertDeadline();
  const budget = accounting?.budget(LIMITS.inputAggregate) ?? new ResearchReadBudget(LIMITS.inputAggregate);
  const saved = await readResearchAssignmentWithinHeldTransaction(db, context, request, budget); budget.checkDeadline();
  if (!saved) return null;
  const sequence = sourceSequence - saved.assignment.firstSourceSequence;
  const completion = await readBoundedResearchCompletion(db, saved.assignment, saved.profile, sequence,
    accounting?.budget(LIMITS.replayAggregate)); budget.checkDeadline();
  const input = await readBoundedResearchInputs(db, saved.assignment, saved.profile, sourceSequence, budget); budget.checkDeadline();
  const predecessor = await readBoundedResearchPredecessor(db, saved.assignment, sequence,
    accounting?.budget(LIMITS.predecessor) ?? new ResearchReadBudget(LIMITS.predecessor)); budget.checkDeadline();
  return { ...saved, ...input, completion, predecessor, sequence, sourceSequence };
}
export function verifyResearchSnapshotComputed(saved: NonNullable<Awaited<ReturnType<typeof readResearchSnapshotWithinHeldTransaction>>>,
  accounting?: HeldResearchAccounting) {
  accounting?.assertDeadline();
  const output = evaluateSavedResearchUnderstanding(saved.packet, saved.assignment, saved.profile, saved.revisions);
  accounting?.assertDeadline();
  if (saved.completion) check(digest(saved.completion.output) === digest(output), "REPLAY_OUTPUT_CONFLICT");
  accounting?.assertDeadline(); return output;
}

/** Internal setup before the owner's BEGIN. Initialize the real originating
 * codecs exactly once, then bind only the transaction returned by that pool.
 * Shape checks do not attest same-origin pairing or grant application authority.
 * The owner retains transaction control, settings and finalization accounting.
 */
export function prepareHeldResearchReplay(originatingPool: postgres.Sql, accounting: HeldResearchAccounting) {
  check(typeof originatingPool.begin === "function" && typeof (originatingPool as unknown as { savepoint?: unknown }).savepoint !== "function", "POOL_REQUIRED");
  const options = originatingPool.options;
  check(options && typeof options.parsers === "object" && options.parsers !== null &&
    typeof options.serializers === "object" && options.serializers !== null, "ORIGINATING_CODEC_METADATA_REQUIRED");
  accounting.assertDeadline();
  let heldClient: postgres.TransactionSql | undefined;
  // Drizzle must initialize the originating connection's codecs, not detached
  // defaults. Its one construction happens before BEGIN. No root transport is
  // captured here; the initially unbound transport dispatches only on the held
  // client later supplied by that same fixed owner. Do not freeze the real codec
  // maps: postgres.js may add normal type metadata when it connects.
  const transport = { options, unsafe: (...args: Parameters<postgres.TransactionSql["unsafe"]>) => {
    check(heldClient, "HELD_TRANSACTION_NOT_BOUND");
    return heldClient.unsafe(...args);
  } };
  const db = drizzle({ client: transport as unknown as postgres.Sql, schema,
    logger: { logQuery() { accounting.beforeStatement(); } } });
  accounting.assertDeadline();
  return Object.freeze({ bindHeld(client: postgres.TransactionSql) {
    accounting.assertDeadline();
    check(!heldClient, "HELD_BINDING_ALREADY_USED");
    check(typeof client.savepoint === "function" && typeof (client as unknown as { begin?: unknown }).begin !== "function" &&
      typeof client.unsafe === "function", "HELD_TRANSACTION_REQUIRED");
    heldClient = client;
    // Only expose these direct methods after binding, not the root pool,
    // unbound transport, session or an injectable repository/evaluator.
    const executor = Object.freeze({ select: db.select.bind(db), insert: db.insert.bind(db), execute: db.execute.bind(db) });
    return Object.freeze({ executor,
      async replay(suppliedContext: OrgContext, supplied: ResearchRequest, sourceSequence: number) {
        accounting.assertDeadline();
        const { context, request } = captureResearchReplaySelector(suppliedContext, supplied);
        check(Number.isSafeInteger(sourceSequence) && sourceSequence >= request.range.startSequence &&
          sourceSequence - request.range.startSequence < request.range.count, "INVALID_RANGE");
        const result = await (async () => {
          const saved = await readResearchSnapshotWithinHeldTransaction(db, context, request, sourceSequence, accounting);
          accounting.assertDeadline();
          if (!saved?.completion) return null;
          const output = verifyResearchSnapshotComputed(saved, accounting);
          accounting.assertDeadline();
          return { ...saved, completion: saved.completion, output };
        })();
        accounting.assertDeadline(); return result;
      },
    });
  } });
}
