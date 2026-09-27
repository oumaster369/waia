import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import { assertPacketSize, assertSeal, digest, requireCondition as check,
  type AnalysisSession, type AnalysisPacket } from "./recorded-analysis-v1";
import { normalizeMandatory } from "./normalize-mandatory-packet-v1";

export function encodeBody(value: { contentDigest: string }): string {
  const body = { ...value } as Partial<typeof value>; delete body.contentDigest; return canonicalJsonString(body);
}
export function decodeBody<T extends { contentDigest: string }>(row: { contentDigest: string; bodyJson: string }): T {
  const value = { ...JSON.parse(row.bodyJson), contentDigest: row.contentDigest } as T;
  assertSeal(value); check(encodeBody(value) === row.bodyJson, "BODY_CONTENT_CONFLICT"); return value;
}

/** Data comparisons only; persistence/authentication remains the caller's held read boundary. */
export function validateRecordedPacket(session: AnalysisSession, sequence: number,
  row: { configDigest: string; analysisPitAnchor: string }, packet: AnalysisPacket): void {
    check(packet.session.configDigest === session.configDigest && digest(packet.session) === digest(session) && packet.sequence === sequence &&
      row!.configDigest === session.configDigest && Date.parse(row!.analysisPitAnchor) === Date.parse(packet.analysisPitAnchor), "PACKET_SCOPE_CONFLICT");
    assertPacketSize(session, packet);
    check(digest(normalizeMandatory(packet.normalized.captured, session, packet.analysisPitAnchor)) === digest(packet.normalized), "NORMALIZATION_CONTENT_CONFLICT");
    check(digest(packet.previousState) === packet.previousStateDigest, "PREDECESSOR_CONFLICT");
}
export function validateRecordedSourcePair(packet: AnalysisPacket, index: number, saved: AnalysisPacket["sources"][number]): void {
  const evidence = packet.sources[index]!;
  const attempt = prepareCanonicalPitAttemptV1(packet.normalized.observations[index]!, { pitCutoffUtc: packet.analysisPitAnchor });
  check(attempt.normalizedInputDigest === evidence.receipt.normalizedInputDigest && attempt.gatewayKind === evidence.receipt.gatewayKind &&
    attempt.providerId === evidence.receipt.providerId, "SOURCE_NORMALIZATION_CONFLICT");
  check(digest(saved) === digest(evidence), "SOURCE_RECORD_CONFLICT");
    if (evidence.receipt.status === "AVAILABLE") {
      // A valid stored self-seal and caller-declared normalized digest do not prove
      // that the canonical body is the input consumed by this analytical packet.
      check(attempt.status === "AVAILABLE" && saved.observation && saved.trust, "SOURCE_CONSUMED_INPUT_CONFLICT");
      const observation = saved.observation as Record<string, unknown>;
      const trust = saved.trust as Record<string, unknown>;
      check(digest({ kind: observation.observationKind, subject: observation.subjectRef,
        provider: observation.canonicalProviderId, payload: JSON.parse(observation.payloadJson as string),
        event: observation.eventTime, available: observation.availableAt, ingest: observation.ingestTime }) ===
        digest({ kind: attempt.kind, subject: attempt.subjectRef, provider: attempt.providerId,
          payload: attempt.payloadCanonical, event: attempt.eventTimeUtc, available: attempt.availableAtUtc, ingest: attempt.ingestTimeUtc }) &&
        trust.status === "RESOLVED" && trust.anchorTimeUtc === attempt.availableAtUtc &&
        trust.sourceId === evidence.receipt.sourceId && trust.selectedTrustRevisionId === observation.sourceTrustRevisionId &&
        trust.selectedContentDigest === observation.sourceTrustContentDigest, "SOURCE_CONSUMED_INPUT_CONFLICT");
    }
}
