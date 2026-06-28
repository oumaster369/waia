import { describe, expect, it } from "vitest";

import { DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS } from "@/lib/trader/settlement/account-status-policy";
import {
  assertSuspensionAllowed,
  isInvoiceOverdue,
  resolveStatusAfterSuspension,
  shouldAppendReactivationEvent,
  shouldAppendSuspensionEvent,
} from "@/lib/trader/settlement/account-status.transitions";
import { IllegalAccountStatusTransitionError } from "@/lib/trader/settlement/settlement.errors";

describe("account status transitions", () => {
  it("resolves suspension to SUSPENDED status", () => {
    expect(resolveStatusAfterSuspension()).toBe("SUSPENDED");
  });

  it("appends suspension only when not already suspended", () => {
    expect(shouldAppendSuspensionEvent(null)).toBe(true);
    expect(shouldAppendSuspensionEvent("ACTIVE")).toBe(true);
    expect(shouldAppendSuspensionEvent("SUSPENDED")).toBe(false);
  });

  it("appends reactivation only from SUSPENDED", () => {
    expect(shouldAppendReactivationEvent(null)).toBe(false);
    expect(shouldAppendReactivationEvent("ACTIVE")).toBe(false);
    expect(shouldAppendReactivationEvent("SUSPENDED")).toBe(true);
  });

  it("detects overdue invoices after grace period", () => {
    const issuedAt = new Date("2026-06-01T00:00:00.000Z");
    const withinGrace = new Date(issuedAt.getTime() + DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS - 1);
    const afterGrace = new Date(issuedAt.getTime() + DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS + 1);

    expect(isInvoiceOverdue(issuedAt, withinGrace, DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS)).toBe(
      false,
    );
    expect(isInvoiceOverdue(issuedAt, afterGrace, DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS)).toBe(
      true,
    );
  });

  it("rejects duplicate suspension transitions", () => {
    expect(() => assertSuspensionAllowed("SUSPENDED", "SUSPENDED")).toThrow(
      IllegalAccountStatusTransitionError,
    );
    expect(() => assertSuspensionAllowed("ACTIVE", "SUSPENDED")).not.toThrow();
  });
});
