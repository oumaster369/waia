import { describe, expect, it } from "vitest";

import { applyDetailPublicationChange } from "@/lib/waia-core/treasury";
import {
  actorA,
  createAuditedTreasuryServices,
  ctxA,
  usdtAmount,
} from "@/tests/unit/helpers/treasury-wp2";

describe("treasury detail publication orthogonality (DEE-606 WP-2)", () => {
  it("keeps PRIVATE VERIFIED as VERIFIED", async () => {
    const { services } = createAuditedTreasuryServices();
    const draft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(5_000_000n),
      reason: "draft",
    });
    await services.transactions.submitForReview(ctxA, actorA, {
      transactionId: draft.id,
      reason: "review",
    });
    await services.transactions.classify(ctxA, actorA, {
      transactionId: draft.id,
      reason: "classify",
      patch: { kind: "CONTRIBUTION", direction: "INFLOW", ...usdtAmount(5_000_000n) },
    });
    const verified = await services.transactions.verify(ctxA, actorA, {
      transactionId: draft.id,
      reason: "verify",
    });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.detailPublication).toBe("PRIVATE");
    const still = await services.transactions.getTransaction(ctxA, draft.id);
    expect(still.status).toBe("VERIFIED");
    expect(still.detailPublication).toBe("PRIVATE");
  });

  it("DETAIL_PUBLIC does not change accounting state", async () => {
    const { services } = createAuditedTreasuryServices();
    const draft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(2_000_000n),
    });
    await services.transactions.submitForReview(ctxA, actorA, {
      transactionId: draft.id,
      reason: "review",
    });
    const classified = await services.transactions.classify(ctxA, actorA, {
      transactionId: draft.id,
      reason: "classify",
      patch: { kind: "CONTRIBUTION", ...usdtAmount(2_000_000n) },
    });
    const published = await services.transactions.setDetailPublication(ctxA, actorA, {
      transactionId: classified.id,
      detailPublication: "DETAIL_PUBLIC",
      reason: "publish details",
    });
    expect(published.detailPublication).toBe("DETAIL_PUBLIC");
    expect(published.status).toBe("CLASSIFIED");
  });

  it("accounting transition does not auto-publish", async () => {
    const { services } = createAuditedTreasuryServices();
    const draft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(2_000_000n),
    });
    await services.transactions.submitForReview(ctxA, actorA, {
      transactionId: draft.id,
      reason: "review",
    });
    await services.transactions.classify(ctxA, actorA, {
      transactionId: draft.id,
      reason: "classify",
      patch: { kind: "CONTRIBUTION", ...usdtAmount(2_000_000n) },
    });
    const verified = await services.transactions.verify(ctxA, actorA, {
      transactionId: draft.id,
      reason: "verify",
    });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.detailPublication).toBe("PRIVATE");
  });

  it("SUPERSEDED retains history and does not delete the row", async () => {
    const result = applyDetailPublicationChange({
      from: "DETAIL_PUBLIC",
      to: "SUPERSEDED",
      accountingStatus: "VERIFIED",
      supersededById: "newer-tx",
    });
    expect(result.accountingStatus).toBe("VERIFIED");
    expect(result.detailPublication).toBe("SUPERSEDED");
    expect(result.detailSupersededById).toBe("newer-tx");

    const { services } = createAuditedTreasuryServices();
    const draft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(2_000_000n),
    });
    await services.transactions.submitForReview(ctxA, actorA, {
      transactionId: draft.id,
      reason: "review",
    });
    const superseded = await services.transactions.setDetailPublication(ctxA, actorA, {
      transactionId: draft.id,
      detailPublication: "SUPERSEDED",
      supersededById: "correction-row",
      reason: "replaced narrative",
    });
    expect(superseded.detailPublication).toBe("SUPERSEDED");
    expect(superseded.detailSupersededById).toBe("correction-row");
    const retained = await services.transactions.getTransaction(ctxA, draft.id);
    expect(retained.id).toBe(draft.id);
  });
});
