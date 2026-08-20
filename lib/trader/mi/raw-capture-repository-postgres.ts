import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import {
  buildRawCaptureReceiptAtDurableBoundaryV1,
  buildRawValidationReceiptAtDurableBoundaryV1,
  isRawCaptureReceiptV1,
  isRawStorageBindingV1,
  isRawValidationReceiptV1,
  serializeRawCaptureReceiptV1,
  serializeRawStorageBindingV1,
  serializeRawValidationReceiptV1,
  type PreparedRawCaptureV1,
  type RawCaptureReceiptV1,
  type RawStorageBindingV1,
  type RawValidationOutcomeV1,
  type RawValidationReceiptV1,
} from "@/lib/trader/mi/raw-capture-v1";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgRawExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;
type BindingRow = typeof pgSchema.traderMiRawStorageBindingV1.$inferSelect;
type CaptureRow = typeof pgSchema.traderMiRawCaptureReceiptV1.$inferSelect;
type ValidationRow = typeof pgSchema.traderMiRawValidationReceiptV1.$inferSelect;

export class RawCapturePersistenceConflictError extends Error {
  constructor() {
    super("[trader] raw capture append-only persistence conflict");
    this.name = "RawCapturePersistenceConflictError";
  }
}

export class RawCaptureSourceNotFoundError extends Error {
  constructor() {
    super("[trader] raw capture source not found in organization scope");
    this.name = "RawCaptureSourceNotFoundError";
  }
}

function parseBinding(row: BindingRow): RawStorageBindingV1 {
  let parsed: RawStorageBindingV1;
  try { parsed = JSON.parse(row.bindingJson) as RawStorageBindingV1; } catch {
    throw new RawCapturePersistenceConflictError();
  }
  if (
    parsed.id !== row.id || parsed.organizationId !== row.organizationId ||
    parsed.sourceId !== row.sourceId || parsed.rawBytesDigest !== row.rawBytesDigest ||
    parsed.objectReference.storageBackendId !== row.storageBackendId ||
    parsed.objectReference.objectKey !== row.objectKey ||
    parsed.objectReference.objectVersion !== row.objectVersion ||
    parsed.objectReference.encryptionRequirement !== row.encryptionRequirement ||
    parsed.objectReference.accessRequirement !== row.accessRequirement ||
    parsed.storedAtUtc !== row.storedAt.toISOString() ||
    parsed.contentDigest !== row.contentDigest || parsed.schemaVersion !== row.schemaVersion ||
    !isRawStorageBindingV1(parsed) || serializeRawStorageBindingV1(parsed) !== row.bindingJson
  ) throw new RawCapturePersistenceConflictError();
  return parsed;
}

function parseCapture(row: CaptureRow): RawCaptureReceiptV1 {
  let parsed: RawCaptureReceiptV1;
  try { parsed = JSON.parse(row.receiptJson) as RawCaptureReceiptV1; } catch {
    throw new RawCapturePersistenceConflictError();
  }
  if (
    parsed.id !== row.id || parsed.organizationId !== row.organizationId ||
    parsed.sourceId !== row.sourceId || parsed.rawBytesDigest !== row.rawBytesDigest ||
    parsed.payloadBytes !== row.payloadBytes ||
    parsed.policy.maxPayloadBytes !== row.maxPayloadBytes ||
    parsed.policy.retentionSeconds !== row.retentionSeconds ||
    parsed.policyDigest !== row.policyDigest ||
    parsed.secretScanReceiptDigest !== row.secretScanReceiptDigest ||
    parsed.storageBindingDigest !== row.storageBindingDigest ||
    parsed.capturedAtUtc !== row.capturedAt.toISOString() ||
    parsed.retentionUntilUtc !== row.retentionUntil.toISOString() ||
    parsed.authority !== row.authority || parsed.contentDigest !== row.contentDigest ||
    parsed.schemaVersion !== row.schemaVersion || !isRawCaptureReceiptV1(parsed) ||
    serializeRawCaptureReceiptV1(parsed) !== row.receiptJson
  ) throw new RawCapturePersistenceConflictError();
  return parsed;
}

function parseValidation(row: ValidationRow): RawValidationReceiptV1 {
  let parsed: RawValidationReceiptV1;
  try { parsed = JSON.parse(row.receiptJson) as RawValidationReceiptV1; } catch {
    throw new RawCapturePersistenceConflictError();
  }
  if (
    parsed.id !== row.id || parsed.organizationId !== row.organizationId ||
    parsed.sourceId !== row.sourceId || parsed.captureReceiptDigest !== row.captureReceiptDigest ||
    parsed.validatorId !== row.validatorId || parsed.validatorVersion !== row.validatorVersion ||
    parsed.status !== row.status || canonicalJsonString(parsed.reasonCodes) !== row.reasonCodesJson ||
    parsed.knownAtUtc !== row.knownAt.toISOString() || parsed.authority !== row.authority ||
    parsed.observationAuthority !== row.observationAuthority ||
    parsed.measurementAuthority !== row.measurementAuthority ||
    parsed.contentDigest !== row.contentDigest || parsed.schemaVersion !== row.schemaVersion ||
    !isRawValidationReceiptV1(parsed) || serializeRawValidationReceiptV1(parsed) !== row.receiptJson
  ) throw new RawCapturePersistenceConflictError();
  return parsed;
}

async function durableTransactionTime(ex: PgRawExecutor): Promise<Date> {
  const rows = await ex.execute<{ durable_at: Date | string }>(
    sql`select date_trunc('milliseconds', transaction_timestamp()) as durable_at`,
  );
  const value = new Date(rows[0]!.durable_at);
  if (!Number.isFinite(value.getTime())) throw new RawCapturePersistenceConflictError();
  return value;
}

async function requireScopedSource(ex: PgRawExecutor, context: OrgContext, sourceId: string) {
  const rows = await ex.select({ id: pgSchema.traderMiSource.id })
    .from(pgSchema.traderMiSource)
    .where(and(
      eq(pgSchema.traderMiSource.id, sourceId),
      orgScopedWhere(pgSchema.traderMiSource.organizationId, context),
    )).limit(1);
  if (!rows[0]) throw new RawCaptureSourceNotFoundError();
}

async function readBinding(
  ex: PgRawExecutor,
  context: OrgContext,
  digest: string,
): Promise<RawStorageBindingV1 | null> {
  const rows = await ex.select().from(pgSchema.traderMiRawStorageBindingV1).where(and(
    eq(pgSchema.traderMiRawStorageBindingV1.id, digest),
    orgScopedWhere(pgSchema.traderMiRawStorageBindingV1.organizationId, context),
  )).limit(1);
  return rows[0] ? parseBinding(rows[0]) : null;
}

export async function readRawCaptureReceiptV1Postgres(
  ex: PgRawExecutor,
  context: OrgContext,
  digest: string,
): Promise<RawCaptureReceiptV1 | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex.select().from(pgSchema.traderMiRawCaptureReceiptV1).where(and(
    eq(pgSchema.traderMiRawCaptureReceiptV1.id, digest),
    orgScopedWhere(pgSchema.traderMiRawCaptureReceiptV1.organizationId, scoped),
  )).limit(1);
  return rows[0] ? parseCapture(rows[0]) : null;
}

async function readCaptureByBinding(
  ex: PgRawExecutor,
  context: OrgContext,
  bindingDigest: string,
): Promise<RawCaptureReceiptV1 | null> {
  const rows = await ex.select().from(pgSchema.traderMiRawCaptureReceiptV1).where(and(
    eq(pgSchema.traderMiRawCaptureReceiptV1.storageBindingDigest, bindingDigest),
    orgScopedWhere(pgSchema.traderMiRawCaptureReceiptV1.organizationId, context),
  )).limit(1);
  return rows[0] ? parseCapture(rows[0]) : null;
}

function requireCaptureMatchesPrepared(
  receipt: RawCaptureReceiptV1,
  prepared: PreparedRawCaptureV1,
  binding: RawStorageBindingV1,
) {
  const expectedRetention = new Date(receipt.capturedAtUtc).getTime() +
    prepared.policy.retentionSeconds * 1_000;
  if (
    receipt.organizationId !== prepared.organizationId || receipt.sourceId !== prepared.sourceId ||
    receipt.rawBytesDigest !== prepared.rawBytesDigest || receipt.payloadBytes !== prepared.payloadBytes ||
    receipt.policyDigest !== prepared.policy.policyDigest ||
    receipt.secretScanReceiptDigest !== prepared.secretScanReceipt.contentDigest ||
    receipt.storageBindingDigest !== binding.contentDigest ||
    new Date(receipt.retentionUntilUtc).getTime() !== expectedRetention
  ) throw new RawCapturePersistenceConflictError();
}

async function persistBinding(
  ex: PgRawExecutor,
  context: OrgContext,
  binding: RawStorageBindingV1,
): Promise<void> {
  const existing = await readBinding(ex, context, binding.contentDigest);
  if (existing) {
    if (serializeRawStorageBindingV1(existing) !== serializeRawStorageBindingV1(binding)) {
      throw new RawCapturePersistenceConflictError();
    }
    return;
  }
  await ex.insert(pgSchema.traderMiRawStorageBindingV1).values({
    id: binding.id,
    organizationId: context.organizationId,
    sourceId: binding.sourceId,
    rawBytesDigest: binding.rawBytesDigest,
    storageBackendId: binding.objectReference.storageBackendId,
    objectKey: binding.objectReference.objectKey,
    objectVersion: binding.objectReference.objectVersion,
    encryptionRequirement: binding.objectReference.encryptionRequirement,
    accessRequirement: binding.objectReference.accessRequirement,
    storedAt: new Date(binding.storedAtUtc),
    bindingJson: serializeRawStorageBindingV1(binding),
    contentDigest: binding.contentDigest,
    schemaVersion: binding.schemaVersion,
  }).onConflictDoNothing();
  const stored = await readBinding(ex, context, binding.contentDigest);
  if (!stored || serializeRawStorageBindingV1(stored) !== serializeRawStorageBindingV1(binding)) {
    throw new RawCapturePersistenceConflictError();
  }
}

/** Persists references/receipts only. The transient prepared body is never inserted. */
export async function persistPreparedRawCaptureV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: { prepared: PreparedRawCaptureV1; storageBinding: RawStorageBindingV1 },
): Promise<{ receipt: RawCaptureReceiptV1; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  if (
    input.prepared.organizationId !== scoped.organizationId ||
    input.storageBinding.organizationId !== scoped.organizationId ||
    input.storageBinding.sourceId !== input.prepared.sourceId ||
    input.storageBinding.rawBytesDigest !== input.prepared.rawBytesDigest ||
    !isRawStorageBindingV1(input.storageBinding)
  ) throw new RawCapturePersistenceConflictError();

  return runWaiaPostgresTransaction(db, async (tx) => {
    await requireScopedSource(tx, scoped, input.prepared.sourceId);
    await persistBinding(tx, scoped, input.storageBinding);
    const existing = await readCaptureByBinding(tx, scoped, input.storageBinding.contentDigest);
    if (existing) {
      requireCaptureMatchesPrepared(existing, input.prepared, input.storageBinding);
      return { receipt: existing, insertedNew: false };
    }

    const receipt = buildRawCaptureReceiptAtDurableBoundaryV1({
      prepared: input.prepared,
      storageBinding: input.storageBinding,
      capturedAt: await durableTransactionTime(tx),
    });
    const inserted = await tx.insert(pgSchema.traderMiRawCaptureReceiptV1).values({
      id: receipt.id,
      organizationId: scoped.organizationId,
      sourceId: receipt.sourceId,
      rawBytesDigest: receipt.rawBytesDigest,
      payloadBytes: receipt.payloadBytes,
      maxPayloadBytes: receipt.policy.maxPayloadBytes,
      retentionSeconds: receipt.policy.retentionSeconds,
      policyDigest: receipt.policyDigest,
      secretScanReceiptDigest: receipt.secretScanReceiptDigest,
      storageBindingDigest: receipt.storageBindingDigest,
      capturedAt: new Date(receipt.capturedAtUtc),
      retentionUntil: new Date(receipt.retentionUntilUtc),
      authority: receipt.authority,
      receiptJson: serializeRawCaptureReceiptV1(receipt),
      contentDigest: receipt.contentDigest,
      schemaVersion: receipt.schemaVersion,
    }).onConflictDoNothing().returning({ id: pgSchema.traderMiRawCaptureReceiptV1.id });
    const stored = await readCaptureByBinding(tx, scoped, input.storageBinding.contentDigest);
    if (!stored) throw new RawCapturePersistenceConflictError();
    requireCaptureMatchesPrepared(stored, input.prepared, input.storageBinding);
    return { receipt: stored, insertedNew: inserted.length === 1 };
  });
}

async function readValidationByKey(
  ex: PgRawExecutor,
  context: OrgContext,
  input: { captureReceiptDigest: string; validatorId: string; validatorVersion: string },
): Promise<RawValidationReceiptV1 | null> {
  const rows = await ex.select().from(pgSchema.traderMiRawValidationReceiptV1).where(and(
    eq(pgSchema.traderMiRawValidationReceiptV1.captureReceiptDigest, input.captureReceiptDigest),
    eq(pgSchema.traderMiRawValidationReceiptV1.validatorId, input.validatorId),
    eq(pgSchema.traderMiRawValidationReceiptV1.validatorVersion, input.validatorVersion),
    orgScopedWhere(pgSchema.traderMiRawValidationReceiptV1.organizationId, context),
  )).limit(1);
  return rows[0] ? parseValidation(rows[0]) : null;
}

function requireValidationMatches(
  receipt: RawValidationReceiptV1,
  capture: RawCaptureReceiptV1,
  input: { validatorId: string; validatorVersion: string; outcome: RawValidationOutcomeV1 },
) {
  const expected = buildRawValidationReceiptAtDurableBoundaryV1({
    captureReceipt: capture,
    validatorId: input.validatorId,
    validatorVersion: input.validatorVersion,
    outcome: input.outcome,
    knownAt: new Date(receipt.knownAtUtc),
  });
  if (serializeRawValidationReceiptV1(expected) !== serializeRawValidationReceiptV1(receipt)) {
    throw new RawCapturePersistenceConflictError();
  }
}

/** `knownAt` is deliberately absent from caller input and authored inside this transaction. */
export async function recordRawValidationV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: {
    captureReceiptDigest: string;
    validatorId: string;
    validatorVersion: string;
    outcome: RawValidationOutcomeV1;
  },
): Promise<{ receipt: RawValidationReceiptV1; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  return runWaiaPostgresTransaction(db, async (tx) => {
    const capture = await readRawCaptureReceiptV1Postgres(
      tx, scoped, input.captureReceiptDigest,
    );
    if (!capture) throw new RawCapturePersistenceConflictError();
    const existing = await readValidationByKey(tx, scoped, input);
    if (existing) {
      requireValidationMatches(existing, capture, input);
      return { receipt: existing, insertedNew: false };
    }
    const receipt = buildRawValidationReceiptAtDurableBoundaryV1({
      captureReceipt: capture,
      validatorId: input.validatorId,
      validatorVersion: input.validatorVersion,
      outcome: input.outcome,
      knownAt: await durableTransactionTime(tx),
    });
    const inserted = await tx.insert(pgSchema.traderMiRawValidationReceiptV1).values({
      id: receipt.id,
      organizationId: scoped.organizationId,
      sourceId: receipt.sourceId,
      captureReceiptDigest: receipt.captureReceiptDigest,
      validatorId: receipt.validatorId,
      validatorVersion: receipt.validatorVersion,
      status: receipt.status,
      reasonCodesJson: canonicalJsonString(receipt.reasonCodes),
      knownAt: new Date(receipt.knownAtUtc),
      authority: receipt.authority,
      observationAuthority: receipt.observationAuthority,
      measurementAuthority: receipt.measurementAuthority,
      receiptJson: serializeRawValidationReceiptV1(receipt),
      contentDigest: receipt.contentDigest,
      schemaVersion: receipt.schemaVersion,
    }).onConflictDoNothing().returning({ id: pgSchema.traderMiRawValidationReceiptV1.id });
    const stored = await readValidationByKey(tx, scoped, input);
    if (!stored) throw new RawCapturePersistenceConflictError();
    requireValidationMatches(stored, capture, input);
    return { receipt: stored, insertedNew: inserted.length === 1 };
  });
}
