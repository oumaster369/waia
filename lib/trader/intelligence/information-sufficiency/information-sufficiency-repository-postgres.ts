import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq, isNull } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  assertInformationSufficiencyReceiptV2,
  assertRequiredInformationProfileV2,
  type InformationSufficiencyReceiptV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type RepositoryExecutor = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
type ReadExecutor = Pick<RepositoryExecutor, "select">;
export type InformationSufficiencyHeldExecutorV2 = Pick<RepositoryExecutor, "select" | "insert">;

function accountPredicate(
  column: typeof pgSchema.traderRequiredInformationProfileV2.accountId,
  accountId: string | null,
) {
  return accountId === null ? isNull(column) : eq(column, accountId);
}

function mapProfile(
  row: typeof pgSchema.traderRequiredInformationProfileV2.$inferSelect,
): RequiredInformationProfileV2 {
  return assertRequiredInformationProfileV2(row.profileJson as RequiredInformationProfileV2);
}

async function readProfile(
  ex: ReadExecutor,
  organizationId: string,
  id: string,
): Promise<RequiredInformationProfileV2 | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderRequiredInformationProfileV2)
    .where(
      and(
        eq(pgSchema.traderRequiredInformationProfileV2.organizationId, organizationId),
        eq(pgSchema.traderRequiredInformationProfileV2.id, id),
      ),
    )
    .limit(1);
  return rows[0] ? mapProfile(rows[0]) : null;
}

async function readReceipt(
  ex: ReadExecutor,
  organizationId: string,
  id: string,
): Promise<InformationSufficiencyReceiptV2 | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderInformationSufficiencyReceiptV2)
    .where(
      and(
        eq(pgSchema.traderInformationSufficiencyReceiptV2.organizationId, organizationId),
        eq(pgSchema.traderInformationSufficiencyReceiptV2.id, id),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const profile = await readProfile(ex, organizationId, row.profileId);
  if (!profile) throw new Error("INFORMATION_SUFFICIENCY_STORAGE:profileMissing");
  return assertInformationSufficiencyReceiptV2(
    row.receiptJson as InformationSufficiencyReceiptV2,
    profile,
  );
}

function assertScopedProfile(context: OrgContext, profile: RequiredInformationProfileV2): void {
  assertRequiredInformationProfileV2(profile);
  if (profile.organizationId !== context.organizationId) {
    throw new Error("INFORMATION_SUFFICIENCY_STORAGE:organizationMismatch");
  }
}

export async function persistRequiredInformationProfileV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  profile: RequiredInformationProfileV2,
): Promise<{ profile: RequiredInformationProfileV2; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  assertScopedProfile(scoped, profile);
  return runWaiaPostgresTransaction(db, (tx) =>
    persistRequiredInformationProfileWithinTransactionV2Postgres(tx, scoped, profile));
}

/** Internal same-transaction primitive for a caller already holding the run publication lock. */
export async function persistRequiredInformationProfileWithinTransactionV2Postgres(
  tx: InformationSufficiencyHeldExecutorV2,
  context: OrgContext,
  profile: RequiredInformationProfileV2,
): Promise<{ profile: RequiredInformationProfileV2; insertedNew: boolean }> {
    const scoped = requireOrgContext(context.organizationId);
    assertScopedProfile(scoped, profile);
    const inserted = await tx
      .insert(pgSchema.traderRequiredInformationProfileV2)
      .values({
        id: profile.id,
        organizationId: scoped.organizationId,
        accountId: profile.accountId,
        profileVersion: profile.profileVersion,
        purpose: profile.purpose,
        symbol: profile.symbol,
        venue: profile.venue,
        analyticalTimeframe: profile.analyticalTimeframe,
        horizon: profile.horizon,
        profileJson: profile,
        contentDigest: profile.contentDigest,
        schemaVersion: profile.schemaVersion,
        authority: profile.authority,
      })
      .onConflictDoNothing({ target: pgSchema.traderRequiredInformationProfileV2.id })
      .returning({ id: pgSchema.traderRequiredInformationProfileV2.id });
    const stored = await readProfile(tx, scoped.organizationId, profile.id);
    if (!stored || canonicalJsonString(stored) !== canonicalJsonString(profile)) {
      throw new Error("INFORMATION_SUFFICIENCY_STORAGE:profileConflict");
    }
    return { profile: stored, insertedNew: inserted.length === 1 };
}

export async function findRequiredInformationProfileV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  id: string,
): Promise<RequiredInformationProfileV2 | null> {
  const scoped = requireOrgContext(context.organizationId);
  return readProfile(db, scoped.organizationId, id);
}

export async function listRequiredInformationProfilesV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  accountId: string | null,
): Promise<RequiredInformationProfileV2[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await db
    .select()
    .from(pgSchema.traderRequiredInformationProfileV2)
    .where(
      and(
        eq(pgSchema.traderRequiredInformationProfileV2.organizationId, scoped.organizationId),
        accountPredicate(pgSchema.traderRequiredInformationProfileV2.accountId, accountId),
      ),
    )
    .orderBy(
      desc(pgSchema.traderRequiredInformationProfileV2.createdAt),
      desc(pgSchema.traderRequiredInformationProfileV2.id),
    );
  return rows.map(mapProfile);
}

export async function persistInformationSufficiencyReceiptV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  receipt: InformationSufficiencyReceiptV2,
): Promise<{ receipt: InformationSufficiencyReceiptV2; insertedNew: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  if (receipt.organizationId !== scoped.organizationId) {
    throw new Error("INFORMATION_SUFFICIENCY_STORAGE:organizationMismatch");
  }
  return runWaiaPostgresTransaction(db, (tx) =>
    persistInformationSufficiencyReceiptWithinTransactionV2Postgres(tx, scoped, receipt));
}

/** Internal same-transaction primitive; never opens or escapes to another PostgreSQL session. */
export async function persistInformationSufficiencyReceiptWithinTransactionV2Postgres(
  tx: InformationSufficiencyHeldExecutorV2,
  context: OrgContext,
  receipt: InformationSufficiencyReceiptV2,
): Promise<{ receipt: InformationSufficiencyReceiptV2; insertedNew: boolean }> {
    const scoped = requireOrgContext(context.organizationId);
    if (receipt.organizationId !== scoped.organizationId) {
      throw new Error("INFORMATION_SUFFICIENCY_STORAGE:organizationMismatch");
    }
    const profile = await readProfile(tx, scoped.organizationId, receipt.profileId);
    if (!profile) throw new Error("INFORMATION_SUFFICIENCY_STORAGE:profileMissing");
    assertInformationSufficiencyReceiptV2(receipt, profile);
    const inserted = await tx
      .insert(pgSchema.traderInformationSufficiencyReceiptV2)
      .values({
        id: receipt.id,
        organizationId: scoped.organizationId,
        accountId: receipt.accountId,
        profileId: receipt.profileId,
        profileContentDigest: receipt.profileContentDigest,
        purpose: receipt.purpose,
        status: receipt.status,
        pitAnchor: new Date(receipt.pitAnchor),
        receiptJson: receipt,
        contentDigest: receipt.contentDigest,
        schemaVersion: receipt.schemaVersion,
        authority: receipt.authority,
      })
      .onConflictDoNothing({ target: pgSchema.traderInformationSufficiencyReceiptV2.id })
      .returning({ id: pgSchema.traderInformationSufficiencyReceiptV2.id });
    const stored = await readReceipt(tx, scoped.organizationId, receipt.id);
    if (!stored || canonicalJsonString(stored) !== canonicalJsonString(receipt)) {
      throw new Error("INFORMATION_SUFFICIENCY_STORAGE:receiptConflict");
    }
    return { receipt: stored, insertedNew: inserted.length === 1 };
}

/** Exact durable replay used by Forecast persistence and PIT reconstruction. */
export async function requireInformationSufficiencyAuthorityWithinTransactionV2Postgres(
  tx: InformationSufficiencyHeldExecutorV2,
  context: OrgContext,
  profile: RequiredInformationProfileV2,
  receipt: InformationSufficiencyReceiptV2,
): Promise<void> {
  const scoped = requireOrgContext(context.organizationId);
  assertScopedProfile(scoped, profile);
  assertInformationSufficiencyReceiptV2(receipt, profile);
  const storedProfile = await readProfile(tx, scoped.organizationId, profile.id);
  const storedReceipt = await readReceipt(tx, scoped.organizationId, receipt.id);
  if (!storedProfile || !storedReceipt ||
      canonicalJsonString(storedProfile) !== canonicalJsonString(profile) ||
      canonicalJsonString(storedReceipt) !== canonicalJsonString(receipt)) {
    throw new Error("INFORMATION_SUFFICIENCY_STORAGE:authorityConflict");
  }
}

export async function findInformationSufficiencyReceiptV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  id: string,
): Promise<InformationSufficiencyReceiptV2 | null> {
  const scoped = requireOrgContext(context.organizationId);
  return readReceipt(db, scoped.organizationId, id);
}

export async function listInformationSufficiencyReceiptsV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  profileId: string,
): Promise<InformationSufficiencyReceiptV2[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await db
    .select()
    .from(pgSchema.traderInformationSufficiencyReceiptV2)
    .where(
      and(
        eq(pgSchema.traderInformationSufficiencyReceiptV2.organizationId, scoped.organizationId),
        eq(pgSchema.traderInformationSufficiencyReceiptV2.profileId, profileId),
      ),
    )
    .orderBy(
      desc(pgSchema.traderInformationSufficiencyReceiptV2.pitAnchor),
      desc(pgSchema.traderInformationSufficiencyReceiptV2.id),
    );
  const profile = await readProfile(db, scoped.organizationId, profileId);
  if (!profile && rows.length > 0) {
    throw new Error("INFORMATION_SUFFICIENCY_STORAGE:profileMissing");
  }
  return rows.map((row) =>
    assertInformationSufficiencyReceiptV2(
      row.receiptJson as InformationSufficiencyReceiptV2,
      profile!,
    ),
  );
}
