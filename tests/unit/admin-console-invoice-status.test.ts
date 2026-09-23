import { describe, expect, it } from "vitest";

import { invoiceDisplayStatus } from "@/lib/trader/admin-console/billing/invoice-display-status";

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
    expect(invoiceDisplayStatus({ ...base, state: "DRAFT" }).status).toBe("Черновик");
    expect(
      invoiceDisplayStatus({
        ...base,
        state: "DRAFT",
        approved: true,
        coolingOffUntil: "2026-09-24T00:00:00.000Z",
      }).status,
    ).toBe("Ожидает проверки");
    expect(invoiceDisplayStatus(base).status).toBe("Выставлен, не оплачен");
    expect(
      invoiceDisplayStatus({
        ...base,
        state: "PAID",
        paymentApplied: true,
        paidAt: "2026-09-23T11:00:00.000Z",
      }).status,
    ).toBe("Оплачен");
  });

  it("keeps a detected payment unpaid, marks an overdue dispute, and never says partially paid", () => {
    const detected = invoiceDisplayStatus({ ...base, paymentDetected: true });
    expect(detected.status).not.toBe("Оплачен");
    expect(detected.payment).toBe("Платёж обнаружен, ждёт подтверждений");
    const overdue = invoiceDisplayStatus({
      ...base,
      now: "2026-10-01T00:00:00.000Z",
      disputeOpen: true,
      reconciliation: true,
    });
    expect(overdue.status).toBe("Просрочен");
    expect(overdue.flags).toContain("Оспорен");
    expect(overdue.flags).toContain("На сверке");
    expect(JSON.stringify(overdue)).not.toContain("Частично оплачен");
    expect(overdue.dueNote).toContain("DEE-ADR-A");
  });
});
