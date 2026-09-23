export const OWNER_EMAIL_NOTE = "владелец (не подтверждённый billing-контакт)";

export function clientAccessStatus(input: {
  entitlementEnabled: boolean;
  hasDebt: boolean;
  hasOpenLots: boolean;
}): "активен" | "доступ отключён" | "только история" {
  if (input.entitlementEnabled) return "активен";
  if (input.hasDebt || input.hasOpenLots) return "доступ отключён";
  return "только история";
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
  return firstConnectedAt ?? "Не установлена";
}

export function isTraderPayment(subjectModule: string): boolean {
  return subjectModule === "trader";
}
