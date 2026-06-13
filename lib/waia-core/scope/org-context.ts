import "server-only";

import { and, eq, type Column, type SQL } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { organizationMembers } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

export class OrgScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgScopeError";
  }
}

export type OrgContext = {
  organizationId: string;
  userId?: string;
};

/**
 * Mandatory org context wrapper — callers must supply an explicit organization id.
 */
export function requireOrgContext(organizationId: string | null | undefined): OrgContext {
  const trimmed = organizationId?.trim();
  if (!trimmed) {
    throw new OrgScopeError("ORG_CONTEXT_REQUIRED");
  }
  return { organizationId: trimmed };
}

/**
 * Mandatory org-scoping predicate (cross-backend). Modules must build org-scoped
 * `WHERE` clauses through this helper so unscoped queries cannot be issued accidentally.
 */
export function orgScopedWhere(organizationIdColumn: Column, context: OrgContext): SQL {
  return eq(organizationIdColumn, context.organizationId);
}

export function assertOrgMembershipSqlite(
  db: WaiaDb,
  context: OrgContext & { userId: string },
): void {
  const row = db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, context.organizationId),
        eq(organizationMembers.userId, context.userId),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new OrgScopeError("ORG_MEMBERSHIP_REQUIRED");
  }
}

/** Postgres parity for {@link assertOrgMembershipSqlite}. */
export async function assertOrgMembershipPostgres(
  ex: PgReadExecutor,
  context: OrgContext & { userId: string },
): Promise<void> {
  const rows = await ex
    .select({ id: pgSchema.organizationMembers.id })
    .from(pgSchema.organizationMembers)
    .where(
      and(
        eq(pgSchema.organizationMembers.organizationId, context.organizationId),
        eq(pgSchema.organizationMembers.userId, context.userId),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new OrgScopeError("ORG_MEMBERSHIP_REQUIRED");
  }
}
