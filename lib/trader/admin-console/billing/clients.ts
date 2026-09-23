export function includeClient(input: {
  entitlementEnabled: boolean;
  hasInvoice: boolean;
  hasCredential: boolean;
  hasDebt: boolean;
  hasOpenLots: boolean;
}): boolean {
  if (input.entitlementEnabled || input.hasInvoice || input.hasCredential) return true;
  return !input.entitlementEnabled && (input.hasDebt || input.hasOpenLots);
}

export function connectedSinceLabel(firstConnectedAt: string | null): string {
  return firstConnectedAt ?? "Не установлена";
}

export function isTraderPayment(subjectModule: string): boolean {
  return subjectModule === "trader";
}
