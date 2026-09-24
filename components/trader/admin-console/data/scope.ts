export type AdminScope =
  | { kind: "fleet" }
  | { kind: "client"; organizationId: string }
  | { kind: "account"; organizationId: string; accountId: string };

export function adminQueryKey(input: {
  path: string;
  scope: AdminScope;
  period: string;
  mode: string;
  currency: string;
}): readonly string[] {
  return [input.path, JSON.stringify(input.scope), input.period, input.mode, input.currency];
}

export function responseMatchesScope(responseScope: AdminScope, current: AdminScope): boolean {
  return JSON.stringify(responseScope) === JSON.stringify(current);
}
