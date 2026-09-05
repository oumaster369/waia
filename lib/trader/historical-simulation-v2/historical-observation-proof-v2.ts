import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as pgSchema from "@/db/schema.postgres";
import { readCanonicalPitObservationWithinHeldTransactionV1Postgres } from
  "@/lib/trader/mi/canonical-pit-service-postgres";
import { canonicalJsonString, computeStableJsonDigest } from
  "@/lib/trader/research/digest";

/**
 * Historical-only proof boundary around the canonical PIT reader. Downstream
 * Forecast code supplies expected immutable lineage and receives no Source,
 * trust, PIT, or Observation construction authority in return.
 */
export async function verifyHistoricalObservationProofV2(
  sql: postgres.Sql,
  expected: Readonly<{
    organizationId: string;
    sourceId: string;
    observationId: string;
    subjectRef: string;
    eventTime: string;
    availableAt: string;
    ingestTime: string;
    trustAsOfReceiptId: string;
    sourceTrustRevisionId: string;
    sourceTrustContentDigest: string;
    trustScore: number;
    contentDigest: string;
    latestClose: string | number;
  }>,
): Promise<void> {
  const observation = await readCanonicalPitObservationWithinHeldTransactionV1Postgres(
    drizzle(sql, { schema: pgSchema }),
    { organizationId: expected.organizationId },
    expected.observationId,
  );
  const normalizedObservation = Object.freeze({
    schemaVersion: "waia.trader.observation.v1" as const,
    kind: "ohlcv_bar" as const,
    interval: "1m" as const,
    sessionPhase: "UNKNOWN" as const,
    provenance: Object.freeze({
      providerId: "htx_spot" as const,
      venue: "htx",
      feedKind: "ohlcv_bar",
      symbol: expected.subjectRef,
      eventTimeUtc: expected.eventTime,
      ingestTimeUtc: expected.ingestTime,
    }),
    health: "HEALTHY" as const,
    freshnessMs: 0,
    latencyMs: Math.max(0, Date.parse(expected.ingestTime) - Date.parse(expected.eventTime)),
    confidence: expected.trustScore,
    payload: Object.freeze({
      barCount: 1,
      latestClose: expected.latestClose,
      latestBarCloseTime: expected.eventTime,
    }),
  });
  if (!observation ||
      observation.organizationId !== expected.organizationId ||
      observation.sourceId !== expected.sourceId ||
      observation.observationKind !== "ohlcv_bar" ||
      observation.subjectRef !== expected.subjectRef ||
      observation.canonicalProviderId !== "htx_spot" ||
      observation.eventTime.toISOString() !== expected.eventTime ||
      observation.availableAt.toISOString() !== expected.availableAt ||
      observation.ingestTime.toISOString() !== expected.ingestTime ||
      observation.trustAsOfReceiptId !== expected.trustAsOfReceiptId ||
      observation.sourceTrustRevisionId !== expected.sourceTrustRevisionId ||
      observation.sourceTrustContentDigest !== expected.sourceTrustContentDigest ||
      observation.normalizedInputDigest !== computeStableJsonDigest(normalizedObservation) ||
      observation.payloadJson !== canonicalJsonString(normalizedObservation.payload) ||
      observation.contentDigest !== expected.contentDigest) {
    throw new Error("HISTORICAL_OBSERVATION_PROOF_REFUSED:CANONICAL_PIT_MISMATCH");
  }
}
