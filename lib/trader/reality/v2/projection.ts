import { createRealityProjectionV2, type RealityEventV2, type RealityProjectionV2,
  type RealityProjectionEntryV2, type RealityProjectionUncertaintyV2,
  type RealitySourceReportV2, type TruthRecordV2 } from "./contracts";

export type RealityLedgerV2 = Readonly<{
  sources: readonly RealitySourceReportV2[];
  truths: readonly TruthRecordV2[];
  events: readonly RealityEventV2[];
}>;

function subjectKey(subject: TruthRecordV2["subject"]): string {
  return `${subject.subjectClass}:${subject.subjectKey}`;
}

function projectionEntry(truth: TruthRecordV2): RealityProjectionEntryV2 {
  return Object.freeze({
    subject: truth.subject,
    truthRecordId: truth.truthRecordId,
    sourceReportId: truth.sourceReportId,
    validAtUtc: truth.validAtUtc,
    knowledgeAtUtc: truth.knowledgeAtUtc,
    primitiveAssertion: truth.primitiveAssertion,
  });
}

/** Deterministic last-stable fold. It never arbitrates by confidence or source merit. */
export function foldRealityProjectionV2(
  context: Readonly<{ organizationId: string; accountId: string }>,
  knowledgeAsOfUtc: string,
  ledger: RealityLedgerV2,
): RealityProjectionV2 {
  const asOf = new Date(knowledgeAsOfUtc).getTime();
  if (!Number.isFinite(asOf) || new Date(asOf).toISOString() !== knowledgeAsOfUtc) {
    throw new Error("Reality projection requires canonical knowledge as-of time");
  }
  const scoped = <T extends { organizationId: string; accountId: string; knowledgeAtUtc: string }>(
    values: readonly T[],
  ) => values.filter((value) => {
    if (value.organizationId !== context.organizationId || value.accountId !== context.accountId) {
      throw new Error("cross-scope Reality ledger input");
    }
    return new Date(value.knowledgeAtUtc).getTime() <= asOf;
  });
  const sources = scoped(ledger.sources);
  const truths = scoped(ledger.truths);
  const events = scoped(ledger.events).sort((left, right) =>
    BigInt(left.eventSequence) < BigInt(right.eventSequence) ? -1 : 1);
  const sourceById = new Map(sources.map((source) => [source.sourceReportId, source]));
  const truthById = new Map(truths.map((truth) => [truth.truthRecordId, truth]));
  const stable = new Map<string, TruthRecordV2>();
  const uncertain = new Map<string, RealityProjectionUncertaintyV2>();
  let prior: RealityEventV2 | null = null;

  for (const event of events) {
    const expectedSequence = prior === null ? 1n : BigInt(prior.eventSequence) + 1n;
    if (BigInt(event.eventSequence) !== expectedSequence ||
      event.previousEventDigestHex !== (prior?.contentDigestHex ?? null)) {
      throw new Error("Reality event ledger sequence/digest chain is invalid");
    }
    const source = sourceById.get(event.sourceReportId);
    if (!source) throw new Error("Reality event references unavailable source at as-of time");
    const truth = event.truthRecordId === null ? null : truthById.get(event.truthRecordId);
    const related = event.relatedTruthRecordId === null
      ? null
      : truthById.get(event.relatedTruthRecordId);
    if (event.truthRecordId !== null && !truth || event.relatedTruthRecordId !== null && !related) {
      throw new Error("Reality event references unavailable truth at as-of time");
    }

    if (event.eventType === "OBSERVED") {
      if (!truth) throw new Error("OBSERVED requires exact truth");
      const key = subjectKey(truth.subject);
      const current = stable.get(key);
      if (current && current.truthRecordId !== truth.truthRecordId) {
        throw new Error("OBSERVED cannot replace last stable truth");
      }
      stable.set(key, truth);
    } else if (event.eventType === "SUPERSEDED") {
      if (!truth || !related || truth.supersedesTruthRecordId !== related.truthRecordId) {
        throw new Error("SUPERSEDED requires explicit linked correction truth");
      }
      const key = subjectKey(truth.subject);
      if (stable.get(key)?.truthRecordId !== related.truthRecordId) {
        throw new Error("SUPERSEDED target is not the last stable truth");
      }
      stable.set(key, truth);
      uncertain.delete(related.sourceReportId);
      uncertain.delete(truth.sourceReportId);
    } else if (event.eventType === "SOURCE_CONTRADICTION") {
      if (!truth || !related || !truth.markers.includes("SOURCE_CONTRADICTION") ||
        stable.get(subjectKey(related.subject))?.truthRecordId !== related.truthRecordId) {
        throw new Error("SOURCE_CONTRADICTION must preserve an exact stable target");
      }
      uncertain.set(source.sourceReportId, Object.freeze({
        sourceReportId: source.sourceReportId,
        subject: source.subject,
        marker: "SOURCE_CONTRADICTION",
        reasonCodes: event.reasonCodes,
      }));
    } else if (event.eventType === "QUARANTINED") {
      uncertain.set(source.sourceReportId, Object.freeze({
        sourceReportId: source.sourceReportId,
        subject: source.subject,
        marker: source.attributionStatus === "UNATTRIBUTED"
          ? "UNATTRIBUTED"
          : "SOURCE_CONTRADICTION",
        reasonCodes: event.reasonCodes,
      }));
    } else if (event.eventType === "RELEASED") {
      uncertain.delete(source.sourceReportId);
    }
    prior = event;
  }

  return createRealityProjectionV2({
    organizationId: context.organizationId,
    accountId: context.accountId,
    knowledgeAsOfUtc,
    frontierSequence: prior?.eventSequence ?? "0",
    frontierEventDigestHex: prior?.contentDigestHex ?? null,
    stableEntries: [...stable.values()].map(projectionEntry),
    uncertainties: [...uncertain.values()],
  });
}
