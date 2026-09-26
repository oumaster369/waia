import { describe, expect, it, vi } from "vitest";

import { executeResolution } from "@/lib/trader/settlement/reconciliation/commands/execute-resolution";
import { proposeResolution } from "@/lib/trader/settlement/reconciliation/commands/propose-resolution";
import { ReconciliationInvoiceNotEligibleError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import { validateManualApplyTarget } from "@/lib/trader/settlement/reconciliation/reconciliation-validation";
import { buildSettlementApplicationPayload } from "@/lib/trader/settlement/serialize-settlement";
import { createReconciliationCommandMemory, RECONCILIATION_TEST_NOW } from "@/tests/helpers/reconciliation-command-memory";

function validate(fixture: ReturnType<typeof createReconciliationCommandMemory>, amount: string | null) {
  return validateManualApplyTarget(fixture.invoiceSettlementRepository, fixture.context, {
    targetInvoiceId: fixture.invoice.id, exchangeAccountId: fixture.invoice.exchangeAccountId,
    settlementValuedAmount: amount,
  });
}
function propose(fixture: ReturnType<typeof createReconciliationCommandMemory>) {
  return proposeResolution({ ...fixture, now: () => RECONCILIATION_TEST_NOW }, fixture.context, fixture.operator, {
    caseId: fixture.caseId, expectedLastEventSeq: 3, idempotencyKey: "propose",
    resolutionType: "MANUAL_APPLY", targetInvoiceId: fixture.invoice.id,
    rationale: "Synthetic exact amount review", coolingOffMs: 1_000,
  });
}
function execute(fixture: ReturnType<typeof createReconciliationCommandMemory>, now = new Date(RECONCILIATION_TEST_NOW.getTime() + 1_000)) {
  const state = fixture.readCase();
  return executeResolution({ ...fixture, now: () => now }, fixture.context, fixture.operator, {
    caseId: fixture.caseId, expectedLastEventSeq: state.lastEventSeq,
    idempotencyKey: "execute", decisionId: state.currentDecisionId!, confirmToken: "synthetic-confirmation",
  });
}

describe("manual reconciliation exact decimal amount boundary", () => {
  it.each([
    ["30", "30.000000"], ["30.000000", "30"], ["30", "30.0"], [".1", "0.10000000"],
    ["9007199254740993", "9007199254740993.00000000"],
    ["0", "-0.00000000"], ["-30", "-30.000000"],
  ])("accepts exactly equal %s / %s and preserves stored fee", async (fee, amount) => {
    const f = createReconciliationCommandMemory(fee, amount);
    await expect(validate(f, amount)).resolves.toEqual({ performanceFee: fee });
    expect(f.invoice.performanceFee).toBe(fee);
    expect(f.invoiceSettlementRepository.markInvoicePaid).not.toHaveBeenCalled();
  });

  it.each(["31", "29.999999", "30.00000001", "29.99999999", "-30"])("rejects unequal amount %s without tolerance", async (amount) => {
    const f = createReconciliationCommandMemory();
    await expect(validate(f, amount)).rejects.toBeInstanceOf(ReconciliationInvoiceNotEligibleError);
    expect(f.invoiceSettlementRepository.markInvoicePaid).not.toHaveBeenCalled();
  });

  it("distinguishes neighboring huge decimals without Number precision loss", async () => {
    const f = createReconciliationCommandMemory("9007199254740993.00000001");
    await expect(validate(f, "9007199254740993.00000002")).rejects.toBeInstanceOf(ReconciliationInvoiceNotEligibleError);
  });

  it.each(["", ".", "-.", "NaN", "Infinity", "1e100", "30.000000001", "30x", "+30"])(
    "rejects invalid equal representations %s", async (amount) => {
      const f = createReconciliationCommandMemory(amount, amount);
      await expect(validate(f, amount)).rejects.toBeInstanceOf(ReconciliationInvoiceNotEligibleError);
      expect(f.invoiceSettlementRepository.markInvoicePaid).not.toHaveBeenCalled();
    },
  );
  it.each([null, undefined, 30, {}, false])("rejects untyped settlement value %s", async (amount) => {
    const f = createReconciliationCommandMemory();
    await expect(validate(f, amount as string | null)).rejects.toBeInstanceOf(ReconciliationInvoiceNotEligibleError);
  });
  it.each([".", "-30", "NaN", "30.000000001"])("rejects invalid stored invoice fee %s", async (fee) => {
    const f = createReconciliationCommandMemory(fee);
    await expect(validate(f, "30")).rejects.toBeInstanceOf(ReconciliationInvoiceNotEligibleError);
  });
  it.each([
    { organizationId: "other-org" }, { exchangeAccountId: "other-account" },
    { status: "DRAFT" }, { status: "PAID" },
  ])("preserves target restrictions %j", async (patch) => {
    const f = createReconciliationCommandMemory(); Object.assign(f.invoice, patch);
    await expect(validateManualApplyTarget(f.invoiceSettlementRepository, f.context, {
      targetInvoiceId: f.invoice.id, exchangeAccountId: "synthetic-account", settlementValuedAmount: "30",
    })).rejects.toBeInstanceOf(ReconciliationInvoiceNotEligibleError);
  });
  it("rejects absent target", async () => {
    const f = createReconciliationCommandMemory();
    vi.mocked(f.invoiceSettlementRepository.getInvoiceForSettlementLock).mockResolvedValue(null);
    await expect(validate(f, "30")).rejects.toBeInstanceOf(ReconciliationInvoiceNotEligibleError);
  });

  it.each(["30", "30.0", "30.000000"])("composes real proposal/execution for %s with unchanged financial content and no duplicate effect", async (amount) => {
    const f = createReconciliationCommandMemory("30", amount);
    const opened = structuredClone(f.events[0]);
    const proposed = await propose(f);
    expect(proposed.case.status).toBe("DECISION_PENDING");
    expect(f.applications).toHaveLength(0);
    expect(f.audits).toHaveLength(1);
    await expect(execute(f, RECONCILIATION_TEST_NOW)).rejects.toThrow("Cooling-off not elapsed");
    const result = await execute(f);
    expect(result.case.status).toBe("RESOLVED");
    expect(f.invoice.performanceFee).toBe("30");
    expect(f.invoice.status).toBe("PAID");
    expect(f.invoice.settledAmount).toBe("30");
    expect(f.applications).toHaveLength(1);
    expect(f.applications[0]).toMatchObject(buildSettlementApplicationPayload({
      settlementId: "synthetic-settlement", organizationId: f.context.organizationId,
      invoiceId: f.invoice.id, appliedAmount: "30", invoiceStatusAfter: "PAID",
    }));
    expect(f.events[0]).toEqual(opened);
    expect(f.invoiceSettlementRepository.markInvoicePaid).toHaveBeenCalledTimes(1);
    const before = { events: f.events.length, audits: f.audits.length };
    await execute(f);
    expect(f.applications).toHaveLength(1);
    expect(f.events).toHaveLength(before.events); expect(f.audits).toHaveLength(before.audits);
  });
  it("execution rechecks changed amount before any application", async () => {
    const f = createReconciliationCommandMemory("30", "30"); await propose(f);
    f.invoice.performanceFee = "31";
    await expect(execute(f)).rejects.toBeInstanceOf(ReconciliationInvoiceNotEligibleError);
    expect(f.applications).toHaveLength(0); expect(f.audits).toHaveLength(1);
    expect(f.invoiceSettlementRepository.markInvoicePaid).not.toHaveBeenCalled();
  });
});
