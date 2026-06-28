/** Resolve Org-0 organization id from env (unset → fail-closed). */
export function resolveOrg0OrganizationId(env?: Record<string, unknown>): string | null {
  const raw = env?.WAIA_TRADER_ORG0_ORGANIZATION_ID ?? process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function isOrg0Organization(organizationId: string, env?: Record<string, unknown>): boolean {
  const org0 = resolveOrg0OrganizationId(env);
  return org0 !== null && org0 === organizationId;
}
