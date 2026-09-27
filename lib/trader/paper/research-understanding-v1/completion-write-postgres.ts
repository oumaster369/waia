import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { persistInformationSufficiencyReceiptWithinTransactionV2Postgres,
  requireInformationSufficiencyAuthorityWithinTransactionV2Postgres } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres";
import { lockRuntimeOrganizationV2, assertRuntimeDatabaseClockHolderV2,
  type DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { copy, digest, seal } from "../durable-noncapital/recorded-analysis-v1";
import { encodeBody } from "../durable-noncapital/recorded-source-read-validation-v1";
import { check, bounded, RESEARCH_CONTRACT, LIMITS } from "./contract";
import { ResearchReadBudget, readBoundedResearchCompletion, readBoundedResearchInputs,
  readBoundedResearchPredecessor, admitOptionalStoredReceipt } from "./bounded-source-postgres";
import { readResearchAssignmentWithinHeldTransaction as readAssignment, readResearchSnapshotWithinHeldTransaction,
  verifyResearchSnapshotComputed as verifyComputed, type CapturedResearchRequest, type ResearchCompletion,
  type HeldResearchAccounting } from "./held-replay";

/** The original public owner keeps its own invocation deadline and independent read budgets. */
export class ResearchCompletionDeadline {
  private readonly started = performance.now();
  assertDeadline(): void { check(performance.now() - this.started <= LIMITS.durationMs, "INVOCATION_DEADLINE_EXCEEDED"); }
}
type Lifetime = ResearchCompletionDeadline | HeldResearchAccounting;
function shared(lifetime: Lifetime): HeldResearchAccounting | undefined {
  return lifetime instanceof ResearchCompletionDeadline ? undefined : lifetime;
}
function budget(lifetime: Lifetime, maximum: number) {
  return shared(lifetime)?.budget(maximum) ?? new ResearchReadBudget(maximum);
}
type Snapshot = NonNullable<Awaited<ReturnType<typeof readResearchSnapshotWithinHeldTransaction>>>;
type Captured = { context: OrgContext; request: CapturedResearchRequest; sourceSequence: number; saved: Snapshot; lifetime: Lifetime };
export type ResearchCompletionSnapshot = Readonly<{ kind: "FIXED_RESEARCH_SNAPSHOT" }>;
export type PreparedResearchCompletion = Readonly<{ kind: "FIXED_RESEARCH_COMPLETION" }>;
const snapshots = new WeakMap<ResearchCompletionSnapshot, Captured>();
const completions = new WeakMap<PreparedResearchCompletion, Captured & { completion: ResearchCompletion }>();

/** Mint an opaque snapshot from the fixed reader. No output, evaluator or callback is supplied. */
export async function captureFixedResearchCompletionSnapshot(db: WaiaPostgresDb, suppliedContext: OrgContext,
  suppliedRequest: CapturedResearchRequest, sourceSequence: number, lifetime: Lifetime): Promise<ResearchCompletionSnapshot> {
  lifetime.assertDeadline();
  const context = copy(suppliedContext), request = copy(suppliedRequest);
  const saved = await readResearchSnapshotWithinHeldTransaction(db, context, request, sourceSequence, shared(lifetime));
  check(saved, "ASSIGNMENT_MISSING"); lifetime.assertDeadline();
  const handle = Object.freeze({ kind: "FIXED_RESEARCH_SNAPSHOT" as const });
  snapshots.set(handle, { context, request, sourceSequence, saved, lifetime }); return handle;
}

/** Fixed computation can run after the public owner's RR COMMIT, exactly as before extraction. */
export function prepareFixedResearchCompletion(handle: ResearchCompletionSnapshot, lifetime: Lifetime) {
  lifetime.assertDeadline();
  const captured = snapshots.get(handle);
  check(captured && captured.lifetime === lifetime, "RESEARCH_SNAPSHOT_HANDLE_INVALID"); snapshots.delete(handle);
  const { saved, context, sourceSequence } = captured;
  const output = verifyComputed(saved, shared(lifetime)); lifetime.assertDeadline();
  if (saved.completion) return { outcome: "REPLAYED" as const, completion: saved.completion };
  const completion: ResearchCompletion = seal({ schemaVersion: RESEARCH_CONTRACT, organizationId: context.organizationId,
    researchSessionId: saved.assignment.researchSessionId, sequence: saved.sequence, sourceSessionId: saved.assignment.sourceSessionId,
    sourceSequence, assignmentDigest: saved.assignment.contentDigest, packetDigest: saved.packet.contentDigest,
    previousCompletionDigest: saved.predecessor, output });
  bounded(completion, LIMITS.completion, "COMPLETION_LIMIT_EXCEEDED");
  const prepared = Object.freeze({ kind: "FIXED_RESEARCH_COMPLETION" as const });
  completions.set(prepared, { ...captured, completion });
  return { outcome: "PREPARED" as const, prepared };
}

/** Charge the exact future stored projections before INSERT or any nested service body read. */
async function admitCandidate(db: WaiaPostgresDb, kind: "completion" | "receipt", row: Record<string, unknown>, lifetime: HeldResearchAccounting) {
  const table = kind === "completion" ? schema.traderResearchUnderstandingCompletionsV1 : schema.traderInformationSufficiencyReceiptV2;
  const names = kind === "completion"
    ? "organizationId sessionId sequence contentDigest bodyJson assignmentDigest sourceSessionId sourceSequence packetDigest receiptId previousCompletionDigest runtimeInstanceId leaseEpoch leaseContentDigest"
    : "id organizationId accountId profileId profileContentDigest purpose status pitAnchor receiptJson contentDigest schemaVersion authority createdAt";
  const keys = names.split(" "), columns = getTableColumns(table) as Record<string, PgColumn>;
  check(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)), "RESEARCH_WRITE_PROJECTION_INVALID");
  const value = (key: string) => kind === "receipt" && key === "createdAt"
    // Exact existing receipt default, including millisecond precision; no new PIT or availability sample.
    ? sql`date_trunc('milliseconds', transaction_timestamp())`
    : sql`${columns[key]!.getSQLType() === "jsonb" ? JSON.stringify(row[key]) : row[key]}::${sql.raw(columns[key]!.getSQLType())}`;
  const identityKeys = kind === "completion" ? ["organizationId", "sessionId", "sequence"] : ["id"];
  const identity = sql`jsonb_build_array(${sql.join(identityKeys.map(value), sql`, `)})::text`;
  lifetime.assertDeadline();
  const rows = await db.execute<{ identity: string; bytes: number }>(sql`select ${identity} as identity,
    octet_length(jsonb_build_object(${sql.join(keys.flatMap(key => [sql`${key}::text`, value(key)]), sql`, `)})::text)::integer as bytes`);
  lifetime.assertDeadline(); check(rows.length === 1 && typeof rows[0]!.identity === "string", "RESEARCH_WRITE_PROJECTION_INVALID");
  lifetime.budget(LIMITS.replayAggregate).admit(getTableName(table), rows[0]!.identity, rows[0]!.bytes,
    kind === "completion" ? LIMITS.completion : LIMITS.informationReceipt, kind);
}

/** Fixed internal RC writer. A forged, reused or independently budgeted prepared handle refuses. */
export async function writeFixedResearchCompletion(db: WaiaPostgresDb, prepared: PreparedResearchCompletion,
  suppliedHolder: DatabaseClockRuntimeHolderV2, lifetime: Lifetime) {
  lifetime.assertDeadline();
  const captured = completions.get(prepared);
  check(captured && captured.lifetime === lifetime, "RESEARCH_COMPLETION_HANDLE_INVALID"); completions.delete(prepared);
  const { context, request, sourceSequence, saved, completion } = captured, output = completion.output;
  const holder = copy(suppliedHolder);
  check(holder.organizationId === context.organizationId, "HOLDER_SCOPE_CONFLICT");
  await lockRuntimeOrganizationV2(db, context.organizationId); await assertRuntimeDatabaseClockHolderV2(db, holder);
  lifetime.assertDeadline();
  const inputBudget = budget(lifetime, LIMITS.inputAggregate);
  const current = await readAssignment(db, context, request, inputBudget); check(current, "ASSIGNMENT_MISSING");
  check(current.assignment.contentDigest === saved.assignment.contentDigest, "ASSIGNMENT_IDENTITY_CONFLICT");
  const already = await readBoundedResearchCompletion(db, current.assignment, current.profile, saved.sequence,
    shared(lifetime)?.budget(LIMITS.replayAggregate));
  lifetime.assertDeadline();
  if (already) {
    check(digest(already) === digest(completion), "COMPLETION_CONFLICT");
    lifetime.assertDeadline(); return { outcome: "REPLAYED" as const, completion: already };
  }
  const input = await readBoundedResearchInputs(db, current.assignment, current.profile, sourceSequence, inputBudget);
  check(input.packet.contentDigest === saved.packet.contentDigest && digest(input.revisions) === digest(saved.revisions), "SOURCE_SNAPSHOT_CONFLICT");
  const predecessor = await readBoundedResearchPredecessor(db, current.assignment, saved.sequence, budget(lifetime, LIMITS.predecessor));
  check(predecessor === saved.predecessor, "PREDECESSOR_CONFLICT");
  const existingReceipt = await admitOptionalStoredReceipt(db, context.organizationId, output.receipt.id,
    shared(lifetime)?.budget(LIMITS.informationReceipt));
  const values = { organizationId: context.organizationId, sessionId: completion.researchSessionId, sequence: completion.sequence,
    contentDigest: completion.contentDigest, bodyJson: encodeBody(completion), assignmentDigest: completion.assignmentDigest,
    sourceSessionId: completion.sourceSessionId, sourceSequence, packetDigest: completion.packetDigest, receiptId: output.receipt.id,
    previousCompletionDigest: completion.previousCompletionDigest, runtimeInstanceId: holder.runtimeInstanceId,
    leaseEpoch: holder.leaseEpoch, leaseContentDigest: holder.leaseContentDigest };
  const accounting = shared(lifetime);
  if (accounting) {
    await admitCandidate(db, "completion", values, accounting);
    if (!existingReceipt) {
      const receipt = output.receipt;
      await admitCandidate(db, "receipt", { id: receipt.id, organizationId: context.organizationId, accountId: receipt.accountId,
        profileId: receipt.profileId, profileContentDigest: receipt.profileContentDigest, purpose: receipt.purpose,
        status: receipt.status, pitAnchor: receipt.pitAnchor, receiptJson: receipt, contentDigest: receipt.contentDigest,
        schemaVersion: receipt.schemaVersion, authority: receipt.authority, createdAt: null }, accounting);
    }
  }
  await persistInformationSufficiencyReceiptWithinTransactionV2Postgres(db, context, output.receipt);
  await requireInformationSufficiencyAuthorityWithinTransactionV2Postgres(db, context, saved.profile, output.receipt);
  lifetime.assertDeadline();
  await db.insert(schema.traderResearchUnderstandingCompletionsV1).values(values);
  await assertRuntimeDatabaseClockHolderV2(db, holder);
  lifetime.assertDeadline(); return { outcome: "COMMITTED" as const, completion };
}
