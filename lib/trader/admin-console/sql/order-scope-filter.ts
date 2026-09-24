import { sql, type SQL } from "drizzle-orm";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { column, organizationFilter } from "@/lib/trader/admin-console/sql/read-scope";

/** A credential must belong to the order's own tenant; an account key is not an exchange id. */
export function orderScopeFilter(query: AdminConsoleQuery, alias = ""): SQL {
  const id = query.exchange_account_id ?? null;
  return sql`${organizationFilter(query, alias)} AND (
    ${id}::text IS NULL OR EXISTS (
      SELECT 1 FROM exchange_credentials scoped_credential
      WHERE scoped_credential.id = ${column(alias, "credential_id")}
        AND scoped_credential.organization_id = ${column(alias, "organization_id")}
        AND scoped_credential.exchange_account_id = ${id}::text
    )
  )`;
}
