// Only navigation/filter state can be restored; stored data cannot supply a URL,
// command, stale entity selection, HTML, or arbitrary query parameters.
const paths: Record<string, string> = {
  overview: "/admin",
  accounts: "/admin/accounts",
  orders: "/admin/orders",
  clients: "/admin/clients",
  strategies: "/admin/strategies",
  research: "/admin/research",
  errors: "/admin/errors",
  system: "/admin/system",
};
export const SAVED_VIEW_KEYS = [
  "organization_id",
  "exchange_account_id",
  "period",
  "from",
  "to",
  "tz",
  "currency",
  "mode",
  "tab",
  "status",
  "q",
  "sort",
] as const;
export function savedViewHref(section: string, state: unknown): string | null {
  if (!Object.hasOwn(paths, section) || !state || typeof state !== "object") return null;
  const source = (state as { query?: unknown }).query;
  if (typeof source !== "string" || source.length > 3000) return null;
  const input = new URLSearchParams(source);
  const out = new URLSearchParams();
  for (const key of SAVED_VIEW_KEYS) {
    const value = input.get(key);
    if (value && value.length <= 500) out.set(key, value);
  }
  if (!out.has("organization_id")) out.delete("exchange_account_id");
  return `${paths[section]}${out.size ? `?${out}` : ""}`;
}
export const BUILTIN_VIEWS = [
  { id: "attention", name: "Проблемные счета", path: "/admin/accounts?tab=attention" },
  { id: "unpaid", name: "Неоплаченные", path: "/admin/clients?tab=invoices&status=ISSUED" },
  { id: "rejected", name: "Отклонённые ордера", path: "/admin/orders?tab=all&status=REJECTED" },
  {
    id: "inactive",
    name: "Исследования без активности",
    path: "/admin/research?tab=campaigns&status=inactive",
  },
] as const;
