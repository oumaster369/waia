import { describe, expect, it } from "vitest";

import {
  connectedSinceLabel,
  includeClient,
  isTraderPayment,
  presentClient,
} from "@/lib/trader/admin-console/billing/clients";

describe("admin console clients", () => {
  it("keeps a client without an invoice, a disconnected debtor, and ignores another product payment", () => {
    expect(
      includeClient({
        entitlementEnabled: true,
        hasInvoice: false,
        hasCredential: false,
        hasDebt: false,
        hasOpenLots: false,
      }),
    ).toBe(true);
    expect(
      includeClient({
        entitlementEnabled: false,
        hasInvoice: false,
        hasCredential: false,
        hasDebt: true,
        hasOpenLots: false,
      }),
    ).toBe(true);
    expect(
      includeClient({
        entitlementEnabled: false,
        hasInvoice: false,
        hasCredential: false,
        hasDebt: false,
        hasOpenLots: false,
      }),
    ).toBe(false);
    expect(connectedSinceLabel(null)).toBe("Не установлена");
    expect(isTraderPayment("marketplace")).toBe(false);
    expect(isTraderPayment("trader")).toBe(true);
    expect(
      presentClient({
        id: "org-1",
        name: "A",
        ownerEmail: "a@waia.invalid",
        registeredAt: "2026-01-01T00:00:00.000Z",
        firstConnectedAt: null,
        entitlementEnabled: false,
        hasInvoice: false,
        hasCredential: false,
        hasDebt: true,
        hasOpenLots: false,
      })?.access,
    ).toBe("доступ отключён");
    expect(
      presentClient({
        id: "org-2",
        name: "B",
        ownerEmail: "b@waia.invalid",
        registeredAt: null,
        firstConnectedAt: null,
        entitlementEnabled: false,
        hasInvoice: false,
        hasCredential: false,
        hasDebt: false,
        hasOpenLots: false,
      }),
    ).toBeNull();
  });
});
