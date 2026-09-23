import { describe, expect, it } from "vitest";

import {
  connectedSinceLabel,
  includeClient,
  isTraderPayment,
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
  });
});
