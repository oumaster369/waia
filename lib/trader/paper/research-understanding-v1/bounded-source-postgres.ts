import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { sql, getTableColumns, getTableName, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { readCanonicalPitObservationWithinHeldTransactionV1Postgres, hasCanonicalGatewayPitReceiptContentV1 } from "@/lib/trader/mi/canonical-pit-service-postgres";
import { readTrustAsOfReceiptV1Postgres } from "@/lib/trader/mi/trust-as-of-repository-postgres";
import { assertInformationSufficiencyReceiptV2, type InformationSufficiencyReceiptV2, type RequiredInformationProfileV2 } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import { assertSession, digest, copy, type AnalysisSession, type AnalysisPacket } from "../durable-noncapital/recorded-analysis-v1";
import { decodeBody, validateRecordedPacket, validateRecordedSourcePair } from "../durable-noncapital/recorded-source-read-validation-v1";
import { assertResearchAssignment, assertResearchProfile, check, LIMITS, type ResearchAssignment } from "./contract";
import { assertSelectedResearchTrust, type ResearchTrustRevision } from "./admission";

/** Exact projections only; schema additions cannot silently broaden these selected read surfaces. */
const specs = {
  assignment: [schema.traderResearchUnderstandingAssignmentsV1, "organizationId sessionId contentDigest bodyJson profileId profileContentDigest sourceSessionId sourceConfigDigest runtimeInstanceId leaseEpoch leaseContentDigest", ["organizationId", "sessionId"], LIMITS.assignment],
  completion: [schema.traderResearchUnderstandingCompletionsV1, "organizationId sessionId sequence contentDigest bodyJson assignmentDigest sourceSessionId sourceSequence packetDigest receiptId previousCompletionDigest runtimeInstanceId leaseEpoch leaseContentDigest", ["organizationId", "sessionId", "sequence"], LIMITS.completion],
  predecessor: [schema.traderResearchUnderstandingCompletionsV1, "organizationId sessionId sequence contentDigest assignmentDigest sourceSessionId sourceSequence packetDigest", ["organizationId", "sessionId", "sequence"], LIMITS.predecessor],
  session: [schema.traderRecordedAnalysisSessionsV1, "organizationId sessionId contentDigest bodyJson runtimeInstanceId leaseEpoch leaseContentDigest", ["organizationId", "sessionId"], LIMITS.session],
  packet: [schema.traderRecordedAnalysisPacketsV1, "organizationId sessionId sequence configDigest analysisPitAnchor contentDigest bodyJson runtimeInstanceId leaseEpoch leaseContentDigest", ["organizationId", "sessionId", "sequence"], LIMITS.packet],
  companion: [schema.traderRecordedAnalysisCompanionsV1, "organizationId sessionId sequence contentDigest packetDigest accountId symbol barInterval scheduledBarCloseTime", ["organizationId", "sessionId", "sequence"], LIMITS.companion],
  gateway: [schema.traderMiGatewayPitReceiptV1, "id organizationId providerId gatewayKind status reason sourceId trustAsOfReceiptId observationId observationContentDigest normalizedInputDigest receiptJson contentDigest schemaVersion createdAt", ["id"], LIMITS.externalRow],
  observation: [schema.traderMiObservation, "id organizationId sourceId observationKind observationKey subjectRef schemaVersion payloadJson eventTime availableAt ingestTime canonicalProviderId trustAsOfReceiptId sourceTrustRevisionId sourceTrustContentDigest normalizedInputDigest observedBy revisionOf revisionSeq contentDigest createdAt", ["id"], LIMITS.externalRow],
  trust: [schema.traderMiTrustAsOfReceiptV1, "id organizationId sourceId anchorTime status unknownReason selectedTrustRevisionId selectedRevisionSeq selectedContentDigest selectedTrustScore visiblePrefixDigest receiptJson contentDigest schemaVersion createdAt", ["id"], LIMITS.externalRow],
  revision: [schema.traderMiSourceTrust, "id organizationId sourceId trustScore rationale recordedBy eventTime availableAt ingestTime revisionOf revisionSeq contentDigest createdAt", ["id"], LIMITS.externalRow],
  source: [schema.traderMiSource, "id organizationId venue feedKind symbol", ["id"], LIMITS.source],
  profile: [schema.traderRequiredInformationProfileV2, "id organizationId accountId profileVersion purpose symbol venue analyticalTimeframe horizon profileJson contentDigest schemaVersion authority createdAt", ["id"], LIMITS.profile],
  receipt: [schema.traderInformationSufficiencyReceiptV2, "id organizationId accountId profileId profileContentDigest purpose status pitAnchor receiptJson contentDigest schemaVersion authority createdAt", ["id"], LIMITS.informationReceipt],
} as const;
type Kind = keyof typeof specs;
export class ResearchReadBudget {
  private readonly seen = new Map<string, number>();
  total = 0;
  constructor(readonly maximum: number) {}
  admit(table: string, identity: string, size: number, rowMaximum: number): void {
    check(Number.isSafeInteger(size) && size >= 0 && size <= rowMaximum, "STORED_ROW_LIMIT_EXCEEDED");
    const key = JSON.stringify([table, identity]); const prior = this.seen.get(key);
    check(prior === undefined || prior === size, "SNAPSHOT_ROW_IDENTITY_CONFLICT");
    if (prior !== undefined) return;
    check(this.total <= this.maximum - size, "INPUT_AGGREGATE_LIMIT_EXCEEDED");
    this.total += size; this.seen.set(key, size);
  }
}
function specification(kind: Kind) {
  const [table, names, keys, maximum] = specs[kind]; const columns = getTableColumns(table) as Record<string, PgColumn>;
  const projection = Object.fromEntries(names.split(" ").map(name => {
    check(columns[name], "UNSUPPORTED_STORED_PROJECTION"); return [name, columns[name]!];
  }));
  return { table, projection, keys, maximum };
}
function selectQuery(table: PgTable, projection: Record<string, PgColumn>, condition: SQL, limit: number) {
  return sql`select ${sql.join(Object.entries(projection).map(([key, column]) => sql`${column} as ${sql.identifier(key)}`), sql`, `)}
    from ${table} where ${condition} limit ${limit}`;
}
/** Metadata only. The caller must admit all external sets before invoking any body/service reader. */
async function inspect(db: WaiaPostgresDb, kind: Kind, condition: SQL, budget: ResearchReadBudget, expected: number, maximum?: number, optional = false) {
  check(Number.isSafeInteger(expected) && expected >= 0 && expected <= LIMITS.sourceCount, "SOURCE_SET_LIMIT_EXCEEDED");
  const spec = specification(kind); const query = selectQuery(spec.table, spec.projection, condition, expected + 1);
  const identity = sql`jsonb_build_array(${sql.join(spec.keys.map(key => sql`${sql.identifier("bounded_row")}.${sql.identifier(key)}`), sql`, `)})::text`;
  const rows = await db.execute<{ identity: string; bytes: number }>(sql`select ${identity} as identity,
    octet_length(to_jsonb(bounded_row)::text)::integer as bytes from (${query}) as bounded_row`);
  if (optional && rows.length === 0) return null;
  check(rows.length === expected, "EXACT_ROW_SET_MISSING_OR_AMBIGUOUS");
  for (const row of rows) budget.admit(getTableName(spec.table), row.identity, row.bytes, maximum ?? spec.maximum);
  return query;
}
async function bodies(db: WaiaPostgresDb, query: SQL | null): Promise<Record<string, unknown>[]> {
  check(query, "EXACT_ROW_SET_MISSING_OR_AMBIGUOUS");
  const rows = await db.execute<Record<string, unknown>>(query);
  // PostgreSQL timestamps are normalized only at this persistence boundary.
  return JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[];
}
function scope(kind: Kind, organizationId: string, ids: readonly string[]): SQL {
  const { projection } = specification(kind); const unique = [...new Set(ids)];
  check(unique.length <= LIMITS.sourceCount, "SOURCE_SET_LIMIT_EXCEEDED");
  return sql`${projection.organizationId} = ${organizationId} and ${projection.id} in (${sql.join(unique.map(id => sql`${id}`), sql`, `)})`;
}
function recordScope(kind: "session" | "packet" | "companion" | "assignment" | "completion" | "predecessor", org: string, sessionId: string, sequence?: number): SQL {
  const { projection: p } = specification(kind);
  return sql`${p.organizationId} = ${org} and ${p.sessionId} = ${sessionId}${sequence === undefined ? sql`` : sql` and ${p.sequence} = ${sequence}`}`;
}
export async function readBoundedResearchProfile(db: WaiaPostgresDb, org: string, id: string, budget = new ResearchReadBudget(LIMITS.inputAggregate)) {
  const query = await inspect(db, "profile", scope("profile", org, [id]), budget, 1);
  const row = (await bodies(db, query))[0]!; const profile = row.profileJson as RequiredInformationProfileV2;
  assertResearchProfile(profile);
  check(profile.organizationId === org && profile.id === id && row.contentDigest === profile.contentDigest && row.accountId === profile.accountId,
    "PROFILE_STORAGE_CONFLICT");
  return profile;
}

/** The caller owns one READ ONLY REPEATABLE READ snapshot and has admitted its stored assignment. */
export async function readBoundedResearchInputs(db: WaiaPostgresDb, assignment: ResearchAssignment, profile: RequiredInformationProfileV2,
  sourceSequence: number, budget: ResearchReadBudget) {
  assertResearchAssignment(assignment, profile);
  const org = assignment.organizationId;
  const headerQuery = await inspect(db, "session", recordScope("session", org, assignment.sourceSessionId), budget, 1);
  const header = (await bodies(db, headerQuery))[0]!;
  const session = { ...JSON.parse(header.bodyJson as string), configDigest: header.contentDigest } as AnalysisSession;
  assertSession(session);
  check(session.organizationId === org && session.accountId === assignment.accountId && session.symbol === assignment.symbol &&
    session.sessionId === assignment.sourceSessionId && session.configDigest === assignment.sourceConfigDigest, "SESSION_SCOPE_CONFLICT");
  const packetQuery = await inspect(db, "packet", recordScope("packet", org, session.sessionId, sourceSequence), budget, 1,
    Math.min(session.maxPacketBytes, LIMITS.packet));
  const row = (await bodies(db, packetQuery))[0]!;
  const packet = decodeBody<AnalysisPacket>(row as { bodyJson: string; contentDigest: string });
  validateRecordedPacket(session, sourceSequence, { configDigest: row.configDigest as string, analysisPitAnchor: row.analysisPitAnchor as string }, packet);
  check(packet.sources.length <= LIMITS.sourceCount && packet.sources.length === packet.normalized.observations.length, "SOURCE_SET_LIMIT_EXCEEDED");
  const companionQuery = await inspect(db, "companion", recordScope("companion", org, session.sessionId, sourceSequence), budget, 1);
  const previousQuery = sourceSequence > 0
    ? await inspect(db, "companion", recordScope("companion", org, session.sessionId, sourceSequence - 1), budget, 1) : null;
  const ids = {
    gateway: packet.sources.map(s => s.receipt.id), observation: packet.sources.flatMap(s => s.receipt.observationId ? [s.receipt.observationId] : []),
    trust: packet.sources.flatMap(s => s.receipt.trustAsOfReceiptId ? [s.receipt.trustAsOfReceiptId] : []),
    source: packet.sources.flatMap(s => s.receipt.sourceId ? [s.receipt.sourceId] : []),
    revision: packet.sources.flatMap(s => { const t = s.trust as { selectedTrustRevisionId?: string } | null; return t?.selectedTrustRevisionId ? [t.selectedTrustRevisionId] : []; }),
  };
  const external = new Map<string, SQL | null>();
  for (const kind of ["gateway", "observation", "trust", "revision", "source"] as const) {
    const unique = [...new Set(ids[kind])];
    if (unique.length) external.set(kind, await inspect(db, kind, scope(kind, org, unique), budget, unique.length));
  }
  // Every external byte/count and the complete aggregate is now admitted. Only now transfer those bodies.
  const companion = (await bodies(db, companionQuery))[0]!;
  check(companion.packetDigest === packet.contentDigest && companion.accountId === session.accountId && companion.symbol === session.symbol &&
    companion.barInterval === "1m" && Date.parse(companion.scheduledBarCloseTime as string) === Date.parse(packet.normalized.scheduledBarCloseTime), "COMPANION_BINDING_CONFLICT");
  const previous = previousQuery ? (await bodies(db, previousQuery))[0]! : null;
  check(packet.previousCompletionDigest === (previous?.contentDigest ?? null), "PREDECESSOR_CONFLICT");
  const gateways = external.has("gateway") ? await bodies(db, external.get("gateway")!) : [];
  const sources = external.has("source") ? await bodies(db, external.get("source")!) : [];
  const revisions = external.has("revision") ? (await bodies(db, external.get("revision")!))
    .map(row => ({ ...row, schemaVersion: "mi-source-trust-v1" } as ResearchTrustRevision)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : [];
  const context = { organizationId: org };
  for (let i = 0; i < packet.sources.length; i++) {
    const receipt = packet.sources[i]!.receipt;
    check(receipt.organizationId === org && hasCanonicalGatewayPitReceiptContentV1(receipt), "SOURCE_RECEIPT_CONFLICT");
    const gateway = gateways.find(row => row.id === receipt.id);
    check(gateway && gateway.contentDigest === receipt.contentDigest && digest(gateway.receiptJson) === digest(receipt), "SOURCE_RECEIPT_CONFLICT");
    const observation = receipt.observationId ? await readCanonicalPitObservationWithinHeldTransactionV1Postgres(db, context, receipt.observationId) : null;
    const trust = receipt.trustAsOfReceiptId ? await readTrustAsOfReceiptV1Postgres(db, context, receipt.trustAsOfReceiptId) : null;
    check(!receipt.observationId || observation, "SOURCE_OBSERVATION_MISSING"); check(!receipt.trustAsOfReceiptId || trust, "SOURCE_TRUST_MISSING");
    const source = receipt.sourceId ? sources.find(row => row.id === receipt.sourceId) : null;
    check(!receipt.sourceId || (source && source.venue === "htx" && source.symbol === session.symbol && source.feedKind === receipt.gatewayKind), "SOURCE_SCOPE_CONFLICT");
    if (trust?.status === "RESOLVED") {
      const revision = revisions.find(r => r.id === trust.selectedTrustRevisionId); check(revision, "SOURCE_REVISION_MISSING");
      assertSelectedResearchTrust(trust, revision);
    }
    validateRecordedSourcePair(packet, i, JSON.parse(JSON.stringify({ receipt, observation, trust, source })));
  }
  return { session, packet, companion, revisions: copy(revisions), sourceInputBytes: budget.total };
}

/** New sidecar identity is mandatory for this owner; generic profile/receipt presence never substitutes. */
export async function readBoundedResearchAssignment(db: WaiaPostgresDb, org: string, sessionId: string, budget: ResearchReadBudget) {
  const query = await inspect(db, "assignment", recordScope("assignment", org, sessionId), budget, 1, undefined, true);
  if (!query) return null;
  const row = (await bodies(db, query))[0]!;
  const assignment = decodeBody<ResearchAssignment>(row as { bodyJson: string; contentDigest: string });
  check(assignment.organizationId === org && assignment.researchSessionId === sessionId && row.profileId === assignment.profileId &&
    row.profileContentDigest === assignment.profileContentDigest && row.sourceSessionId === assignment.sourceSessionId &&
    row.sourceConfigDigest === assignment.sourceConfigDigest, "ASSIGNMENT_STORAGE_CONFLICT");
  return assignment;
}
export async function readBoundedResearchPredecessor(db: WaiaPostgresDb, assignment: ResearchAssignment, sequence: number, budget: ResearchReadBudget) {
  if (sequence === 0) return null;
  const query = await inspect(db, "predecessor", recordScope("predecessor", assignment.organizationId, assignment.researchSessionId, sequence - 1), budget, 1);
  const row = (await bodies(db, query))[0]!;
  check(row.assignmentDigest === assignment.contentDigest && row.sourceSessionId === assignment.sourceSessionId &&
    Number(row.sourceSequence) === assignment.firstSourceSequence + sequence - 1, "PREDECESSOR_CONFLICT");
  return row.contentDigest as string;
}
/** Admit completion, receipt and predecessor metadata before either output body is transferred. */
export async function readBoundedResearchCompletion(db: WaiaPostgresDb, assignment: ResearchAssignment, profile: RequiredInformationProfileV2, sequence: number) {
  const budget = new ResearchReadBudget(LIMITS.replayAggregate);
  const condition = recordScope("completion", assignment.organizationId, assignment.researchSessionId, sequence);
  const query = await inspect(db, "completion", condition, budget, 1, undefined, true);
  if (!query) return null;
  const t = schema.traderResearchUnderstandingCompletionsV1;
  const identity = await db.execute<{ receiptId: string }>(sql`select ${t.receiptId} as "receiptId" from ${t} where ${condition} limit 2`);
  check(identity.length === 1, "COMPLETION_STORAGE_CONFLICT");
  const receiptQuery = await inspect(db, "receipt", scope("receipt", assignment.organizationId, [identity[0]!.receiptId]), budget, 1);
  const predecessorQuery = sequence > 0 ? await inspect(db, "predecessor",
    recordScope("predecessor", assignment.organizationId, assignment.researchSessionId, sequence - 1), budget, 1) : null;
  const row = (await bodies(db, query))[0]!;
  const completion = decodeBody<import("./repository-postgres").ResearchCompletion>(row as { bodyJson: string; contentDigest: string });
  const receiptRow = (await bodies(db, receiptQuery))[0]!;
  const receipt = receiptRow.receiptJson as InformationSufficiencyReceiptV2;
  assertInformationSufficiencyReceiptV2(receipt, profile);
  check(receipt.id === identity[0]!.receiptId && receipt.organizationId === assignment.organizationId &&
    receiptRow.contentDigest === receipt.contentDigest && receiptRow.profileId === profile.id &&
    receiptRow.profileContentDigest === profile.contentDigest, "RECEIPT_STORAGE_CONFLICT");
  const predecessor = predecessorQuery ? (await bodies(db, predecessorQuery))[0]! : null;
  check(!predecessor || (predecessor.assignmentDigest === assignment.contentDigest && predecessor.sourceSessionId === assignment.sourceSessionId &&
    Number(predecessor.sourceSequence) === assignment.firstSourceSequence + sequence - 1), "PREDECESSOR_CONFLICT");
  check(completion.organizationId === assignment.organizationId && completion.researchSessionId === assignment.researchSessionId && completion.sequence === sequence &&
    completion.sourceSequence === assignment.firstSourceSequence + sequence && completion.sourceSessionId === assignment.sourceSessionId &&
    completion.assignmentDigest === assignment.contentDigest && completion.output.assignmentDigest === assignment.contentDigest &&
    completion.packetDigest === completion.output.packetDigest && row.assignmentDigest === assignment.contentDigest &&
    row.packetDigest === completion.packetDigest && Number(row.sourceSequence) === completion.sourceSequence &&
    row.sourceSessionId === completion.sourceSessionId && row.previousCompletionDigest === completion.previousCompletionDigest &&
    completion.previousCompletionDigest === (predecessor?.contentDigest ?? null) && digest(completion.output.receipt) === digest(receipt), "COMPLETION_STORAGE_CONFLICT");
  return completion;
}
/** Before held persistence re-reads an existing immutable profile, admit that exact row. */
export async function admitOptionalStoredProfile(db: WaiaPostgresDb, org: string, id: string) {
  return inspect(db, "profile", scope("profile", org, [id]), new ResearchReadBudget(LIMITS.profile), 1, undefined, true);
}
export async function admitOptionalStoredReceipt(db: WaiaPostgresDb, org: string, id: string) {
  return inspect(db, "receipt", scope("receipt", org, [id]), new ResearchReadBudget(LIMITS.informationReceipt), 1, undefined, true);
}
