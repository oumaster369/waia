import { sql, type SQL } from "drizzle-orm";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";

export function column(alias: string, name: string): SQL {
  return alias
    ? sql`${sql.identifier(alias)}.${sql.identifier(name)}`
    : sql`${sql.identifier(name)}`;
}

export function organizationFilter(query: AdminConsoleQuery, alias = ""): SQL {
  const id = query.organization_id ?? null;
  return sql`(${id}::uuid IS NULL OR ${column(alias, "organization_id")} = ${id}::uuid)`;
}

export function exchangeAccountFilter(query: AdminConsoleQuery, alias = ""): SQL {
  const id = query.exchange_account_id ?? null;
  return sql`(${id}::text IS NULL OR ${column(alias, "exchange_account_id")} = ${id}::text)`;
}
