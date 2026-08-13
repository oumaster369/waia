import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, type Column, type SQL } from "drizzle-orm";
import type postgres from "postgres";

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

/** Canonical organization-scope column for raw postgres.js template queries. */
export const ORGANIZATION_SCOPE_COLUMN = "organization_id" as const;

/**
 * Mandatory org-scoping predicate for raw `postgres.js` tagged-template queries (ADR-0007).
 *
 * New/DEE-518-era Postgres services build queries with `postgres.Sql` template literals
 * rather than Drizzle, so {@link orgScopedWhere} (Drizzle `SQL`) does not apply. This helper
 * is the postgres.js parity: it returns a composable `<column> = <uuid>` fragment scoped to a
 * validated organization and must be embedded in every organization-scoped `WHERE`.
 *
 * Fail-closed guarantees (there is no unscoped mode):
 * - missing/empty `organizationId` throws {@link OrgScopeError} (`ORG_CONTEXT_REQUIRED`) via
 *   {@link requireOrgContext} before any SQL is produced;
 * - the fragment always contains the organization equality predicate, so callers cannot emit
 *   an unscoped organization query by accidentally dropping a `WHERE` clause;
 * - invalid UUID identity is rejected at the database by the `::uuid` cast.
 *
 * Business-id uniqueness is NOT a substitute for this predicate; it must always be ANDed with
 * the caller's natural-key predicates, never replace them.
 */
export function orgScopedPostgresPredicate(
  sql: postgres.Sql,
  organizationId: string | null | undefined,
  options?: { column?: string },
): postgres.Fragment {
  const scoped = requireOrgContext(organizationId);
  const column = options?.column ?? ORGANIZATION_SCOPE_COLUMN;
  return sql`${sql(column)} = ${scoped.organizationId}::uuid`;
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
