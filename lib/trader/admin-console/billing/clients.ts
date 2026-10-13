export const OWNER_EMAIL_NOTE = "owner (not a verified billing contact)";

export function clientAccessStatus(input: {
  entitlementEnabled: boolean;
  hasDebt: boolean;
  hasOpenLots: boolean;
}): "active" | "access disabled" | "history only" {
  if (input.entitlementEnabled) return "active";
  if (input.hasDebt || input.hasOpenLots) return "access disabled";
  return "history only";
}

export function presentClient(input: {
  id: string;
  name: string;
  ownerEmail: string;
  registeredAt: string | null;
  firstConnectedAt: string | null;
  entitlementEnabled: boolean;
  hasInvoice: boolean;
  hasCredential: boolean;
  hasDebt: boolean;
  hasOpenLots: boolean;
}): {
  id: string;
  name: string;
  ownerEmail: string;
  ownerEmailNote: string;
  registeredAt: string | null;
  connectedSince: string;
  connectedSinceValue: string | null;
  access: ReturnType<typeof clientAccessStatus>;
} | null {
  if (!includeClient(input)) return null;
  return {
    id: input.id,
    name: input.name,
    ownerEmail: input.ownerEmail,
    ownerEmailNote: OWNER_EMAIL_NOTE,
    registeredAt: input.registeredAt,
    connectedSince: connectedSinceLabel(input.firstConnectedAt),
    connectedSinceValue: input.firstConnectedAt,
    access: clientAccessStatus(input),
  };
}

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
  return firstConnectedAt ?? "Not established";
}

export function isTraderPayment(subjectModule: string): boolean {
  return subjectModule === "trader";
}
