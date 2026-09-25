import { createHash } from "node:crypto";
import { adminScopeFromQuery, type AdminConsoleQuery } from "@/lib/trader/admin-console/scope";
export function assistantContext(query: AdminConsoleQuery) {
  const value = {
    scope: adminScopeFromQuery(query),
    period: query.period,
    from: query.from ?? null,
    to: query.to ?? null,
    timeZone: query.tz,
    mode: query.mode,
    currency: query.currency,
  };
  return { ...value, contextKey: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}
export type AssistantContext = ReturnType<typeof assistantContext>;
export function assistantHref(
  path: string,
  query: AdminConsoleQuery,
  selection?: Record<string, string>,
) {
  const params = new URLSearchParams({
    period: query.period,
    tz: query.tz,
    mode: query.mode,
    currency: query.currency,
  });
  if (query.organization_id) params.set("organization_id", query.organization_id);
  if (query.exchange_account_id) params.set("exchange_account_id", query.exchange_account_id);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  for (const [key, value] of Object.entries(selection ?? {})) params.set(key, value);
  return `${path}?${params}`;
}
