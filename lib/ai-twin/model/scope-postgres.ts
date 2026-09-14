import type postgres from "postgres";

import { orgScopedPostgresPredicate, OrgScopeError } from "@/lib/waia-core/scope/org-context";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TwinPersonalScope = Readonly<{
  organizationId: string;
  subjectId: string;
}>;

/** Application-layer two-dimensional scope. Not a substitute for Core access. */
export function requireTwinPersonalScope(
  scope: TwinPersonalScope | null | undefined,
): TwinPersonalScope {
  const organizationId = scope?.organizationId?.trim() ?? "";
  const subjectId = scope?.subjectId?.trim() ?? "";
  if (!organizationId) throw new OrgScopeError("ORG_CONTEXT_REQUIRED");
  if (!subjectId || !uuid.test(organizationId) || !uuid.test(subjectId)) {
    throw new OrgScopeError("TWIN_SUBJECT_REQUIRED");
  }
  return { organizationId, subjectId };
}

/**
 * Mandatory `(organization_id, subject_user_id)` predicate for AI-TWIN SQL.
 * Reuses the Core org helper and always ANDs the subject dimension.
 */
export function twinPersonalScopePostgresPredicate(
  sql: postgres.Sql | postgres.TransactionSql,
  scope: TwinPersonalScope | null | undefined,
  options?: { organizationColumn?: string; subjectColumn?: string },
): postgres.Fragment {
  const scoped = requireTwinPersonalScope(scope);
  return sql`${orgScopedPostgresPredicate(sql as postgres.Sql, scoped.organizationId, {
    column: options?.organizationColumn ?? "organization_id",
  })} AND ${sql(options?.subjectColumn ?? "subject_user_id")} = ${scoped.subjectId}::uuid`;
}
