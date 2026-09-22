/** Authorization scope shared by the admin cabinet list and admin observation reads.
 * The list's LIMIT is a page size, not a second authorization boundary.
 * A row outside this predicate must be absent from the list and unreadable.
 */
export const ADMIN_LISTED_ORGANIZATION_KIND = "personal" as const;
export const ADMIN_LISTED_VENUE = "htx" as const;
export const ADMIN_LISTED_CREDENTIAL_STATUS = "active" as const;

export function isAdminConnectedAccountScope(
  row: Readonly<{
    organizationKind: string;
    venue: string;
    credentialStatus: string;
  }>,
): boolean {
  return (
    row.organizationKind === ADMIN_LISTED_ORGANIZATION_KIND &&
    row.venue === ADMIN_LISTED_VENUE &&
    row.credentialStatus === ADMIN_LISTED_CREDENTIAL_STATUS
  );
}
