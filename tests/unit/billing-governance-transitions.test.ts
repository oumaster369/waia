import { describe, expect, it } from "vitest";

import {
  assertDisputeTransitionAllowed,
  isInvoiceDisputable,
  isInvoiceEnforcementFrozen,
} from "@/lib/trader/billing/governance/billing-governance.transitions";
import { IllegalInvoiceDisputeTransitionError } from "@/lib/trader/billing/governance/billing-governance.errors";

describe("billing governance transitions", () => {
  it("allows disputes only on ISSUED or PAID invoices", () => {
    expect(isInvoiceDisputable("ISSUED")).toBe(true);
    expect(isInvoiceDisputable("PAID")).toBe(true);
    expect(isInvoiceDisputable("DRAFT")).toBe(false);
  });

  it("freezes enforcement only while dispute is OPEN", () => {
    expect(isInvoiceEnforcementFrozen("OPEN")).toBe(true);
    expect(isInvoiceEnforcementFrozen("RESOLVED_UPHELD")).toBe(false);
    expect(isInvoiceEnforcementFrozen("RESOLVED_CORRECTED")).toBe(false);
    expect(isInvoiceEnforcementFrozen(null)).toBe(false);
  });

  it("rejects illegal dispute transitions", () => {
    expect(() => assertDisputeTransitionAllowed("OPEN", "OPENED")).toThrow(
      IllegalInvoiceDisputeTransitionError,
    );
    expect(() => assertDisputeTransitionAllowed(null, "OPENED")).not.toThrow();
    expect(() => assertDisputeTransitionAllowed("OPEN", "RESOLVED_UPHELD")).not.toThrow();
  });
});
