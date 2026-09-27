import { computeSourceTrustDigest } from "@/lib/trader/mi/serialize-source-trust";
import type { TrustAsOfReceiptV1 } from "@/lib/trader/mi/trust-as-of-v1";
import type { InformationEvidenceV2 } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import type { AnalysisPacket } from "../durable-noncapital/recorded-analysis-v1";
import { digest } from "../durable-noncapital/recorded-analysis-v1";
import { check, LANES, type ResearchAssignment } from "./contract";

export type ResearchTrustRevision = { id: string; schemaVersion: "mi-source-trust-v1"; organizationId: string; sourceId: string;
  trustScore: string; rationale: string; recordedBy: string; eventTime: string; availableAt: string | null; ingestTime: string;
  revisionOf: string | null; revisionSeq: number; contentDigest: string };
export type ResearchLaneDisposition = { lane: typeof LANES[number]; status: "TRUSTED" | "UNTRUSTED" | "UNKNOWN";
  reason: string | null; evidenceId: string | null; fullLaneDigest: string | null; normalizedDigest: string | null };

/** Verifies the selected saved revision, including chronology excluded from its native digest. No history lookup. */
export function assertSelectedResearchTrust(trust: TrustAsOfReceiptV1, revision: ResearchTrustRevision): void {
  check(trust.status === "RESOLVED" && trust.selectedTrustRevisionId === revision.id && trust.organizationId === revision.organizationId &&
    trust.sourceId === revision.sourceId && trust.selectedContentDigest === revision.contentDigest &&
    trust.selectedRevisionSeq === revision.revisionSeq && trust.selectedTrustScore === revision.trustScore, "SOURCE_REVISION_CONFLICT");
  check(computeSourceTrustDigest({ ...revision, eventTime: new Date(revision.eventTime), ingestTime: new Date(revision.ingestTime) }) === revision.contentDigest,
    "SOURCE_REVISION_CONTENT_CONFLICT");
  const selected = trust.visiblePrefix.filter(v => v.id === revision.id);
  check(selected.length === 1 && digest(selected[0]) === digest({ id: revision.id, revisionSeq: revision.revisionSeq,
    revisionOf: revision.revisionOf, contentDigest: revision.contentDigest, trustScore: revision.trustScore,
    eventTimeUtc: revision.eventTime, availableAtUtc: revision.availableAt, ingestTimeUtc: revision.ingestTime }), "SOURCE_REVISION_CHRONOLOGY_CONFLICT");
}

/** Owner-local categorical projection; never writes SourceTrust or produces generic source authority. */
export function admitResearchLanes(packet: AnalysisPacket, assignment: ResearchAssignment,
  revisions: readonly ResearchTrustRevision[]): { evidence: InformationEvidenceV2[]; lanes: ResearchLaneDisposition[] } {
  const evidence: InformationEvidenceV2[] = []; const lanes: ResearchLaneDisposition[] = [];
  for (const lane of LANES) {
    const index = packet.normalized.observations.findIndex(o => o.kind === "ohlcv_bar" && o.interval === lane);
    const normalized = index < 0 ? null : packet.normalized.observations[index]!;
    const saved = index < 0 ? null : packet.sources[index]!;
    const disposition = { lane, fullLaneDigest: packet.normalized.bars[lane] ? digest(packet.normalized.bars[lane]) : null,
      normalizedDigest: normalized ? digest(normalized) : null };
    const trust = saved?.trust as TrustAsOfReceiptV1 | null;
    if (!normalized || !saved || saved.receipt.status !== "AVAILABLE" || trust?.status !== "RESOLVED") {
      lanes.push({ ...disposition, status: "UNKNOWN", reason: "RESEARCH_LANE_UNASSESSED", evidenceId: null }); continue;
    }
    const observation = saved.observation as { id: string; contentDigest: string; observationKind: string; schemaVersion: string; availableAt: string };
    check(observation && observation.observationKind === "ohlcv_bar" && observation.schemaVersion === "mi-canonical-pit-observation-v1" &&
      saved.receipt.providerId === "htx_spot", "RESEARCH_LANE_IDENTITY_CONFLICT");
    const matching = revisions.filter(r => r.id === trust.selectedTrustRevisionId);
    check(matching.length === 1, "SOURCE_REVISION_MISSING"); assertSelectedResearchTrust(trust, matching[0]!);
    const selection = assignment.admissions.find(a => a.lane === lane)!;
    const admitted = selection.sourceId === trust.sourceId && selection.revisionDigests.includes(trust.selectedContentDigest!);
    const category = admitted ? "TRUSTED" : "UNTRUSTED";
    const reason = admitted ? null : "RESEARCH_SOURCE_REVISION_NOT_ADMITTED";
    const evidenceId = `research-recorded-what/v1/${assignment.contentDigest}/${packet.contentDigest}/${lane}`;
    const score = Number(trust.selectedTrustScore);
    check(typeof trust.selectedTrustScore === "string" && trust.selectedTrustScore.trim().length > 0 && Number.isFinite(score) && score >= 0 && score <= 1,
      "SOURCE_TRUST_SCORE_INVALID");
    evidence.push({ evidenceId, evidenceFamily: `research_recorded_price_${lane}_v1`, providerId: "htx_spot", sourceId: trust.sourceId,
      observationId: observation.id, observationKind: "ohlcv_bar", observationSchemaVersion: "mi-canonical-pit-observation-v1",
      observationContentDigest: observation.contentDigest, trustAsOfReceiptId: trust.id,
      trustRevisionId: trust.selectedTrustRevisionId, trustRevisionContentDigest: trust.selectedContentDigest,
      measurementDefinitionId: null, measurementDefinitionContentDigest: null, measurementValueId: null, measurementValueContentDigest: null,
      availability: "AVAILABLE", availableAt: observation.availableAt, trust: category, trustScore: score, pitQualified: true, replayEligible: true,
      dependenceGroup: "htx-spot-origin", contradictionGroup: null, contradiction: "NONE", epistemicRole: "PRICE_STATE",
      historyScope: "NOT_HISTORICAL", degradationReasonCodes: reason ? [reason] : [] });
    lanes.push({ ...disposition, status: category, reason, evidenceId });
  }
  return { evidence, lanes };
}
