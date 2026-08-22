import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { RealityProjectionV2, RealitySourceReportV2, TruthRecordV2 } from "./contracts";
import { foldRealityProjectionV2 } from "./projection";
import {
  appendRealityEventV2FromWriter,
  appendRealitySourceReportV2FromWriter,
  createTruthFromVerifiedSourceV2,
  insertRealityProjectionV2FromWriter,
  insertTruthRecordV2FromWriter,
  listRealityEventsV2,
  listRealitySourceReportsV2,
  listTruthRecordsV2,
  lockRealityScopeV2,
  type AppendRealitySourceReportV2Input,
  type RealityAccountContext,
  type RealityV2Executor,
} from "./repository-postgres";

export type RealityIngestClassificationV2 =
  | "DUPLICATE"
  | "NEW_FACT"
  | "EXPLICIT_CORRECTION"
  | "SOURCE_CONTRADICTION"
  | "QUARANTINED";

export type RealityIngestResultV2 = Readonly<{
  classification: RealityIngestClassificationV2;
  sourceReport: RealitySourceReportV2;
  truthRecord: TruthRecordV2 | null;
  projection: RealityProjectionV2 | null;
}>;

function semanticDigest(source: RealitySourceReportV2): string {
  return computeStableJsonDigest({
    sourceKind: source.sourceKind,
    sourceNativeIdentity: source.sourceNativeIdentity,
    subject: source.subject,
    primitiveAssertion: source.primitiveAssertion,
    structuralVerification: source.structuralVerification,
    verificationReasonCodes: source.verificationReasonCodes,
  });
}

function truthSemanticDigest(truth: TruthRecordV2): string {
  return computeStableJsonDigest({
    sourceKind: truth.sourceKind,
    sourceNativeIdentity: truth.sourceNativeIdentity,
    subject: truth.subject,
    primitiveAssertion: truth.primitiveAssertion,
    structuralVerification: "VERIFIED",
    verificationReasonCodes: [],
  });
}

function sameNativeFact(source: RealitySourceReportV2, truth: TruthRecordV2): boolean {
  const sourceNative = source.sourceNativeIdentity;
  const truthNative = truth.sourceNativeIdentity;
  return sourceNative !== null && truthNative !== null &&
    source.sourceKind === truth.sourceKind &&
    sourceNative.identityKind === truthNative.identityKind &&
    sourceNative.nativeId === truthNative.nativeId &&
    sourceNative.nativeRevision === truthNative.nativeRevision && sameSubject(source, truth);
}

function sameSubject(source: RealitySourceReportV2, truth: TruthRecordV2): boolean {
  return source.subject.subjectClass === truth.subject.subjectClass &&
    source.subject.subjectKey === truth.subject.subjectKey;
}

async function persistProjectionAtHead(
  executor: RealityV2Executor,
  context: RealityAccountContext,
): Promise<RealityProjectionV2 | null> {
  const [sources, truths, events] = await Promise.all([
    listRealitySourceReportsV2(executor, context),
    listTruthRecordsV2(executor, context),
    listRealityEventsV2(executor, context),
  ]);
  const head = events.at(-1);
  if (!head) return null;
  const projection = foldRealityProjectionV2(context, head.knowledgeAtUtc, {
    sources,
    truths,
    events,
  });
  return (await insertRealityProjectionV2FromWriter(executor, context, projection)).projection;
}

async function appendQuarantine(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  source: RealitySourceReportV2,
  truth: TruthRecordV2 | null,
  related: TruthRecordV2 | null,
  reasonCodes: readonly string[],
  contradiction: boolean,
): Promise<void> {
  await appendRealityEventV2FromWriter(executor, context, {
    eventType: contradiction ? "SOURCE_CONTRADICTION" : "QUARANTINED",
    sourceReportId: source.sourceReportId,
    truthRecordId: truth?.truthRecordId ?? null,
    relatedTruthRecordId: related?.truthRecordId ?? null,
    reasonCodes,
  });
}

export async function ingestRealitySourceReportV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  input: AppendRealitySourceReportV2Input,
): Promise<RealityIngestResultV2> {
  await lockRealityScopeV2(executor, context);
  const appended = await appendRealitySourceReportV2FromWriter(executor, context, input);
  const source = appended.report;
  if (!appended.insertedNew) {
    return Object.freeze({
      classification: "DUPLICATE",
      sourceReport: source,
      truthRecord: null,
      projection: await persistProjectionAtHead(executor, context),
    });
  }

  const existingTruths = await listTruthRecordsV2(executor, context);
  if (source.structuralVerification !== "VERIFIED" || source.primitiveAssertion === null ||
    source.sourceNativeIdentity === null) {
    await appendQuarantine(
      executor,
      context,
      source,
      null,
      null,
      source.verificationReasonCodes.length > 0
        ? source.verificationReasonCodes
        : ["SOURCE_UNATTRIBUTED"],
      false,
    );
    return Object.freeze({
      classification: "QUARANTINED",
      sourceReport: source,
      truthRecord: null,
      projection: await persistProjectionAtHead(executor, context),
    });
  }

  const sameNative = existingTruths.filter((truth) => sameNativeFact(source, truth));
  if (sameNative.some((truth) => semanticDigest(source) === truthSemanticDigest(truth))) {
    return Object.freeze({
      classification: "DUPLICATE",
      sourceReport: source,
      truthRecord: null,
      projection: await persistProjectionAtHead(executor, context),
    });
  }

  const priorRevision = source.sourceNativeIdentity.supersedesNativeRevision;
  if (priorRevision !== null) {
    const correctionTarget = existingTruths.find((truth) => {
      const native = truth.sourceNativeIdentity;
      return native !== null && source.sourceNativeIdentity !== null &&
        truth.markers.length === 0 &&
        !existingTruths.some((candidate) =>
          candidate.supersedesTruthRecordId === truth.truthRecordId) &&
        truth.sourceKind === source.sourceKind &&
        native.identityKind === source.sourceNativeIdentity.identityKind &&
        native.nativeId === source.sourceNativeIdentity.nativeId &&
        native.nativeRevision === priorRevision && sameSubject(source, truth);
    });
    if (correctionTarget) {
      const corrected = createTruthFromVerifiedSourceV2(source, {
        supersedesTruthRecordId: correctionTarget.truthRecordId,
        markers: [],
      });
      await insertTruthRecordV2FromWriter(executor, context, corrected);
      await appendRealityEventV2FromWriter(executor, context, {
        eventType: "SUPERSEDED",
        sourceReportId: source.sourceReportId,
        truthRecordId: corrected.truthRecordId,
        relatedTruthRecordId: correctionTarget.truthRecordId,
        reasonCodes: ["SOURCE_NATIVE_CORRECTION"],
      });
      return Object.freeze({
        classification: "EXPLICIT_CORRECTION",
        sourceReport: source,
        truthRecord: corrected,
        projection: await persistProjectionAtHead(executor, context),
      });
    }
  }

  const stableSubject = existingTruths.find((truth) =>
    sameSubject(source, truth) && truth.markers.length === 0 &&
    !existingTruths.some((candidate) => candidate.supersedesTruthRecordId === truth.truthRecordId));
  if (sameNative.length > 0 || stableSubject || priorRevision !== null) {
    const candidate = createTruthFromVerifiedSourceV2(source, {
      supersedesTruthRecordId: null,
      markers: ["SOURCE_CONTRADICTION"],
    });
    await insertTruthRecordV2FromWriter(executor, context, candidate);
    const related = stableSubject ?? sameNative.at(-1) ?? null;
    if (related) {
      await appendQuarantine(
        executor,
        context,
        source,
        candidate,
        related,
        [priorRevision === null ? "SOURCE_ASSERTION_CONTRADICTION" : "CORRECTION_TARGET_NOT_FOUND"],
        true,
      );
    } else {
      await appendQuarantine(
        executor,
        context,
        source,
        candidate,
        null,
        ["CORRECTION_TARGET_NOT_FOUND"],
        false,
      );
    }
    return Object.freeze({
      classification: "SOURCE_CONTRADICTION",
      sourceReport: source,
      truthRecord: candidate,
      projection: await persistProjectionAtHead(executor, context),
    });
  }

  const truth = createTruthFromVerifiedSourceV2(source, {
    supersedesTruthRecordId: null,
    markers: [],
  });
  await insertTruthRecordV2FromWriter(executor, context, truth);
  await appendRealityEventV2FromWriter(executor, context, {
    eventType: "OBSERVED",
    sourceReportId: source.sourceReportId,
    truthRecordId: truth.truthRecordId,
    relatedTruthRecordId: null,
    reasonCodes: [],
  });
  return Object.freeze({
    classification: "NEW_FACT",
    sourceReport: source,
    truthRecord: truth,
    projection: await persistProjectionAtHead(executor, context),
  });
}

export function ingestRealitySourceReportV2Postgres(
  db: WaiaPostgresDb,
  context: RealityAccountContext,
  input: AppendRealitySourceReportV2Input,
): Promise<RealityIngestResultV2> {
  return runWaiaPostgresTransaction(db, (tx) =>
    ingestRealitySourceReportV2FromWriter(tx, context, input));
}

/** Resolves uncertainty without promoting disputed truth. Stable truth changes only via SUPERSEDED. */
export function releaseRealityQuarantineV2Postgres(
  db: WaiaPostgresDb,
  context: RealityAccountContext,
  sourceReportId: string,
): Promise<RealityProjectionV2> {
  return runWaiaPostgresTransaction(db, async (tx) => {
    await lockRealityScopeV2(tx, context);
    const [sources, truths, events] = await Promise.all([
      listRealitySourceReportsV2(tx, context),
      listTruthRecordsV2(tx, context),
      listRealityEventsV2(tx, context),
    ]);
    const source = sources.find((entry) => entry.sourceReportId === sourceReportId);
    const truth = truths.find((entry) => entry.sourceReportId === sourceReportId);
    const quarantined = events.some((event) => event.sourceReportId === sourceReportId &&
      (event.eventType === "QUARANTINED" || event.eventType === "SOURCE_CONTRADICTION"));
    const released = events.some((event) => event.sourceReportId === sourceReportId &&
      event.eventType === "RELEASED");
    if (!source || !truth || !quarantined || released) {
      throw new Error("Reality quarantine release requires one unresolved truth-bearing quarantine");
    }
    await appendRealityEventV2FromWriter(tx, context, {
      eventType: "RELEASED",
      sourceReportId,
      truthRecordId: truth.truthRecordId,
      relatedTruthRecordId: null,
      reasonCodes: ["QUARANTINE_RESOLVED_WITHOUT_PROMOTION"],
    });
    const projection = await persistProjectionAtHead(tx, context);
    if (!projection) throw new Error("Reality release projection missing");
    return projection;
  });
}
