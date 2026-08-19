import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { pitChronologyV1 } from "@/lib/trader/mi/pit-chronology-v1";
import {
  isTrustAsOfReceiptV1ContentAddressed,
  resolveTrustAsOfV1,
  serializeTrustAsOfReceiptV1,
  type TrustAsOfReceiptV1,
  type TrustAsOfRevisionV1,
} from "@/lib/trader/mi/trust-as-of-v1";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgTrustAsOfExecutor = Pick<WaiaPostgresDb, "select" | "insert">;
type PersistedReceiptRow = typeof pgSchema.traderMiTrustAsOfReceiptV1.$inferSelect;

export class TrustAsOfSourceNotFoundError extends Error {
  constructor() {
    super("[trader] MI trust-as-of source not found in organization scope");
    this.name = "TrustAsOfSourceNotFoundError";
  }
}

export class TrustAsOfReceiptConflictError extends Error {
  constructor() {
    super("[trader] MI trust-as-of content-addressed receipt conflict");
    this.name = "TrustAsOfReceiptConflictError";
  }
}

function parsePersistedReceipt(row: PersistedReceiptRow): TrustAsOfReceiptV1 {
  let parsed: TrustAsOfReceiptV1;
  try {
    parsed = JSON.parse(row.receiptJson) as TrustAsOfReceiptV1;
  } catch { throw new TrustAsOfReceiptConflictError(); }
  if (
    parsed.id !== row.id ||
    parsed.contentDigest !== row.contentDigest ||
    parsed.organizationId !== row.organizationId ||
    parsed.sourceId !== row.sourceId ||
    parsed.anchorTimeUtc !== row.anchorTime.toISOString() ||
    parsed.status !== row.status ||
    parsed.unknownReason !== row.unknownReason ||
    parsed.selectedTrustRevisionId !== row.selectedTrustRevisionId ||
    parsed.selectedRevisionSeq !== row.selectedRevisionSeq ||
    parsed.selectedContentDigest !== row.selectedContentDigest ||
    parsed.selectedTrustScore !== row.selectedTrustScore ||
    parsed.visiblePrefixDigest !== row.visiblePrefixDigest ||
    parsed.schemaVersion !== row.schemaVersion ||
    !isTrustAsOfReceiptV1ContentAddressed(parsed) ||
    serializeTrustAsOfReceiptV1(parsed) !== row.receiptJson
  ) {
    throw new TrustAsOfReceiptConflictError();
  }
  return parsed;
}

export async function readTrustAsOfReceiptV1Postgres(
  ex: PgTrustAsOfExecutor,
  context: OrgContext,
  contentDigest: string,
): Promise<TrustAsOfReceiptV1 | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrustAsOfReceiptV1)
    .where(
      and(
        eq(pgSchema.traderMiTrustAsOfReceiptV1.contentDigest, contentDigest),
        orgScopedWhere(pgSchema.traderMiTrustAsOfReceiptV1.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? parsePersistedReceipt(rows[0]) : null;
}

async function requireScopedSource(
  ex: PgTrustAsOfExecutor,
  context: OrgContext,
  sourceId: string,
): Promise<void> {
  const rows = await ex
    .select({ id: pgSchema.traderMiSource.id })
    .from(pgSchema.traderMiSource)
    .where(
      and(
        eq(pgSchema.traderMiSource.id, sourceId),
        orgScopedWhere(pgSchema.traderMiSource.organizationId, context),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new TrustAsOfSourceNotFoundError();
}

async function listScopedTrustHistory(
  ex: PgTrustAsOfExecutor,
  context: OrgContext,
  sourceId: string,
): Promise<TrustAsOfRevisionV1[]> {
  const rows = await ex
    .select()
    .from(pgSchema.traderMiSourceTrust)
    .where(
      and(
        eq(pgSchema.traderMiSourceTrust.sourceId, sourceId),
        orgScopedWhere(pgSchema.traderMiSourceTrust.organizationId, context),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    sourceId: row.sourceId,
    trustScore: row.trustScore,
    contentDigest: row.contentDigest,
    revisionOf: row.revisionOf,
    revisionSeq: row.revisionSeq,
    chronology: pitChronologyV1({
      eventTime: row.eventTime,
      availableAt: row.availableAt,
      ingestTime: row.ingestTime,
    }),
  }));
}

export async function persistTrustAsOfReceiptV1Postgres(
  ex: PgTrustAsOfExecutor,
  context: OrgContext,
  receipt: TrustAsOfReceiptV1,
): Promise<{ receipt: TrustAsOfReceiptV1; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  if (
    receipt.organizationId !== scoped.organizationId ||
    !isTrustAsOfReceiptV1ContentAddressed(receipt)
  ) throw new TrustAsOfReceiptConflictError();
  const anchorTime = new Date(receipt.anchorTimeUtc);
  if (!Number.isFinite(anchorTime.getTime())) throw new TrustAsOfReceiptConflictError();

  const existing = await readTrustAsOfReceiptV1Postgres(ex, scoped, receipt.contentDigest);
  if (existing) {
    if (serializeTrustAsOfReceiptV1(existing) !== serializeTrustAsOfReceiptV1(receipt)) throw new TrustAsOfReceiptConflictError();
    return { receipt: existing, insertedNew: false };
  }

  const inserted = await ex
    .insert(pgSchema.traderMiTrustAsOfReceiptV1)
    .values({
      id: receipt.id,
      organizationId: scoped.organizationId,
      sourceId: receipt.sourceId,
      anchorTime,
      status: receipt.status,
      unknownReason: receipt.unknownReason,
      selectedTrustRevisionId: receipt.selectedTrustRevisionId,
      selectedRevisionSeq: receipt.selectedRevisionSeq,
      selectedContentDigest: receipt.selectedContentDigest,
      selectedTrustScore: receipt.selectedTrustScore,
      visiblePrefixDigest: receipt.visiblePrefixDigest,
      receiptJson: serializeTrustAsOfReceiptV1(receipt),
      contentDigest: receipt.contentDigest,
      schemaVersion: receipt.schemaVersion,
    })
    .onConflictDoNothing({ target: pgSchema.traderMiTrustAsOfReceiptV1.id })
    .returning({ id: pgSchema.traderMiTrustAsOfReceiptV1.id });

  const stored = await readTrustAsOfReceiptV1Postgres(ex, scoped, receipt.contentDigest);
  if (!stored || serializeTrustAsOfReceiptV1(stored) !== serializeTrustAsOfReceiptV1(receipt)) {
    throw new TrustAsOfReceiptConflictError();
  }
  return { receipt: stored, insertedNew: inserted.length === 1 };
}

export async function resolveAndPersistTrustAsOfV1Postgres(
  ex: PgTrustAsOfExecutor,
  context: OrgContext,
  input: { sourceId: string; anchorTime: Date },
): Promise<{ receipt: TrustAsOfReceiptV1; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  await requireScopedSource(ex, scoped, input.sourceId);
  const history = await listScopedTrustHistory(ex, scoped, input.sourceId);
  const receipt = resolveTrustAsOfV1({
    organizationId: scoped.organizationId,
    sourceId: input.sourceId,
    anchorTime: input.anchorTime,
    history,
  });
  return persistTrustAsOfReceiptV1Postgres(ex, scoped, receipt);
}
