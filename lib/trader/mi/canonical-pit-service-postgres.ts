import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  persistCanonicalAvailableGatewayWithinTransactionV1Postgres,
  persistCanonicalAvailableGatewayV1Postgres,
  persistCanonicalGatewayOutcomeV1Postgres,
  readCanonicalPitObservationV1Postgres,
  type CanonicalGatewayPitReceiptV1,
  type CanonicalPitObservationRecordV1,
} from "@/lib/trader/mi/canonical-pit-repository-postgres";
import { findSourceByLogicalKeyPostgres } from "@/lib/trader/mi/repository-postgres";
import { resolveAndPersistTrustAsOfV1Postgres } from "@/lib/trader/mi/trust-as-of-repository-postgres";
import {
  prepareCanonicalPitAttemptV1,
  type PreparedCanonicalPitAttemptV1,
} from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type CanonicalPitServiceResultV1 = {
  attempt: PreparedCanonicalPitAttemptV1;
  receipt: CanonicalGatewayPitReceiptV1;
  receiptInsertedNew: boolean;
  observation: CanonicalPitObservationRecordV1 | null;
  observationInsertedNew: boolean;
};

/**
 * Server-only held-transaction seam for authority compositions that already own
 * their PostgreSQL transaction. Keeping this delegation here preserves the
 * repository boundary while guaranteeing that no second connection is opened.
 */
export function persistCanonicalAvailableGatewayWithinHeldTransactionV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: Parameters<typeof persistCanonicalAvailableGatewayWithinTransactionV1Postgres>[2],
) {
  return persistCanonicalAvailableGatewayWithinTransactionV1Postgres(
    db,
    requireOrgContext(context.organizationId),
    input,
  );
}

/** Server-only replay companion for the held-transaction persistence seam. */
export function readCanonicalPitObservationWithinHeldTransactionV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  observationId: string,
) {
  return readCanonicalPitObservationV1Postgres(
    db,
    requireOrgContext(context.organizationId),
    observationId,
  );
}

async function persistOutcome(
  db: WaiaPostgresDb,
  context: OrgContext,
  attempt: PreparedCanonicalPitAttemptV1,
  input: {
    status: "UNAVAILABLE" | "REJECTED";
    reason: NonNullable<PreparedCanonicalPitAttemptV1["reason"]>;
    sourceId: string | null;
    trustAsOfReceiptId: string | null;
  },
): Promise<CanonicalPitServiceResultV1> {
  const stored = await persistCanonicalGatewayOutcomeV1Postgres(db, context, {
    providerId: attempt.providerId,
    gatewayKind: attempt.gatewayKind,
    status: input.status,
    reason: input.reason,
    sourceId: input.sourceId,
    trustAsOfReceiptId: input.trustAsOfReceiptId,
    observationId: null,
    observationContentDigest: null,
    normalizedInputDigest: attempt.normalizedInputDigest,
  });
  return {
    attempt,
    receipt: stored.receipt,
    receiptInsertedNew: stored.insertedNew,
    observation: null,
    observationInsertedNew: false,
  };
}

/**
 * One fail-closed gateway/replay persistence path. It requires an existing
 * canonical Source and resolves trust at the recorded availability timestamp.
 */
export async function processCanonicalPitObservationV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  observation: NormalizedObservation,
  options: { pitCutoffUtc?: string } = {},
): Promise<CanonicalPitServiceResultV1> {
  const scoped = requireOrgContext(context.organizationId);
  const attempt = prepareCanonicalPitAttemptV1(observation, options);
  if (!attempt.source) {
    return persistOutcome(db, scoped, attempt, {
      status: "REJECTED",
      reason: attempt.reason ?? "INVALID_PROVENANCE",
      sourceId: null,
      trustAsOfReceiptId: null,
    });
  }

  const source = await findSourceByLogicalKeyPostgres(
    db,
    scoped,
    attempt.source.venue,
    attempt.source.feedKind,
    attempt.source.symbol,
  );
  if (!source) {
    return persistOutcome(db, scoped, attempt, {
      status: "REJECTED",
      reason: "SOURCE_UNKNOWN",
      sourceId: null,
      trustAsOfReceiptId: null,
    });
  }
  if (source.status !== "active") {
    return persistOutcome(db, scoped, attempt, {
      status: "UNAVAILABLE",
      reason: "SOURCE_UNAVAILABLE",
      sourceId: source.id,
      trustAsOfReceiptId: null,
    });
  }

  if (attempt.status === "REJECTED") {
    return persistOutcome(db, scoped, attempt, {
      status: "REJECTED",
      reason: attempt.reason ?? "INVALID_PAYLOAD",
      sourceId: source.id,
      trustAsOfReceiptId: null,
    });
  }
  if (!attempt.availableAtUtc || !attempt.eventTimeUtc || !attempt.ingestTimeUtc) {
    return persistOutcome(db, scoped, attempt, {
      status: "REJECTED",
      reason: "INVALID_CHRONOLOGY",
      sourceId: source.id,
      trustAsOfReceiptId: null,
    });
  }

  if (attempt.status === "UNAVAILABLE") {
    return persistOutcome(db, scoped, attempt, {
      status: "UNAVAILABLE",
      reason: attempt.reason ?? "SOURCE_UNAVAILABLE",
      sourceId: source.id,
      trustAsOfReceiptId: null,
    });
  }
  const trust = await resolveAndPersistTrustAsOfV1Postgres(db, scoped, {
    sourceId: source.id,
    anchorTime: new Date(attempt.availableAtUtc),
  });
  if (trust.receipt.status !== "RESOLVED") {
    return persistOutcome(db, scoped, attempt, {
      status: "REJECTED",
      reason: "TRUST_AS_OF_UNKNOWN",
      sourceId: source.id,
      trustAsOfReceiptId: trust.receipt.id,
    });
  }
  if (!attempt.kind || !attempt.subjectRef || !attempt.payloadCanonical) {
    return persistOutcome(db, scoped, attempt, {
      status: "REJECTED",
      reason: "INVALID_PAYLOAD",
      sourceId: source.id,
      trustAsOfReceiptId: trust.receipt.id,
    });
  }

  const stored = await persistCanonicalAvailableGatewayV1Postgres(db, scoped, {
    sourceId: source.id,
    observationKind: attempt.kind,
    subjectRef: attempt.subjectRef,
    payloadCanonical: attempt.payloadCanonical,
    eventTime: new Date(attempt.eventTimeUtc),
    availableAt: new Date(attempt.availableAtUtc),
    ingestTime: new Date(attempt.ingestTimeUtc),
    canonicalProviderId: attempt.providerId,
    trustAsOfReceiptId: trust.receipt.id,
    normalizedInputDigest: attempt.normalizedInputDigest,
  });
  return {
    attempt,
    receipt: stored.receipt,
    receiptInsertedNew: stored.receiptInsertedNew,
    observation: stored.observation,
    observationInsertedNew: stored.observationInsertedNew,
  };
}
