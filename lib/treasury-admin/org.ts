export const FINANCE_ORG_STORAGE_KEY = "waia.treasury.finance.organizationId";

export function readStoredFinanceOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(FINANCE_ORG_STORAGE_KEY)?.trim();
  return value ? value : null;
}

export function storeFinanceOrganizationId(organizationId: string): void {
  window.sessionStorage.setItem(FINANCE_ORG_STORAGE_KEY, organizationId);
}

export function financeHref(pathname: string, organizationId: string | null): string {
  if (!organizationId) return pathname;
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${pathname}?${params.toString()}`;
}
