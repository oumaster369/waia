import {
  type CanonicalExternalObservationKindV1,
  type CanonicalGatewayRejectionReasonV1,
  type CanonicalSourceLogicalIdentityV1,
} from "@/lib/trader/mi/canonical-observation-v1";
import { validateCanonicalPrimitiveContractV1 } from "@/lib/trader/market-data/normalization/canonical-pit-contract";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";

export type PreparedCanonicalPitAttemptV1 = {
  gatewayKind: NormalizedObservation["kind"];
  providerId: NormalizedObservation["provenance"]["providerId"];
  normalizedInputDigest: string;
  status: "AVAILABLE" | "UNAVAILABLE" | "REJECTED";
  reason: CanonicalGatewayRejectionReasonV1 | null;
  kind: CanonicalExternalObservationKindV1 | null;
  source: CanonicalSourceLogicalIdentityV1 | null;
  subjectRef: string | null;
  payloadCanonical: Record<string, unknown> | null;
  eventTimeUtc: string | null;
  availableAtUtc: string | null;
  ingestTimeUtc: string | null;
};

function isValidIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function rejected(
  observation: NormalizedObservation,
  normalizedInputDigest: string,
  reason: CanonicalGatewayRejectionReasonV1,
  kind: CanonicalExternalObservationKindV1 | null,
  source: CanonicalSourceLogicalIdentityV1 | null,
): PreparedCanonicalPitAttemptV1 {
  return {
    gatewayKind: observation.kind,
    providerId: observation.provenance.providerId,
    normalizedInputDigest,
    status: "REJECTED",
    reason,
    kind,
    source,
    subjectRef: source?.symbol ?? null,
    payloadCanonical: null,
    eventTimeUtc: null,
    availableAtUtc: null,
    ingestTimeUtc: null,
  };
}

/**
 * Canonicalizes one normalized gateway input without I/O. Availability is the
 * recorded ingestion timestamp; no inferred delay, grace period, or substitute
 * input is introduced.
 */
export function prepareCanonicalPitAttemptV1(
  observation: NormalizedObservation,
  options: { pitCutoffUtc?: string } = {},
): PreparedCanonicalPitAttemptV1 {
  const normalizedInputDigest = computeStableJsonDigest(observation);
  const decision = validateCanonicalPrimitiveContractV1(observation);
  if (decision.status === "REJECTED") {
    return rejected(
      observation,
      normalizedInputDigest,
      decision.reason,
      decision.kind,
      decision.source,
    );
  }
  if (!decision.kind || !decision.source) {
    return rejected(
      observation,
      normalizedInputDigest,
      "INVALID_PROVENANCE",
      decision.kind,
      decision.source,
    );
  }

  const eventTimeUtc = observation.provenance.eventTimeUtc;
  const ingestTimeUtc = observation.provenance.ingestTimeUtc;
  const availableAtUtc = ingestTimeUtc;
  const eventMs = Date.parse(eventTimeUtc);
  const availableMs = Date.parse(availableAtUtc);
  const ingestMs = Date.parse(ingestTimeUtc);
  if (
    !isValidIso(eventTimeUtc) ||
    !isValidIso(availableAtUtc) ||
    !isValidIso(ingestTimeUtc) ||
    eventMs > availableMs ||
    availableMs > ingestMs
  ) {
    return rejected(
      observation,
      normalizedInputDigest,
      "INVALID_CHRONOLOGY",
      decision.kind,
      decision.source,
    );
  }

  if (options.pitCutoffUtc !== undefined) {
    const cutoffMs = Date.parse(options.pitCutoffUtc);
    if (!Number.isFinite(cutoffMs) || eventMs > cutoffMs || availableMs > cutoffMs) {
      return rejected(
        observation,
        normalizedInputDigest,
        "INVALID_CHRONOLOGY",
        decision.kind,
        decision.source,
      );
    }
  }

  if (observation.health === "STALE") {
    return rejected(
      observation,
      normalizedInputDigest,
      "STALE_INPUT",
      decision.kind,
      decision.source,
    );
  }

  return {
    gatewayKind: observation.kind,
    providerId: observation.provenance.providerId,
    normalizedInputDigest,
    status: decision.status,
    reason: decision.reason,
    kind: decision.kind,
    source: decision.source,
    subjectRef: decision.source.symbol,
    payloadCanonical:
      decision.status === "AVAILABLE"
        ? (JSON.parse(canonicalJsonString(observation.payload)) as Record<string, unknown>)
        : null,
    eventTimeUtc,
    availableAtUtc,
    ingestTimeUtc,
  };
}
