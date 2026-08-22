import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  createRealityEventV2,
  createRealitySourceReportV2,
  createTruthRecordV2,
  validateRealityEventV2,
  validateRealityProjectionV2,
  validateRealitySourceReportV2,
  validateTruthRecordV2,
  type RealityEventTypeV2,
  type RealityEventV2,
  type RealityMarkerV2,
  type RealityPrimitiveAssertionV2,
  type RealityProjectionV2,
  type RealitySourceLineageV2,
  type RealitySourceNativeIdentityV2,
  type RealitySourceProvenanceV2,
  type RealitySourceReportV2,
  type RealitySourceReportV2Draft,
  type RealitySubjectIdentityV2,
  type TruthRecordV2,
} from "./contracts";
import { foldRealityProjectionV2 } from "./projection";
import { assertRealitySourceReportAdmissionV2 } from "./source-admission";

type RealityTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
export type RealityV2Executor = Pick<RealityTx, "select" | "insert" | "execute">;
type SourceRow = typeof pgSchema.traderRealitySourceReportsV2.$inferSelect;
type TruthRow = typeof pgSchema.traderRealityTruthRecordsV2.$inferSelect;
type EventRow = typeof pgSchema.traderRealityEventsV2.$inferSelect;
type ProjectionRow = typeof pgSchema.traderRealityProjectionsV2.$inferSelect;

export type RealityAccountContext = OrgContext & Readonly<{ accountId: string }>;
export type AppendRealitySourceReportV2Input = Omit<
  RealitySourceReportV2Draft,
  "organizationId" | "accountId" | "knowledgeAtUtc"
>;

export class RealityV2PersistenceConflictError extends Error {
  constructor(message = "[trader] Reality V2 persistence conflict") {
    super(message);
    this.name = "RealityV2PersistenceConflictError";
  }
}

function requireScope(context: RealityAccountContext): RealityAccountContext {
  const organizationId = requireOrgContext(context.organizationId).organizationId;
  if (typeof context.accountId !== "string" || context.accountId.trim() === "") {
    throw new RealityV2PersistenceConflictError("[trader] Reality V2 account scope is required");
  }
  return Object.freeze({ organizationId, accountId: context.accountId });
}

function iso(value: Date): string {
  return value.toISOString();
}

async function reserveRealityKnowledgeAtV2(
  executor: RealityV2Executor,
  context: RealityAccountContext,
): Promise<Date> {
  const scoped = requireScope(context);
  const rows = await executor.execute<{ durable_time: Date | string }>(sql`
    SELECT public.waia_reality_v2_reserve_knowledge_at(
      ${scoped.organizationId}::uuid,
      ${scoped.accountId}::text
    ) AS durable_time
  `);
  const value = rows[0]?.durable_time;
  if (value === undefined) throw new RealityV2PersistenceConflictError();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RealityV2PersistenceConflictError();
  return date;
}

/** Serializes source-native classification and event-frontier mutation for one tenant/account. */
export async function lockRealityScopeV2(
  executor: RealityV2Executor,
  context: RealityAccountContext,
): Promise<void> {
  const scoped = requireScope(context);
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${scoped.organizationId}:${scoped.accountId}`}, 675)
    )
  `);
}

function mapNativeIdentity(row: {
  sourceNativeIdentityKind: string | null;
  sourceNativeId: string | null;
  sourceNativeRevision: string | null;
  supersedesNativeRevision: string | null;
}): RealitySourceNativeIdentityV2 | null {
  return row.sourceNativeIdentityKind === null || row.sourceNativeId === null
    ? null
    : {
        identityKind: row.sourceNativeIdentityKind as RealitySourceNativeIdentityV2["identityKind"],
        nativeId: row.sourceNativeId,
        nativeRevision: row.sourceNativeRevision,
        supersedesNativeRevision: row.supersedesNativeRevision,
      };
}

function mapLineage(row: SourceRow): RealitySourceLineageV2 {
  if (row.lineageKind === "EXECUTION_REPORT_V2") {
    if (row.executionReportId === null || row.executionReportDigest === null) {
      throw new RealityV2PersistenceConflictError();
    }
    return {
      lineageKind: "EXECUTION_REPORT_V2",
      executionReportId: row.executionReportId,
      executionReportDigestHex: row.executionReportDigest,
    };
  }
  if (row.rawCaptureReceiptDigest === null || row.rawBytesDigest === null ||
    row.storageBindingDigest === null) {
    throw new RealityV2PersistenceConflictError();
  }
  return {
    lineageKind: "RAW_CAPTURE_V1",
    rawCaptureReceiptDigestHex: row.rawCaptureReceiptDigest,
    rawBytesDigestHex: row.rawBytesDigest,
    storageBindingDigestHex: row.storageBindingDigest,
  };
}

function mapSource(row: SourceRow): RealitySourceReportV2 {
  const report: RealitySourceReportV2 = Object.freeze({
    schemaVersion: row.schemaVersion as RealitySourceReportV2["schemaVersion"],
    sourceReportId: row.id,
    organizationId: row.organizationId,
    accountId: row.accountId,
    sourceKind: row.sourceKind as RealitySourceReportV2["sourceKind"],
    sourceNativeIdentity: mapNativeIdentity(row),
    attributionStatus: row.attributionStatus as RealitySourceReportV2["attributionStatus"],
    subject: Object.freeze({
      subjectClass: row.subjectClass as RealitySubjectIdentityV2["subjectClass"],
      subjectKey: row.subjectKey,
    }),
    primitiveAssertion: row.primitiveAssertion as RealityPrimitiveAssertionV2 | null,
    lineage: mapLineage(row),
    provenance: row.provenance as RealitySourceProvenanceV2,
    structuralVerification:
      row.structuralVerification as RealitySourceReportV2["structuralVerification"],
    verificationReasonCodes: row.verificationReasonCodes as readonly string[],
    validAtUtc: iso(row.validAt),
    knowledgeAtUtc: iso(row.knowledgeAt),
    contentDigestHex: row.contentDigest,
  });
  if (!validateRealitySourceReportV2(report)) throw new RealityV2PersistenceConflictError();
  assertRealitySourceReportAdmissionV2(report);
  return report;
}

function sameSourceFactIdentity(
  left: RealitySourceReportV2,
  right: RealitySourceReportV2,
): boolean {
  const leftNative = left.sourceNativeIdentity;
  const rightNative = right.sourceNativeIdentity;
  return left.sourceKind === right.sourceKind &&
    left.subject.subjectClass === right.subject.subjectClass &&
    left.subject.subjectKey === right.subject.subjectKey &&
    leftNative?.identityKind === rightNative?.identityKind &&
    leftNative?.nativeId === rightNative?.nativeId &&
    leftNative?.nativeRevision === rightNative?.nativeRevision;
}

function mapTruth(row: TruthRow): TruthRecordV2 {
  const truth: TruthRecordV2 = Object.freeze({
    schemaVersion: row.schemaVersion as TruthRecordV2["schemaVersion"],
    truthRecordId: row.id,
    organizationId: row.organizationId,
    accountId: row.accountId,
    sourceReportId: row.sourceReportId,
    sourceReportDigestHex: row.sourceReportDigest,
    sourceKind: row.sourceKind as TruthRecordV2["sourceKind"],
    sourceNativeIdentity: mapNativeIdentity(row),
    subject: Object.freeze({
      subjectClass: row.subjectClass as RealitySubjectIdentityV2["subjectClass"],
      subjectKey: row.subjectKey,
    }),
    primitiveAssertion: row.primitiveAssertion as RealityPrimitiveAssertionV2,
    validAtUtc: iso(row.validAt),
    knowledgeAtUtc: iso(row.knowledgeAt),
    supersedesTruthRecordId: row.supersedesTruthRecordId,
    markers: row.markers as readonly RealityMarkerV2[],
    contentDigestHex: row.contentDigest,
  });
  if (!validateTruthRecordV2(truth)) throw new RealityV2PersistenceConflictError();
  return truth;
}

function mapEvent(row: EventRow): RealityEventV2 {
  const event: RealityEventV2 = Object.freeze({
    schemaVersion: row.schemaVersion as RealityEventV2["schemaVersion"],
    realityEventId: row.id,
    organizationId: row.organizationId,
    accountId: row.accountId,
    eventSequence: row.eventSequence.toString(),
    eventType: row.eventType as RealityEventV2["eventType"],
    sourceReportId: row.sourceReportId,
    truthRecordId: row.truthRecordId,
    relatedTruthRecordId: row.relatedTruthRecordId,
    reasonCodes: row.reasonCodes as readonly string[],
    knowledgeAtUtc: iso(row.knowledgeAt),
    previousEventDigestHex: row.previousEventDigest,
    contentDigestHex: row.contentDigest,
  });
  if (!validateRealityEventV2(event)) throw new RealityV2PersistenceConflictError();
  return event;
}

function mapProjection(row: ProjectionRow): RealityProjectionV2 {
  const projection: RealityProjectionV2 = Object.freeze({
    schemaVersion: row.schemaVersion as RealityProjectionV2["schemaVersion"],
    projectionId: row.id,
    organizationId: row.organizationId,
    accountId: row.accountId,
    projectionPolicyVersion:
      row.projectionPolicyVersion as RealityProjectionV2["projectionPolicyVersion"],
    knowledgeAsOfUtc: iso(row.knowledgeAsOf),
    frontierSequence: row.frontierSequence.toString(),
    frontierEventDigestHex: row.frontierEventDigest,
    stableEntries: row.stableEntries as RealityProjectionV2["stableEntries"],
    uncertainties: row.uncertainties as RealityProjectionV2["uncertainties"],
    contentDigestHex: row.contentDigest,
  });
  if (!validateRealityProjectionV2(projection)) throw new RealityV2PersistenceConflictError();
  return projection;
}

export async function readRealitySourceReportV2(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  sourceReportId: string,
): Promise<RealitySourceReportV2 | null> {
  const scoped = requireScope(context);
  const rows = await executor.select().from(pgSchema.traderRealitySourceReportsV2).where(and(
    eq(pgSchema.traderRealitySourceReportsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealitySourceReportsV2.accountId, scoped.accountId),
    eq(pgSchema.traderRealitySourceReportsV2.id, sourceReportId),
  )).limit(1);
  return rows[0] ? mapSource(rows[0]) : null;
}

export async function appendRealitySourceObservationV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  input: AppendRealitySourceReportV2Input,
): Promise<{ report: RealitySourceReportV2; insertedNew: boolean }> {
  const scoped = requireScope(context);
  await lockRealityScopeV2(executor, scoped);
  const lineageRows = await executor.select().from(pgSchema.traderRealitySourceReportsV2).where(and(
    eq(pgSchema.traderRealitySourceReportsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealitySourceReportsV2.accountId, scoped.accountId),
    input.lineage.lineageKind === "EXECUTION_REPORT_V2"
      ? eq(
          pgSchema.traderRealitySourceReportsV2.executionReportId,
          input.lineage.executionReportId,
        )
      : eq(
          pgSchema.traderRealitySourceReportsV2.rawCaptureReceiptDigest,
          input.lineage.rawCaptureReceiptDigestHex,
        ),
  ));
  for (const lineageRow of lineageRows) {
    const existing = mapSource(lineageRow);
    const replay = createRealitySourceReportV2({
      ...input,
      organizationId: scoped.organizationId,
      accountId: scoped.accountId,
      knowledgeAtUtc: existing.knowledgeAtUtc,
    });
    if (replay.contentDigestHex === existing.contentDigestHex) {
      return { report: existing, insertedNew: false };
    }
    if (sameSourceFactIdentity(existing, replay)) {
      throw new RealityV2PersistenceConflictError(
        "[trader] immutable Reality lineage was reinterpreted with different semantics",
      );
    }
  }
  const report = createRealitySourceReportV2({
    ...input,
    organizationId: scoped.organizationId,
    accountId: scoped.accountId,
    knowledgeAtUtc: iso(await reserveRealityKnowledgeAtV2(executor, scoped)),
  });
  assertRealitySourceReportAdmissionV2(report);
  const native = report.sourceNativeIdentity;
  const executionLineage = report.lineage.lineageKind === "EXECUTION_REPORT_V2"
    ? report.lineage
    : null;
  const rawLineage = report.lineage.lineageKind === "RAW_CAPTURE_V1" ? report.lineage : null;
  const inserted = await executor.insert(pgSchema.traderRealitySourceReportsV2).values({
    id: report.sourceReportId,
    organizationId: report.organizationId,
    accountId: report.accountId,
    sourceKind: report.sourceKind,
    sourceNativeIdentityKind: native?.identityKind ?? null,
    sourceNativeId: native?.nativeId ?? null,
    sourceNativeRevision: native?.nativeRevision ?? null,
    supersedesNativeRevision: native?.supersedesNativeRevision ?? null,
    attributionStatus: report.attributionStatus,
    subjectClass: report.subject.subjectClass,
    subjectKey: report.subject.subjectKey,
    primitiveAssertion: report.primitiveAssertion,
    lineageKind: report.lineage.lineageKind,
    executionReportId: executionLineage?.executionReportId ?? null,
    executionReportDigest: executionLineage?.executionReportDigestHex ?? null,
    rawCaptureReceiptDigest: rawLineage?.rawCaptureReceiptDigestHex ?? null,
    rawBytesDigest: rawLineage?.rawBytesDigestHex ?? null,
    storageBindingDigest: rawLineage?.storageBindingDigestHex ?? null,
    provenance: report.provenance,
    structuralVerification: report.structuralVerification,
    verificationReasonCodes: [...report.verificationReasonCodes],
    validAt: new Date(report.validAtUtc),
    knowledgeAt: new Date(report.knowledgeAtUtc),
    contentDigest: report.contentDigestHex,
    schemaVersion: report.schemaVersion,
  }).onConflictDoNothing().returning({ id: pgSchema.traderRealitySourceReportsV2.id });
  const stored = await readRealitySourceReportV2(executor, scoped, report.sourceReportId);
  if (!stored || stored.contentDigestHex !== report.contentDigestHex) {
    throw new RealityV2PersistenceConflictError();
  }
  return { report: stored, insertedNew: inserted.length === 1 };
}

export function appendRealitySourceReportV2Postgres(
  db: WaiaPostgresDb,
  context: RealityAccountContext,
  input: AppendRealitySourceReportV2Input,
): Promise<{ report: RealitySourceReportV2; insertedNew: boolean }> {
  return runWaiaPostgresTransaction(db, async (tx) => {
    await lockRealityScopeV2(tx, context);
    return appendRealitySourceObservationV2FromWriter(tx, context, input);
  });
}

async function insertTruthRecordV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  truth: TruthRecordV2,
): Promise<{ truth: TruthRecordV2; insertedNew: boolean }> {
  const scoped = requireScope(context);
  if (truth.organizationId !== scoped.organizationId || truth.accountId !== scoped.accountId ||
    !validateTruthRecordV2(truth)) {
    throw new RealityV2PersistenceConflictError();
  }
  const native = truth.sourceNativeIdentity;
  const inserted = await executor.insert(pgSchema.traderRealityTruthRecordsV2).values({
    id: truth.truthRecordId,
    organizationId: truth.organizationId,
    accountId: truth.accountId,
    sourceReportId: truth.sourceReportId,
    sourceReportDigest: truth.sourceReportDigestHex,
    sourceKind: truth.sourceKind,
    sourceNativeIdentityKind: native?.identityKind ?? null,
    sourceNativeId: native?.nativeId ?? null,
    sourceNativeRevision: native?.nativeRevision ?? null,
    supersedesNativeRevision: native?.supersedesNativeRevision ?? null,
    subjectClass: truth.subject.subjectClass,
    subjectKey: truth.subject.subjectKey,
    primitiveAssertion: truth.primitiveAssertion,
    validAt: new Date(truth.validAtUtc),
    knowledgeAt: new Date(truth.knowledgeAtUtc),
    supersedesTruthRecordId: truth.supersedesTruthRecordId,
    markers: [...truth.markers],
    contentDigest: truth.contentDigestHex,
    schemaVersion: truth.schemaVersion,
  }).onConflictDoNothing().returning({ id: pgSchema.traderRealityTruthRecordsV2.id });
  const rows = await executor.select().from(pgSchema.traderRealityTruthRecordsV2).where(and(
    eq(pgSchema.traderRealityTruthRecordsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealityTruthRecordsV2.accountId, scoped.accountId),
    eq(pgSchema.traderRealityTruthRecordsV2.sourceReportId, truth.sourceReportId),
  )).limit(1);
  if (!rows[0]) throw new RealityV2PersistenceConflictError();
  const stored = mapTruth(rows[0]);
  if (stored.contentDigestHex !== truth.contentDigestHex) {
    throw new RealityV2PersistenceConflictError();
  }
  return { truth: stored, insertedNew: inserted.length === 1 };
}

async function appendRealityEventV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  input: Readonly<{
    eventType: RealityEventTypeV2;
    sourceReportId: string;
    truthRecordId: string | null;
    relatedTruthRecordId: string | null;
    reasonCodes: readonly string[];
  }>,
): Promise<RealityEventV2> {
  const scoped = requireScope(context);
  await lockRealityScopeV2(executor, scoped);
  const priorRows = await executor.select().from(pgSchema.traderRealityEventsV2).where(and(
    eq(pgSchema.traderRealityEventsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealityEventsV2.accountId, scoped.accountId),
  )).orderBy(desc(pgSchema.traderRealityEventsV2.eventSequence)).limit(1);
  const prior = priorRows[0];
  const event = createRealityEventV2({
    organizationId: scoped.organizationId,
    accountId: scoped.accountId,
    eventSequence: prior ? (prior.eventSequence + 1n).toString() : "1",
    eventType: input.eventType,
    sourceReportId: input.sourceReportId,
    truthRecordId: input.truthRecordId,
    relatedTruthRecordId: input.relatedTruthRecordId,
    reasonCodes: input.reasonCodes,
    knowledgeAtUtc: iso(await reserveRealityKnowledgeAtV2(executor, scoped)),
    previousEventDigestHex: prior?.contentDigest ?? null,
  });
  await executor.insert(pgSchema.traderRealityEventsV2).values({
    id: event.realityEventId,
    organizationId: event.organizationId,
    accountId: event.accountId,
    eventSequence: BigInt(event.eventSequence),
    eventType: event.eventType,
    sourceReportId: event.sourceReportId,
    truthRecordId: event.truthRecordId,
    relatedTruthRecordId: event.relatedTruthRecordId,
    reasonCodes: [...event.reasonCodes],
    knowledgeAt: new Date(event.knowledgeAtUtc),
    previousEventDigest: event.previousEventDigestHex,
    contentDigest: event.contentDigestHex,
    schemaVersion: event.schemaVersion,
  });
  return event;
}

export async function appendObservedRealityTruthV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  source: RealitySourceReportV2,
): Promise<TruthRecordV2> {
  await lockRealityScopeV2(executor, context);
  const truth = createTruthFromVerifiedSourceV2(source, {
    supersedesTruthRecordId: null,
    markers: [],
  });
  const stored = (await insertTruthRecordV2FromWriter(executor, context, truth)).truth;
  await appendRealityEventV2FromWriter(executor, context, {
    eventType: "OBSERVED",
    sourceReportId: source.sourceReportId,
    truthRecordId: stored.truthRecordId,
    relatedTruthRecordId: null,
    reasonCodes: [],
  });
  return stored;
}

export async function appendSupersededRealityTruthV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  source: RealitySourceReportV2,
  correctionTarget: TruthRecordV2,
): Promise<TruthRecordV2> {
  await lockRealityScopeV2(executor, context);
  const truth = createTruthFromVerifiedSourceV2(source, {
    supersedesTruthRecordId: correctionTarget.truthRecordId,
    markers: [],
  });
  const stored = (await insertTruthRecordV2FromWriter(executor, context, truth)).truth;
  await appendRealityEventV2FromWriter(executor, context, {
    eventType: "SUPERSEDED",
    sourceReportId: source.sourceReportId,
    truthRecordId: stored.truthRecordId,
    relatedTruthRecordId: correctionTarget.truthRecordId,
    reasonCodes: ["SOURCE_NATIVE_CORRECTION"],
  });
  return stored;
}

export async function appendUnverifiableRealityQuarantineV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  source: RealitySourceReportV2,
  reasonCodes: readonly string[],
): Promise<void> {
  await lockRealityScopeV2(executor, context);
  await appendRealityEventV2FromWriter(executor, context, {
    eventType: "QUARANTINED",
    sourceReportId: source.sourceReportId,
    truthRecordId: null,
    relatedTruthRecordId: null,
    reasonCodes,
  });
}

export async function appendContradictoryRealityTruthV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  source: RealitySourceReportV2,
  related: TruthRecordV2 | null,
  reasonCodes: readonly string[],
): Promise<TruthRecordV2> {
  await lockRealityScopeV2(executor, context);
  const truth = createTruthFromVerifiedSourceV2(source, {
    supersedesTruthRecordId: null,
    markers: ["SOURCE_CONTRADICTION"],
  });
  const stored = (await insertTruthRecordV2FromWriter(executor, context, truth)).truth;
  await appendRealityEventV2FromWriter(executor, context, {
    eventType: related === null ? "QUARANTINED" : "SOURCE_CONTRADICTION",
    sourceReportId: source.sourceReportId,
    truthRecordId: stored.truthRecordId,
    relatedTruthRecordId: related?.truthRecordId ?? null,
    reasonCodes,
  });
  return stored;
}

export async function appendReleasedRealityQuarantineV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  source: RealitySourceReportV2,
  truth: TruthRecordV2,
): Promise<void> {
  await lockRealityScopeV2(executor, context);
  await appendRealityEventV2FromWriter(executor, context, {
    eventType: "RELEASED",
    sourceReportId: source.sourceReportId,
    truthRecordId: truth.truthRecordId,
    relatedTruthRecordId: null,
    reasonCodes: ["QUARANTINE_RESOLVED_WITHOUT_PROMOTION"],
  });
}

export async function listRealitySourceReportsV2(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  knowledgeAsOfUtc?: string,
): Promise<readonly RealitySourceReportV2[]> {
  const scoped = requireScope(context);
  const predicate = and(
    eq(pgSchema.traderRealitySourceReportsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealitySourceReportsV2.accountId, scoped.accountId),
    knowledgeAsOfUtc
      ? lte(pgSchema.traderRealitySourceReportsV2.knowledgeAt, new Date(knowledgeAsOfUtc))
      : undefined,
  );
  const rows = await executor.select().from(pgSchema.traderRealitySourceReportsV2)
    .where(predicate).orderBy(
      asc(pgSchema.traderRealitySourceReportsV2.knowledgeAt),
      asc(pgSchema.traderRealitySourceReportsV2.id),
    );
  return Object.freeze(rows.map(mapSource));
}

export async function listTruthRecordsV2(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  knowledgeAsOfUtc?: string,
): Promise<readonly TruthRecordV2[]> {
  const scoped = requireScope(context);
  const rows = await executor.select().from(pgSchema.traderRealityTruthRecordsV2).where(and(
    eq(pgSchema.traderRealityTruthRecordsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealityTruthRecordsV2.accountId, scoped.accountId),
    knowledgeAsOfUtc
      ? lte(pgSchema.traderRealityTruthRecordsV2.knowledgeAt, new Date(knowledgeAsOfUtc))
      : undefined,
  )).orderBy(
    asc(pgSchema.traderRealityTruthRecordsV2.knowledgeAt),
    asc(pgSchema.traderRealityTruthRecordsV2.id),
  );
  return Object.freeze(rows.map(mapTruth));
}

export async function listRealityEventsV2(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  knowledgeAsOfUtc?: string,
): Promise<readonly RealityEventV2[]> {
  const scoped = requireScope(context);
  const rows = await executor.select().from(pgSchema.traderRealityEventsV2).where(and(
    eq(pgSchema.traderRealityEventsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealityEventsV2.accountId, scoped.accountId),
    knowledgeAsOfUtc
      ? lte(pgSchema.traderRealityEventsV2.knowledgeAt, new Date(knowledgeAsOfUtc))
      : undefined,
  )).orderBy(asc(pgSchema.traderRealityEventsV2.eventSequence));
  return Object.freeze(rows.map(mapEvent));
}

async function insertRealityProjectionV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  projection: RealityProjectionV2,
): Promise<{ projection: RealityProjectionV2; insertedNew: boolean }> {
  const scoped = requireScope(context);
  if (projection.organizationId !== scoped.organizationId ||
    projection.accountId !== scoped.accountId || !validateRealityProjectionV2(projection)) {
    throw new RealityV2PersistenceConflictError();
  }
  const inserted = await executor.insert(pgSchema.traderRealityProjectionsV2).values({
    id: projection.projectionId,
    organizationId: projection.organizationId,
    accountId: projection.accountId,
    projectionPolicyVersion: projection.projectionPolicyVersion,
    knowledgeAsOf: new Date(projection.knowledgeAsOfUtc),
    frontierSequence: BigInt(projection.frontierSequence),
    frontierEventDigest: projection.frontierEventDigestHex,
    stableEntries: [...projection.stableEntries],
    uncertainties: [...projection.uncertainties],
    contentDigest: projection.contentDigestHex,
    schemaVersion: projection.schemaVersion,
  }).onConflictDoNothing().returning({ id: pgSchema.traderRealityProjectionsV2.id });
  const rows = await executor.select().from(pgSchema.traderRealityProjectionsV2).where(and(
    eq(pgSchema.traderRealityProjectionsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealityProjectionsV2.accountId, scoped.accountId),
    eq(pgSchema.traderRealityProjectionsV2.id, projection.projectionId),
  )).limit(1);
  if (!rows[0]) throw new RealityV2PersistenceConflictError();
  const stored = mapProjection(rows[0]);
  if (canonicalJsonString(stored) !== canonicalJsonString(projection)) {
    throw new RealityV2PersistenceConflictError(
      "[trader] persisted Reality projection differs from canonical ledger fold",
    );
  }
  return { projection: stored, insertedNew: inserted.length === 1 };
}

export async function readLatestRealityProjectionV2(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  knowledgeAsOfUtc?: string,
): Promise<RealityProjectionV2 | null> {
  const scoped = requireScope(context);
  const rows = await executor.select().from(pgSchema.traderRealityProjectionsV2).where(and(
    eq(pgSchema.traderRealityProjectionsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRealityProjectionsV2.accountId, scoped.accountId),
    knowledgeAsOfUtc
      ? lte(pgSchema.traderRealityProjectionsV2.knowledgeAsOf, new Date(knowledgeAsOfUtc))
      : undefined,
  )).orderBy(
    desc(pgSchema.traderRealityProjectionsV2.frontierSequence),
    desc(pgSchema.traderRealityProjectionsV2.knowledgeAsOf),
    desc(pgSchema.traderRealityProjectionsV2.id),
  ).limit(1);
  return rows[0] ? mapProjection(rows[0]) : null;
}

export async function persistCanonicalRealityProjectionV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  expectedProjection?: RealityProjectionV2,
): Promise<RealityProjectionV2 | null> {
  const scoped = requireScope(context);
  await lockRealityScopeV2(executor, scoped);
  const sources = await listRealitySourceReportsV2(executor, scoped);
  const truths = await listTruthRecordsV2(executor, scoped);
  const events = await listRealityEventsV2(executor, scoped);
  const head = events.at(-1);
  if (!head) {
    if (expectedProjection !== undefined) {
      throw new RealityV2PersistenceConflictError(
        "[trader] caller projection cannot exist without a canonical Reality frontier",
      );
    }
    return null;
  }
  const projection = foldRealityProjectionV2(scoped, head.knowledgeAtUtc, {
    sources,
    truths,
    events,
  });
  if (expectedProjection !== undefined &&
    canonicalJsonString(expectedProjection) !== canonicalJsonString(projection)) {
    throw new RealityV2PersistenceConflictError(
      "[trader] caller projection is not exactly equal to the canonical Reality ledger fold",
    );
  }
  return (await insertRealityProjectionV2FromWriter(executor, scoped, projection)).projection;
}

export function createTruthFromVerifiedSourceV2(
  source: RealitySourceReportV2,
  input: Readonly<{
    supersedesTruthRecordId: string | null;
    markers: readonly RealityMarkerV2[];
  }>,
): TruthRecordV2 {
  if (source.structuralVerification !== "VERIFIED" || source.primitiveAssertion === null) {
    throw new RealityV2PersistenceConflictError("[trader] unverifiable source cannot author truth");
  }
  return createTruthRecordV2({
    organizationId: source.organizationId,
    accountId: source.accountId,
    sourceReportId: source.sourceReportId,
    sourceReportDigestHex: source.contentDigestHex,
    sourceKind: source.sourceKind,
    sourceNativeIdentity: source.sourceNativeIdentity,
    subject: source.subject,
    primitiveAssertion: source.primitiveAssertion,
    validAtUtc: source.validAtUtc,
    knowledgeAtUtc: source.knowledgeAtUtc,
    supersedesTruthRecordId: input.supersedesTruthRecordId,
    markers: input.markers,
  });
}
