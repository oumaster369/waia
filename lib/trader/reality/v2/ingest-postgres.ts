import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { RealityProjectionV2, RealitySourceReportV2, TruthRecordV2 } from "./contracts";
import {
  appendContradictoryRealityTruthV2FromWriter,
  appendObservedRealityTruthV2FromWriter,
  appendRealitySourceObservationV2FromWriter,
  appendReleasedRealityQuarantineV2FromWriter,
  appendSupersededRealityTruthV2FromWriter,
  appendUnverifiableRealityQuarantineV2FromWriter,
  listRealityEventsV2,
  listRealitySourceReportsV2,
  listTruthRecordsV2,
  lockRealityScopeV2,
  persistCanonicalRealityProjectionV2FromWriter,
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

export async function ingestRealitySourceReportV2FromWriter(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  input: AppendRealitySourceReportV2Input,
): Promise<RealityIngestResultV2> {
  await lockRealityScopeV2(executor, context);
  const appended = await appendRealitySourceObservationV2FromWriter(executor, context, input);
  const source = appended.report;
  if (!appended.insertedNew) {
    return Object.freeze({
      classification: "DUPLICATE",
      sourceReport: source,
      truthRecord: null,
      projection: await persistCanonicalRealityProjectionV2FromWriter(executor, context),
    });
  }

  const [existingTruths, existingEvents] = await Promise.all([
    listTruthRecordsV2(executor, context),
    listRealityEventsV2(executor, context),
  ]);
  if (source.structuralVerification !== "VERIFIED" || source.primitiveAssertion === null ||
    source.sourceNativeIdentity === null) {
    await appendUnverifiableRealityQuarantineV2FromWriter(
      executor,
      context,
      source,
      source.verificationReasonCodes.length > 0
        ? source.verificationReasonCodes
        : ["SOURCE_UNATTRIBUTED"],
    );
    return Object.freeze({
      classification: "QUARANTINED",
      sourceReport: source,
      truthRecord: null,
      projection: await persistCanonicalRealityProjectionV2FromWriter(executor, context),
    });
  }

  const sameNative = existingTruths.filter((truth) => sameNativeFact(source, truth));
  if (sameNative.some((truth) => semanticDigest(source) === truthSemanticDigest(truth))) {
    return Object.freeze({
      classification: "DUPLICATE",
      sourceReport: source,
      truthRecord: null,
      projection: await persistCanonicalRealityProjectionV2FromWriter(executor, context),
    });
  }

  const priorRevision = source.sourceNativeIdentity.supersedesNativeRevision;
  if (priorRevision !== null) {
    const correctionTarget = existingTruths.find((truth) => {
      const native = truth.sourceNativeIdentity;
      return native !== null && source.sourceNativeIdentity !== null &&
        truth.markers.length === 0 &&
        existingEvents.some((event) =>
          event.truthRecordId === truth.truthRecordId &&
          (event.eventType === "OBSERVED" || event.eventType === "SUPERSEDED")) &&
        !existingEvents.some((event) =>
          event.relatedTruthRecordId === truth.truthRecordId &&
          event.eventType === "SUPERSEDED") &&
        truth.sourceKind === source.sourceKind &&
        native.identityKind === source.sourceNativeIdentity.identityKind &&
        native.nativeId === source.sourceNativeIdentity.nativeId &&
        native.nativeRevision === priorRevision && sameSubject(source, truth);
    });
    if (correctionTarget) {
      const corrected = await appendSupersededRealityTruthV2FromWriter(
        executor,
        context,
        source,
        correctionTarget,
      );
      return Object.freeze({
        classification: "EXPLICIT_CORRECTION",
        sourceReport: source,
        truthRecord: corrected,
        projection: await persistCanonicalRealityProjectionV2FromWriter(executor, context),
      });
    }
    await appendUnverifiableRealityQuarantineV2FromWriter(
      executor,
      context,
      source,
      ["CORRECTION_TARGET_NOT_FOUND"],
    );
    return Object.freeze({
      classification: "QUARANTINED",
      sourceReport: source,
      truthRecord: null,
      projection: await persistCanonicalRealityProjectionV2FromWriter(executor, context),
    });
  }

  const stableSubject = existingTruths.find((truth) =>
    sameSubject(source, truth) && truth.markers.length === 0 &&
    !existingTruths.some((candidate) => candidate.supersedesTruthRecordId === truth.truthRecordId));
  if (sameNative.length > 0 || stableSubject) {
    const related = stableSubject ?? sameNative.at(-1);
    if (!related) throw new Error("Reality contradiction requires current stable truth");
    const candidate = await appendContradictoryRealityTruthV2FromWriter(
      executor,
      context,
      source,
      related,
      ["SOURCE_ASSERTION_CONTRADICTION"],
    );
    return Object.freeze({
      classification: "SOURCE_CONTRADICTION",
      sourceReport: source,
      truthRecord: candidate,
      projection: await persistCanonicalRealityProjectionV2FromWriter(executor, context),
    });
  }

  const truth = await appendObservedRealityTruthV2FromWriter(executor, context, source);
  return Object.freeze({
    classification: "NEW_FACT",
    sourceReport: source,
    truthRecord: truth,
    projection: await persistCanonicalRealityProjectionV2FromWriter(executor, context),
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
    await appendReleasedRealityQuarantineV2FromWriter(tx, context, source, truth);
    const projection = await persistCanonicalRealityProjectionV2FromWriter(tx, context);
    if (!projection) throw new Error("Reality release projection missing");
    return projection;
  });
}
