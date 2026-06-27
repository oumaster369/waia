import { describe, expect, it } from "vitest";

import { computeReconciliationPriority } from "@/lib/trader/settlement/reconciliation/reconciliation-priority";
import { settlementExceptionReasons } from "@/lib/trader/settlement/settlement.types";

describe("reconciliation priority", () => {
  const openedAt = new Date("2026-06-01T00:00:00.000Z");

  it("assigns highest priority to amount mismatch and missing attribution", () => {
    const amount = computeReconciliationPriority({
      exceptionReason: settlementExceptionReasons.amountMismatch,
      openedAt,
    });
    const attribution = computeReconciliationPriority({
      exceptionReason: settlementExceptionReasons.missingAttribution,
      openedAt,
    });
    const unsupported = computeReconciliationPriority({
      exceptionReason: settlementExceptionReasons.unsupportedAssetOrNetwork,
      openedAt,
    });
    expect(amount).toBeGreaterThan(unsupported);
    expect(attribution).toBeGreaterThan(unsupported);
  });

  it("bumps priority for aged cases", () => {
    const fresh = computeReconciliationPriority({
      exceptionReason: settlementExceptionReasons.noCandidateInvoice,
      openedAt,
      now: new Date("2026-06-02T00:00:00.000Z"),
    });
    const aged = computeReconciliationPriority({
      exceptionReason: settlementExceptionReasons.noCandidateInvoice,
      openedAt,
      now: new Date("2026-06-10T00:00:00.000Z"),
    });
    expect(aged).toBeGreaterThan(fresh);
  });
});
