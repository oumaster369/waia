import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import {
  CANONICAL_GATEWAY_RECEIPT_SCHEMA_VERSION,
  CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
  type CanonicalExternalObservationKindV1,
  type CanonicalGatewayAvailabilityV1,
  type CanonicalGatewayRejectionReasonV1,
} from "@/lib/trader/mi/canonical-observation-v1";
import {
  assertCanonicalMeasurementDefinitionV1,
  assertCanonicalMeasurementValueLineageV1,
  type CanonicalMeasurementDefinitionV1,
  type CanonicalMeasurementValueLineageV1,
} from "@/lib/trader/mi/measurement-lineage-v1";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

const HEX_64 = /^[0-9a-f]{64}$/;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANONICAL_GATEWAY_RECEIPT_KEYS = Object.freeze([
  "contentDigest",
  "gatewayKind",
  "id",
  "normalizedInputDigest",
  "observationContentDigest",
  "observationId",
  "organizationId",
  "providerId",
  "reason",
  "schemaVersion",
  "sourceId",
  "status",
  "trustAsOfReceiptId",
] as const);

export type CanonicalPitObservationRecordV1 = {
  id: string;
  organizationId: string;
  sourceId: string;
  observationKind: CanonicalExternalObservationKindV1;
  observationKey: string;
  subjectRef: string;
  schemaVersion: typeof CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION;
  payloadJson: string;
  eventTime: Date;
  availableAt: Date;
  ingestTime: Date;
  canonicalProviderId: string;
  trustAsOfReceiptId: string;
  sourceTrustRevisionId: string;
  sourceTrustContentDigest: string;
  normalizedInputDigest: string;
  revisionOf: string | null;
  revisionSeq: number;
  contentDigest: string;
  createdAt: Date;
};

export type CanonicalGatewayPitReceiptV1 = {
  id: string;
  schemaVersion: typeof CANONICAL_GATEWAY_RECEIPT_SCHEMA_VERSION;
  organizationId: string;
  providerId: string;
  gatewayKind: string;
  status: CanonicalGatewayAvailabilityV1;
  reason: CanonicalGatewayRejectionReasonV1 | null;
  sourceId: string | null;
  trustAsOfReceiptId: string | null;
  observationId: string | null;
  observationContentDigest: string | null;
  normalizedInputDigest: string;
  contentDigest: string;
};

export type CanonicalAvailableObservationInputV1 = {
  sourceId: string;
  observationKind: CanonicalExternalObservationKindV1;
  subjectRef: string;
  payloadCanonical: Record<string, unknown>;
  eventTime: Date;
  availableAt: Date;
  ingestTime: Date;
  canonicalProviderId: string;
  trustAsOfReceiptId: string;
  normalizedInputDigest: string;
};

type RepositoryExecutor = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
type CanonicalWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function deterministicUuidFromDigest(digest: string): string {
  if (!HEX_64.test(digest)) throw new Error("CANONICAL_PIT_INVALID_DIGEST");
  const chars = digest.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function requireIsoDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`CANONICAL_PIT_INVALID:${field}`);
  }
  return value;
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`CANONICAL_PIT_INVALID:${field}`);
  }
  return value;
}

function requireDigest(value: string, field: string): string {
  if (!HEX_64.test(value)) throw new Error(`CANONICAL_PIT_INVALID:${field}`);
  return value;
}

function mapCanonicalObservation(
  row: typeof pgSchema.traderMiObservation.$inferSelect,
): CanonicalPitObservationRecordV1 {
  if (
    row.observationKind === "msv_envelope" ||
    !row.availableAt ||
    !row.canonicalProviderId ||
    !row.trustAsOfReceiptId ||
    !row.sourceTrustRevisionId ||
    !row.sourceTrustContentDigest ||
    !row.normalizedInputDigest
  ) {
    throw new Error("CANONICAL_PIT_ROW_INCOMPLETE");
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceId: row.sourceId,
    observationKind: row.observationKind,
    observationKey: row.observationKey,
    subjectRef: row.subjectRef,
    schemaVersion: row.schemaVersion as typeof CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    availableAt: row.availableAt,
    ingestTime: row.ingestTime,
    canonicalProviderId: row.canonicalProviderId,
    trustAsOfReceiptId: row.trustAsOfReceiptId,
    sourceTrustRevisionId: row.sourceTrustRevisionId,
    sourceTrustContentDigest: row.sourceTrustContentDigest,
    normalizedInputDigest: row.normalizedInputDigest,
    revisionOf: row.revisionOf,
    revisionSeq: row.revisionSeq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

/** Exact tenant-scoped replay of one immutable canonical external observation. */
export async function readCanonicalPitObservationV1Postgres(
  ex: Pick<RepositoryExecutor, "select">,
  context: OrgContext,
  observationId: string,
): Promise<CanonicalPitObservationRecordV1 | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiObservation)
    .where(and(
      eq(pgSchema.traderMiObservation.id, observationId),
      eq(pgSchema.traderMiObservation.organizationId, scoped.organizationId),
    ))
    .limit(1);
  if (!rows[0]) return null;
  const observation = mapCanonicalObservation(rows[0]);
  let payloadCanonical: Record<string, unknown>;
  try {
    payloadCanonical = JSON.parse(observation.payloadJson) as Record<string, unknown>;
  } catch {
    throw new Error("CANONICAL_PIT_ROW_CONTENT_CONFLICT");
  }
  const expectedDigest = sha256Canonical({
    schemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    organizationId: observation.organizationId,
    sourceId: observation.sourceId,
    observationKey: observation.observationKey,
    observationKind: observation.observationKind,
    subjectRef: observation.subjectRef,
    eventTimeUtc: observation.eventTime.toISOString(),
    availableAtUtc: observation.availableAt.toISOString(),
    ingestTimeUtc: observation.ingestTime.toISOString(),
    canonicalProviderId: observation.canonicalProviderId,
    trustAsOfReceiptId: observation.trustAsOfReceiptId,
    sourceTrustRevisionId: observation.sourceTrustRevisionId,
    sourceTrustContentDigest: observation.sourceTrustContentDigest,
    normalizedInputDigest: observation.normalizedInputDigest,
    payloadCanonical,
    revisionOf: observation.revisionOf,
    revisionSeq: observation.revisionSeq,
  });
  if (expectedDigest !== observation.contentDigest) {
    throw new Error("CANONICAL_PIT_ROW_CONTENT_CONFLICT");
  }
  return observation;
}

function mapGatewayReceipt(
  row: typeof pgSchema.traderMiGatewayPitReceiptV1.$inferSelect,
): CanonicalGatewayPitReceiptV1 {
  return row.receiptJson as CanonicalGatewayPitReceiptV1;
}

async function readGatewayReceipt(
  ex: Pick<RepositoryExecutor, "select">,
  organizationId: string,
  id: string,
): Promise<CanonicalGatewayPitReceiptV1 | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderMiGatewayPitReceiptV1)
    .where(
      and(
        eq(pgSchema.traderMiGatewayPitReceiptV1.id, id),
        eq(pgSchema.traderMiGatewayPitReceiptV1.organizationId, organizationId),
      ),
    )
    .limit(1);
  return rows[0] ? mapGatewayReceipt(rows[0]) : null;
}

async function persistGatewayReceipt(
  ex: Pick<RepositoryExecutor, "select" | "insert">,
  receipt: CanonicalGatewayPitReceiptV1,
): Promise<{ receipt: CanonicalGatewayPitReceiptV1; insertedNew: boolean }> {
  const actualKeys = Object.keys(receipt).sort();
  const rebuilt = buildCanonicalGatewayPitReceiptV1({
    organizationId: receipt.organizationId,
    providerId: receipt.providerId,
    gatewayKind: receipt.gatewayKind,
    status: receipt.status,
    reason: receipt.reason,
    sourceId: receipt.sourceId,
    trustAsOfReceiptId: receipt.trustAsOfReceiptId,
    observationId: receipt.observationId,
    observationContentDigest: receipt.observationContentDigest,
    normalizedInputDigest: receipt.normalizedInputDigest,
  });
  if (
    canonicalJsonString(actualKeys) !==
      canonicalJsonString(CANONICAL_GATEWAY_RECEIPT_KEYS) ||
    !CANONICAL_UUID.test(receipt.organizationId) ||
    (receipt.sourceId !== null && !CANONICAL_UUID.test(receipt.sourceId)) ||
    (receipt.observationId !== null && !CANONICAL_UUID.test(receipt.observationId)) ||
    canonicalJsonString(rebuilt) !== canonicalJsonString(receipt)
  ) {
    throw new Error("CANONICAL_GATEWAY_RECEIPT_ROW_PROJECTION_REFUSED");
  }

  // Build the durable JSON from the same typed scalar values as the guarded
  // row. PostgreSQL therefore sees one canonical UUID/text projection on both
  // sides of the immutable 0161 row/JSON equality check, independent of a
  // driver's object/JSON codec state.
  const receiptJson = sql`jsonb_build_object(
    'id', ${receipt.id}::text,
    'schemaVersion', ${receipt.schemaVersion}::text,
    'organizationId', ${receipt.organizationId}::uuid::text,
    'providerId', ${receipt.providerId}::text,
    'gatewayKind', ${receipt.gatewayKind}::text,
    'status', ${receipt.status}::text,
    'reason', ${receipt.reason}::text,
    'sourceId', CASE WHEN ${receipt.sourceId}::text IS NULL THEN NULL
      ELSE to_jsonb(${receipt.sourceId}::uuid::text) END,
    'trustAsOfReceiptId', ${receipt.trustAsOfReceiptId}::text,
    'observationId', CASE WHEN ${receipt.observationId}::text IS NULL THEN NULL
      ELSE to_jsonb(${receipt.observationId}::uuid::text) END,
    'observationContentDigest', ${receipt.observationContentDigest}::text,
    'normalizedInputDigest', ${receipt.normalizedInputDigest}::text,
    'contentDigest', ${receipt.contentDigest}::text
  )`;
  const inserted = await ex
    .insert(pgSchema.traderMiGatewayPitReceiptV1)
    .values({
      id: receipt.id,
      organizationId: receipt.organizationId,
      providerId: receipt.providerId,
      gatewayKind: receipt.gatewayKind,
      status: receipt.status,
      reason: receipt.reason,
      sourceId: receipt.sourceId,
      trustAsOfReceiptId: receipt.trustAsOfReceiptId,
      observationId: receipt.observationId,
      observationContentDigest: receipt.observationContentDigest,
      normalizedInputDigest: receipt.normalizedInputDigest,
      receiptJson,
      contentDigest: receipt.contentDigest,
      schemaVersion: receipt.schemaVersion,
    })
    .onConflictDoNothing({ target: pgSchema.traderMiGatewayPitReceiptV1.id })
    .returning({ id: pgSchema.traderMiGatewayPitReceiptV1.id });
  const stored = await readGatewayReceipt(ex, receipt.organizationId, receipt.id);
  if (!stored || canonicalJsonString(stored) !== canonicalJsonString(receipt)) {
    throw new Error("CANONICAL_GATEWAY_RECEIPT_CONFLICT");
  }
  return { receipt: stored, insertedNew: inserted.length === 1 };
}

export function buildCanonicalGatewayPitReceiptV1(input: {
  organizationId: string;
  providerId: string;
  gatewayKind: string;
  status: CanonicalGatewayAvailabilityV1;
  reason: CanonicalGatewayRejectionReasonV1 | null;
  sourceId: string | null;
  trustAsOfReceiptId: string | null;
  observationId: string | null;
  observationContentDigest: string | null;
  normalizedInputDigest: string;
}): CanonicalGatewayPitReceiptV1 {
  requireNonEmpty(input.organizationId, "organizationId");
  requireNonEmpty(input.providerId, "providerId");
  requireNonEmpty(input.gatewayKind, "gatewayKind");
  requireDigest(input.normalizedInputDigest, "normalizedInputDigest");
  if (!CANONICAL_UUID.test(input.organizationId) ||
      (input.sourceId !== null && !CANONICAL_UUID.test(input.sourceId)) ||
      (input.observationId !== null && !CANONICAL_UUID.test(input.observationId))) {
    throw new Error("CANONICAL_GATEWAY_RECEIPT_INVALID:UUID");
  }
  if (input.status === "AVAILABLE") {
    if (
      input.reason !== null ||
      !input.sourceId ||
      !input.trustAsOfReceiptId ||
      !input.observationId ||
      !input.observationContentDigest
    ) {
      throw new Error("CANONICAL_GATEWAY_RECEIPT_INVALID:AVAILABLE");
    }
    requireDigest(input.trustAsOfReceiptId, "trustAsOfReceiptId");
    requireDigest(input.observationContentDigest, "observationContentDigest");
  } else if (
    !input.reason ||
    input.observationId !== null ||
    input.observationContentDigest !== null
  ) {
    throw new Error(`CANONICAL_GATEWAY_RECEIPT_INVALID:${input.status}`);
  }
  const body = {
    schemaVersion: CANONICAL_GATEWAY_RECEIPT_SCHEMA_VERSION,
    organizationId: input.organizationId,
    providerId: input.providerId,
    gatewayKind: input.gatewayKind,
    status: input.status,
    reason: input.reason,
    sourceId: input.sourceId,
    trustAsOfReceiptId: input.trustAsOfReceiptId,
    observationId: input.observationId,
    observationContentDigest: input.observationContentDigest,
    normalizedInputDigest: input.normalizedInputDigest,
  };
  const contentDigest = sha256Canonical(body);
  return { ...body, id: contentDigest, contentDigest };
}

export async function persistCanonicalGatewayOutcomeV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: Omit<Parameters<typeof buildCanonicalGatewayPitReceiptV1>[0], "organizationId">,
): Promise<{ receipt: CanonicalGatewayPitReceiptV1; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  if (input.status === "AVAILABLE") {
    throw new Error("CANONICAL_GATEWAY_AVAILABLE_REQUIRES_OBSERVATION");
  }
  const receipt = buildCanonicalGatewayPitReceiptV1({
    ...input,
    organizationId: scoped.organizationId,
  });
  return runWaiaPostgresTransaction(db, (tx) => persistGatewayReceipt(tx, receipt));
}

async function persistCanonicalObservation(
  ex: CanonicalWriteExecutor,
  organizationId: string,
  input: CanonicalAvailableObservationInputV1,
): Promise<{ observation: CanonicalPitObservationRecordV1; insertedNew: boolean }> {
  requireNonEmpty(input.sourceId, "sourceId");
  requireNonEmpty(input.subjectRef, "subjectRef");
  requireNonEmpty(input.canonicalProviderId, "canonicalProviderId");
  requireDigest(input.trustAsOfReceiptId, "trustAsOfReceiptId");
  requireDigest(input.normalizedInputDigest, "normalizedInputDigest");
  requireIsoDate(input.eventTime, "eventTime");
  requireIsoDate(input.availableAt, "availableAt");
  requireIsoDate(input.ingestTime, "ingestTime");

  await ex.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${input.sourceId}:${input.observationKind}:${input.subjectRef}:${input.eventTime.toISOString()}`}, 0))`,
  );

  const trustRows = await ex
    .select()
    .from(pgSchema.traderMiTrustAsOfReceiptV1)
    .where(
      and(
        eq(pgSchema.traderMiTrustAsOfReceiptV1.id, input.trustAsOfReceiptId),
        eq(pgSchema.traderMiTrustAsOfReceiptV1.organizationId, organizationId),
        eq(pgSchema.traderMiTrustAsOfReceiptV1.sourceId, input.sourceId),
      ),
    )
    .limit(1);
  const trust = trustRows[0];
  if (
    !trust ||
    trust.status !== "RESOLVED" ||
    !trust.selectedTrustRevisionId ||
    !trust.selectedContentDigest ||
    trust.anchorTime.getTime() !== input.availableAt.getTime()
  ) {
    throw new Error("CANONICAL_PIT_TRUST_AS_OF_UNKNOWN");
  }

  const observationKey = sha256Canonical({
    organizationId,
    sourceId: input.sourceId,
    observationKind: input.observationKind,
    subjectRef: input.subjectRef,
    eventTimeUtc: input.eventTime.toISOString(),
  });
  const priorRows = await ex
    .select()
    .from(pgSchema.traderMiObservation)
    .where(
      and(
        eq(pgSchema.traderMiObservation.organizationId, organizationId),
        eq(pgSchema.traderMiObservation.observationKey, observationKey),
      ),
    )
    .orderBy(desc(pgSchema.traderMiObservation.revisionSeq));
  const latest = priorRows[0];
  if (latest?.normalizedInputDigest === input.normalizedInputDigest) {
    return { observation: mapCanonicalObservation(latest), insertedNew: false };
  }

  const revisionSeq = (latest?.revisionSeq ?? 0) + 1;
  const revisionOf = latest?.id ?? null;
  const payloadJson = canonicalJsonString(input.payloadCanonical);
  const contentDigest = sha256Canonical({
    schemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    organizationId,
    sourceId: input.sourceId,
    observationKey,
    observationKind: input.observationKind,
    subjectRef: input.subjectRef,
    eventTimeUtc: input.eventTime.toISOString(),
    availableAtUtc: input.availableAt.toISOString(),
    ingestTimeUtc: input.ingestTime.toISOString(),
    canonicalProviderId: input.canonicalProviderId,
    trustAsOfReceiptId: input.trustAsOfReceiptId,
    sourceTrustRevisionId: trust.selectedTrustRevisionId,
    sourceTrustContentDigest: trust.selectedContentDigest,
    normalizedInputDigest: input.normalizedInputDigest,
    payloadCanonical: input.payloadCanonical,
    revisionOf,
    revisionSeq,
  });
  const id = deterministicUuidFromDigest(contentDigest);
  const insertedRows = await ex
    .insert(pgSchema.traderMiObservation)
    .values({
      id,
      organizationId,
      sourceId: input.sourceId,
      observationKind: input.observationKind,
      observationKey,
      subjectRef: input.subjectRef,
      schemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
      payloadJson,
      eventTime: input.eventTime,
      availableAt: input.availableAt,
      ingestTime: input.ingestTime,
      canonicalProviderId: input.canonicalProviderId,
      trustAsOfReceiptId: input.trustAsOfReceiptId,
      sourceTrustRevisionId: trust.selectedTrustRevisionId,
      sourceTrustContentDigest: trust.selectedContentDigest,
      normalizedInputDigest: input.normalizedInputDigest,
      observedBy: "canonical-gateway-pit-v1",
      revisionOf,
      revisionSeq,
      contentDigest,
    })
    .returning();
  if (!insertedRows[0]) throw new Error("CANONICAL_PIT_OBSERVATION_INSERT_FAILED");
  return { observation: mapCanonicalObservation(insertedRows[0]), insertedNew: true };
}

export async function persistCanonicalAvailableGatewayV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: CanonicalAvailableObservationInputV1,
): Promise<{
  observation: CanonicalPitObservationRecordV1;
  observationInsertedNew: boolean;
  receipt: CanonicalGatewayPitReceiptV1;
  receiptInsertedNew: boolean;
}> {
  const scoped = requireOrgContext(context.organizationId);
  return runWaiaPostgresTransaction(db, (tx) =>
    persistCanonicalAvailableGatewayWithinTransactionV1Postgres(tx, scoped, input));
}

/**
 * Same canonical observation/receipt persistence contract for callers that
 * already hold the authoritative PostgreSQL transaction. It deliberately does
 * not open a nested transaction, so advisory locks and all durable authority
 * writes remain on the caller's one backend and commit atomically.
 */
export async function persistCanonicalAvailableGatewayWithinTransactionV1Postgres(
  ex: CanonicalWriteExecutor,
  context: OrgContext,
  input: CanonicalAvailableObservationInputV1,
): Promise<{
  observation: CanonicalPitObservationRecordV1;
  observationInsertedNew: boolean;
  receipt: CanonicalGatewayPitReceiptV1;
  receiptInsertedNew: boolean;
}> {
  const scoped = requireOrgContext(context.organizationId);
  const stored = await persistCanonicalObservation(ex, scoped.organizationId, input);
  const receipt = buildCanonicalGatewayPitReceiptV1({
    organizationId: scoped.organizationId,
    providerId: input.canonicalProviderId,
    gatewayKind: input.observationKind,
    status: "AVAILABLE",
    reason: null,
    sourceId: input.sourceId,
    trustAsOfReceiptId: input.trustAsOfReceiptId,
    observationId: stored.observation.id,
    observationContentDigest: stored.observation.contentDigest,
    normalizedInputDigest: input.normalizedInputDigest,
  });
  const storedReceipt = await persistGatewayReceipt(ex, receipt);
  return {
    observation: stored.observation,
    observationInsertedNew: stored.insertedNew,
    receipt: storedReceipt.receipt,
    receiptInsertedNew: storedReceipt.insertedNew,
  };
}

export async function persistCanonicalMeasurementDefinitionV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  definition: CanonicalMeasurementDefinitionV1,
): Promise<{ definition: CanonicalMeasurementDefinitionV1; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  if (definition.organizationId !== scoped.organizationId) {
    throw new Error("CANONICAL_MEASUREMENT_SCOPE_MISMATCH");
  }
  assertCanonicalMeasurementDefinitionV1(definition);
  return runWaiaPostgresTransaction(db, async (tx) => {
    const inserted = await tx
      .insert(pgSchema.traderMiCanonicalMeasurementDefinitionV1)
      .values({
        id: definition.id,
        organizationId: scoped.organizationId,
        category: definition.category,
        name: definition.name,
        inputContractsJson: definition.inputContracts,
        outputSchemaVersion: definition.outputSchemaVersion,
        authority: definition.authority,
        definitionJson: definition,
        contentDigest: definition.contentDigest,
        schemaVersion: definition.schemaVersion,
      })
      .onConflictDoNothing({ target: pgSchema.traderMiCanonicalMeasurementDefinitionV1.id })
      .returning({ id: pgSchema.traderMiCanonicalMeasurementDefinitionV1.id });
    const rows = await tx
      .select()
      .from(pgSchema.traderMiCanonicalMeasurementDefinitionV1)
      .where(
        and(
          eq(pgSchema.traderMiCanonicalMeasurementDefinitionV1.id, definition.id),
          eq(pgSchema.traderMiCanonicalMeasurementDefinitionV1.organizationId, scoped.organizationId),
        ),
      )
      .limit(1);
    const stored = rows[0]?.definitionJson as CanonicalMeasurementDefinitionV1 | undefined;
    if (!stored || canonicalJsonString(stored) !== canonicalJsonString(definition)) {
      throw new Error("CANONICAL_MEASUREMENT_DEFINITION_CONFLICT");
    }
    return { definition: stored, insertedNew: inserted.length === 1 };
  });
}

export async function persistCanonicalMeasurementValueLineageV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  value: CanonicalMeasurementValueLineageV1,
): Promise<{ value: CanonicalMeasurementValueLineageV1; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  if (value.organizationId !== scoped.organizationId) {
    throw new Error("CANONICAL_MEASUREMENT_SCOPE_MISMATCH");
  }
  return runWaiaPostgresTransaction(db, async (tx) => {
    const definitionRows = await tx
      .select({
        definitionJson: pgSchema.traderMiCanonicalMeasurementDefinitionV1.definitionJson,
      })
      .from(pgSchema.traderMiCanonicalMeasurementDefinitionV1)
      .where(
        and(
          eq(pgSchema.traderMiCanonicalMeasurementDefinitionV1.id, value.definitionId),
          eq(
            pgSchema.traderMiCanonicalMeasurementDefinitionV1.organizationId,
            scoped.organizationId,
          ),
          eq(
            pgSchema.traderMiCanonicalMeasurementDefinitionV1.contentDigest,
            value.definitionContentDigest,
          ),
        ),
      )
      .limit(1);
    const definition = definitionRows[0]?.definitionJson as
      | CanonicalMeasurementDefinitionV1
      | undefined;
    if (!definition) {
      throw new Error("CANONICAL_MEASUREMENT_DEFINITION_NOT_FOUND");
    }
    assertCanonicalMeasurementDefinitionV1(definition);
    assertCanonicalMeasurementValueLineageV1(value, definition);

    const existing = await tx
      .select()
      .from(pgSchema.traderMiCanonicalMeasurementValueV1)
      .where(
        and(
          eq(pgSchema.traderMiCanonicalMeasurementValueV1.id, value.id),
          eq(pgSchema.traderMiCanonicalMeasurementValueV1.organizationId, scoped.organizationId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const stored = {
        id: existing[0].id,
        schemaVersion: existing[0].schemaVersion,
        organizationId: existing[0].organizationId,
        definitionId: existing[0].definitionId,
        definitionContentDigest: existing[0].definitionContentDigest,
        outputContentDigest: existing[0].outputContentDigest,
        inputs: existing[0].inputLineageJson,
        authority: existing[0].authority,
        contentDigest: existing[0].contentDigest,
      } as CanonicalMeasurementValueLineageV1;
      if (canonicalJsonString(stored) !== canonicalJsonString(value)) {
        throw new Error("CANONICAL_MEASUREMENT_VALUE_CONFLICT");
      }
      return { value: stored, insertedNew: false };
    }

    await tx.insert(pgSchema.traderMiCanonicalMeasurementValueV1).values({
      id: value.id,
      organizationId: scoped.organizationId,
      definitionId: value.definitionId,
      definitionContentDigest: value.definitionContentDigest,
      outputContentDigest: value.outputContentDigest,
      inputCount: value.inputs.length,
      inputLineageJson: value.inputs,
      authority: value.authority,
      contentDigest: value.contentDigest,
      schemaVersion: value.schemaVersion,
    });
    await tx.insert(pgSchema.traderMiCanonicalMeasurementValueInputV1).values(
      value.inputs.map((input, inputOrdinal) => ({
        organizationId: scoped.organizationId,
        measurementValueId: value.id,
        inputOrdinal,
        observationId: input.observationId,
        observationKind: input.observationKind,
        observationSchemaVersion: input.observationSchemaVersion,
        observationContentDigest: input.observationContentDigest,
        sourceId: input.sourceId,
        trustAsOfReceiptId: input.trustAsOfReceiptId,
        trustRevisionId: input.trustRevisionId,
        trustRevisionContentDigest: input.trustRevisionContentDigest,
      })),
    );
    return { value, insertedNew: true };
  });
}

export async function listCanonicalGatewayReceiptsV1Postgres(
  db: Pick<WaiaPostgresDb, "select">,
  context: OrgContext,
): Promise<CanonicalGatewayPitReceiptV1[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await db
    .select()
    .from(pgSchema.traderMiGatewayPitReceiptV1)
    .where(eq(pgSchema.traderMiGatewayPitReceiptV1.organizationId, scoped.organizationId))
    .orderBy(pgSchema.traderMiGatewayPitReceiptV1.createdAt, pgSchema.traderMiGatewayPitReceiptV1.id);
  return rows.map(mapGatewayReceipt);
}
