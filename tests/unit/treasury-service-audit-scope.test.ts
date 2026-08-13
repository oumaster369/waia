import { describe, expect, it } from "vitest";

import { OrgScopeError } from "@/lib/waia-core/scope/org-context";
import { TreasuryNotFoundError, treasuryAuditActions } from "@/lib/waia-core/treasury";
import {
  ORG_A,
  actorA,
  createAuditedTreasuryServices,
  ctxA,
  ctxB,
  usdtAmount,
} from "@/tests/unit/helpers/treasury-wp2";

describe("treasury audit/revision/org-scope contract (DEE-606 WP-2)", () => {
  it("writes a revision and Core audit row for semantic mutations", async () => {
    const { services, audits } = createAuditedTreasuryServices();
    const draft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(1_000_000n),
      reason: "create",
    });
    await services.transactions.submitForReview(ctxA, actorA, {
      transactionId: draft.id,
      reason: "to review",
    });
    await services.transactions.classify(ctxA, actorA, {
      transactionId: draft.id,
      reason: "classify contribution",
      patch: { kind: "CONTRIBUTION", ...usdtAmount(1_000_000n) },
    });
    const revisions = await services.repository.listRevisions(ctxA, draft.id);
    expect(revisions.length).toBeGreaterThanOrEqual(3);
    expect(revisions.every((row) => row.seq === revisions.indexOf(row) + 1 || row.seq >= 1)).toBe(
      true,
    );
    expect(revisions.map((row) => row.seq)).toEqual(
      [...revisions].sort((a, b) => a.seq - b.seq).map((row) => row.seq),
    );
    expect(audits.some((row) => row.action === treasuryAuditActions.transactionManualCreate)).toBe(
      true,
    );
    expect(audits.some((row) => row.action === treasuryAuditActions.transactionClassify)).toBe(
      true,
    );
    expect(audits.every((row) => row.organizationId === ORG_A)).toBe(true);
  });

  it("cannot mutate a wrong-org entity", async () => {
    const { services } = createAuditedTreasuryServices();
    const draft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(1_000_000n),
    });
    await expect(services.transactions.getTransaction(ctxB, draft.id)).rejects.toThrow(
      TreasuryNotFoundError,
    );
    await expect(
      services.transactions.submitForReview(ctxB, actorA, {
        transactionId: draft.id,
        reason: "stolen",
      }),
    ).rejects.toThrow(TreasuryNotFoundError);
  });

  it("rejects unscoped treasury lookups", async () => {
    const { services } = createAuditedTreasuryServices();
    await expect(
      services.transactions.getTransaction({ organizationId: "" }, "any"),
    ).rejects.toThrow(OrgScopeError);
  });

  it("links a correction and reopens VERIFIED into RECONCILIATION_REQUIRED", async () => {
    const { services, audits } = createAuditedTreasuryServices();
    const originalDraft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(5_000_000n),
    });
    await services.transactions.submitForReview(ctxA, actorA, {
      transactionId: originalDraft.id,
      reason: "review",
    });
    await services.transactions.classify(ctxA, actorA, {
      transactionId: originalDraft.id,
      reason: "classify",
      patch: { kind: "CONTRIBUTION", ...usdtAmount(5_000_000n) },
    });
    await services.transactions.verify(ctxA, actorA, {
      transactionId: originalDraft.id,
      reason: "verify",
    });
    const correction = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "OUTFLOW",
      kind: "CORRECTION",
      occurredAt: new Date("2026-08-02T00:00:00.000Z"),
      ...usdtAmount(1_000_000n),
      correctsTransactionId: originalDraft.id,
    });
    await services.transactions.linkCorrection(ctxA, actorA, {
      originalTransactionId: originalDraft.id,
      correctionTransactionId: correction.id,
      reason: "verified mistake",
    });
    const original = await services.transactions.getTransaction(ctxA, originalDraft.id);
    const linked = await services.transactions.getTransaction(ctxA, correction.id);
    expect(original.status).toBe("RECONCILIATION_REQUIRED");
    expect(linked.correctsTransactionId).toBe(original.id);
    expect(
      audits.some((row) => row.action === treasuryAuditActions.transactionCorrectionLink),
    ).toBe(true);
  });
});
