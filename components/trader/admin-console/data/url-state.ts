export type AdminUrlState = {
  tab: string;
  sel: string | null;
  scope: string;
};

export function parseAdminConsoleUrl(search: string): AdminUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    tab: params.get("tab") ?? "summary",
    sel: params.get("sel"),
    scope: params.get("scope") ?? "fleet",
  };
}

export function writeAdminConsoleUrl(path: string, state: AdminUrlState): string {
  const params = new URLSearchParams();
  if (state.tab !== "summary") params.set("tab", state.tab);
  if (state.sel) params.set("sel", state.sel);
  if (state.scope !== "fleet") params.set("scope", state.scope);
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}
