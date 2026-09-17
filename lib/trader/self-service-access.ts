import "server-only";

import { and, eq } from "drizzle-orm";

import { organizationEntitlements, organizations } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaDb } from "@/db/types";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaSqliteLegacyTransaction } from "@/db/waia-transaction";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { ensureTraderRuntimeForUser } from "@/lib/trader/runtime-provisioning";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";

const TRADER_ENTITLEMENT_KEY = "trader";

export type TraderSelfServiceOutcome =
  /** An enabled Trader entitlement already existed; nothing was written. */
  | "ALREADY_ENTITLED"
  /** The personal organization existed and gained only the Trader entitlement. */
  | "ENTITLEMENT_CREATED"
  /** A disabled Trader entitlement row existed and was re-enabled in place. */
  | "ENTITLEMENT_ENABLED"
  /** No membership existed: personal organization, owner membership and entitlement were created. */
  | "ORGANIZATION_AND_ENTITLEMENT_CREATED"
  /** The deterministic personal organization id is owned by another user; nothing was written. */
  | "DENIED_FOREIGN_ORGANIZATION";

export type TraderSelfServiceResult = Readonly<{
  organizationId: string;
  outcome: TraderSelfServiceOutcome;
  entitled: boolean;
}>;

export type TraderSelfServiceInput = Readonly<{
  userId: string;
  displayName?: string;
}>;

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

/**
 * Self-service Trader admission for the authenticated user's own personal organization.
 *
 * Scope is always the deterministic {@link personalOrganizationIdFromUserId}, so no membership
 * ambiguity can arise and no unrelated tenant is reachable. The grant is module access only:
 * platform roles are untouched, and live trading stays behind its separate operator ceremony.
 */
export function ensureTraderSelfServiceAccessSqlite(
  db: WaiaDb,
  input: TraderSelfServiceInput,
): TraderSelfServiceResult {
  const organizationId = personalOrganizationIdFromUserId(input.userId);

  const existingOrg = db
    .select({ id: organizations.id, ownerUserId: organizations.ownerUserId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
    .all()[0];

  if (existingOrg && existingOrg.ownerUserId !== input.userId) {
    return { organizationId, outcome: "DENIED_FOREIGN_ORGANIZATION", entitled: false };
  }

  const existingEntitlement = db
    .select({ id: organizationEntitlements.id, enabled: organizationEntitlements.enabled })
    .from(organizationEntitlements)
    .where(
      and(
        eq(organizationEntitlements.organizationId, organizationId),
        eq(organizationEntitlements.entitlementKey, TRADER_ENTITLEMENT_KEY),
      ),
    )
    .limit(1)
    .all()[0];

  if (existingEntitlement?.enabled === true) {
    return { organizationId, outcome: "ALREADY_ENTITLED", entitled: true };
  }

  // Blank defers to the stored identity label; the seed never invents a name.
  ensureUserCoreSeedSqlite(db, { userId: input.userId, displayName: input.displayName ?? "" });

  const now = new Date();
  let entitlementId: string;
  let outcome: TraderSelfServiceOutcome;

  if (existingEntitlement) {
    entitlementId = existingEntitlement.id;
    outcome = "ENTITLEMENT_ENABLED";
    db.update(organizationEntitlements)
      .set({ enabled: true, sourceModule: TRADER_ENTITLEMENT_KEY, updatedAt: now })
      .where(eq(organizationEntitlements.id, existingEntitlement.id))
      .run();
  } else {
    entitlementId = crypto.randomUUID();
    outcome = existingOrg ? "ENTITLEMENT_CREATED" : "ORGANIZATION_AND_ENTITLEMENT_CREATED";
    db.insert(organizationEntitlements)
      .values({
        id: entitlementId,
        organizationId,
        entitlementKey: TRADER_ENTITLEMENT_KEY,
        enabled: true,
        sourceModule: TRADER_ENTITLEMENT_KEY,
        updatedAt: now,
      })
      .run();
  }

  writeTraderAuditLogSqlite(db, {
    actorType: "user",
    actorId: input.userId,
    action: traderAuditActions.moduleEntitlementSelfServiceGranted,
    entityType: traderEntityTypes.moduleEntitlement,
    entityId: entitlementId,
    organizationId,
    metadata: { entitlementKey: TRADER_ENTITLEMENT_KEY, outcome },
  });

  return { organizationId, outcome, entitled: true };
}

/** Postgres counterpart of {@link ensureTraderSelfServiceAccessSqlite}. */
export async function ensureTraderSelfServiceAccessPostgres(
  ex: PgExecutor,
  input: TraderSelfServiceInput,
): Promise<TraderSelfServiceResult> {
  const organizationId = personalOrganizationIdFromUserId(input.userId);

  const orgRows = await ex
    .select({ id: pgSchema.organizations.id, ownerUserId: pgSchema.organizations.ownerUserId })
    .from(pgSchema.organizations)
    .where(eq(pgSchema.organizations.id, organizationId))
    .limit(1);
  const existingOrg = orgRows[0];

  if (existingOrg && existingOrg.ownerUserId !== input.userId) {
    return { organizationId, outcome: "DENIED_FOREIGN_ORGANIZATION", entitled: false };
  }

  const entitlementRows = await ex
    .select({
      id: pgSchema.organizationEntitlements.id,
      enabled: pgSchema.organizationEntitlements.enabled,
    })
    .from(pgSchema.organizationEntitlements)
    .where(
      and(
        eq(pgSchema.organizationEntitlements.organizationId, organizationId),
        eq(pgSchema.organizationEntitlements.entitlementKey, TRADER_ENTITLEMENT_KEY),
      ),
    )
    .limit(1);
  const existingEntitlement = entitlementRows[0];

  if (existingEntitlement?.enabled === true) {
    return { organizationId, outcome: "ALREADY_ENTITLED", entitled: true };
  }

  // Blank defers to the stored identity label; the seed never invents a name.
  await ensureUserCoreSeedPostgres(ex, {
    userId: input.userId,
    displayName: input.displayName ?? "",
  });

  let entitlementId: string;
  let outcome: TraderSelfServiceOutcome;

  if (existingEntitlement) {
    entitlementId = existingEntitlement.id;
    outcome = "ENTITLEMENT_ENABLED";
    await ex
      .update(pgSchema.organizationEntitlements)
      .set({ enabled: true, sourceModule: TRADER_ENTITLEMENT_KEY, updatedAt: new Date() })
      .where(eq(pgSchema.organizationEntitlements.id, existingEntitlement.id));
  } else {
    entitlementId = crypto.randomUUID();
    outcome = existingOrg ? "ENTITLEMENT_CREATED" : "ORGANIZATION_AND_ENTITLEMENT_CREATED";
    await ex.insert(pgSchema.organizationEntitlements).values({
      id: entitlementId,
      organizationId,
      entitlementKey: TRADER_ENTITLEMENT_KEY,
      enabled: true,
      sourceModule: TRADER_ENTITLEMENT_KEY,
    });
  }

  await writeTraderAuditLogPostgres(ex, {
    actorType: "user",
    actorId: input.userId,
    action: traderAuditActions.moduleEntitlementSelfServiceGranted,
    entityType: traderEntityTypes.moduleEntitlement,
    entityId: entitlementId,
    organizationId,
    metadata: { entitlementKey: TRADER_ENTITLEMENT_KEY, outcome },
  });

  return { organizationId, outcome, entitled: true };
}

/**
 * Trader-host admission for an authenticated session: idempotently admit the caller's own
 * personal organization, then answer from the unchanged authoritative gate.
 *
 * Only trader-host entry points call this. Protected APIs keep using
 * {@link ensureTraderRuntimeForUser} so they stay read-only and fail closed.
 */
export async function ensureTraderSelfServiceAccessForUser(userId: string): Promise<boolean> {
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind === "sqlite") {
      const db = runtime.db;
      await runWaiaSqliteLegacyTransaction(db, (tx) =>
        ensureTraderSelfServiceAccessSqlite(tx, { userId }),
      );
    } else {
      await runWaiaPostgresTransaction(runtime.db, (tx) =>
        ensureTraderSelfServiceAccessPostgres(tx, { userId }),
      );
    }
  } catch {
    // Admission is additive. A failed grant degrades to the pre-existing gate result
    // rather than failing the partner's sign-in.
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }

  return ensureTraderRuntimeForUser(userId);
}
