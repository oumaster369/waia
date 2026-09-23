export const TRADER_ADMIN_ENTITLEMENT_KEY = "trader" as const;

/** Keeps organizations that have the trader entitlement enabled. */
export function filterOrganizationsByTraderEntitlement<T extends { id: string }>(
  organizations: readonly T[],
  entitledOrganizationIds: ReadonlySet<string>,
): T[] {
  return organizations.filter((organization) => entitledOrganizationIds.has(organization.id));
}
