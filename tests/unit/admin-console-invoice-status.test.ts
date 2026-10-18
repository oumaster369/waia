import { describe, expect, it } from "vitest";

import {
  invoiceDisplayStatus,
  invoiceDueAt,
} from "@/lib/trader/admin-console/billing/invoice-display-status";

const base = {
  state: "ISSUED" as const,
  approved: false,
  coolingOffUntil: null,
  paymentDetected: false,
  paymentApplied: false,
  now: "2026-09-23T12:00:00.000Z",
  dueAt: "2026-09-30T12:00:00.000Z",
  paidAt: null,
  reconciliation: false,
  disputeOpen: false,
  corrected: false,
};

describe("admin console invoice status", () => {
  it("names a draft, a cooling-off draft, an issued invoice, and a paid invoice", () => {
    expect(invoiceDisplayStatus({ ...base, state: "DRAFT" }).status).toBe("Draft");
    expect(
      invoiceDisplayStatus({
        ...base,
        state: "DRAFT",
        approved: true,
        coolingOffUntil: "2026-09-24T00:00:00.000Z",
      }).status,
    ).toBe("Awaiting review");
    expect(invoiceDisplayStatus(base).status).toBe("Issued, unpaid");
    expect(
      invoiceDisplayStatus({
        ...base,
        state: "PAID",
        paymentApplied: true,
        paidAt: "2026-09-23T11:00:00.000Z",
      }).status,
    ).toBe("Paid");
  });

  it("keeps a detected payment unpaid, marks an overdue dispute, and never says partially paid", () => {
    const detected = invoiceDisplayStatus({ ...base, paymentDetected: true });
    expect(detected.status).not.toBe("Paid");
    expect(detected.payment).toBe("Payment detected, awaiting confirmations");
    const overdue = invoiceDisplayStatus({
      ...base,
      now: "2026-10-01T00:00:00.000Z",
      disputeOpen: true,
      reconciliation: true,
    });
    expect(overdue.status).toBe("Overdue");
    expect(overdue.flags).toContain("Disputed");
    expect(overdue.flags).toContain("Under reconciliation");
    expect(JSON.stringify(overdue)).not.toContain("Partially paid");
    expect(overdue.dueNote).toContain("DEE-ADR-A");
    expect(invoiceDueAt("2026-09-01T00:00:00.000Z", 86_400_000)).toBe("2026-09-02T00:00:00.000Z");
  });
});
