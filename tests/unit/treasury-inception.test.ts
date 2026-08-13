import { describe, expect, it } from "vitest";

import { TreasuryValidationError } from "@/lib/waia-core/treasury";
import {
  ORG_A,
  ORG_B,
  actorA,
  createAuditedTreasuryServices,
  ctxA,
  ctxB,
  usdtAmount,
} from "@/tests/unit/helpers/treasury-wp2";

async function verifiedOpeningBalance(
  services: ReturnType<typeof createAuditedTreasuryServices>["services"],
  organizationId: string,
  context: { organizationId: string },
) {
  const draft = await services.transactions.createManualDraft(context, actorA, {
    direction: "INFLOW",
    kind: "OPENING_BALANCE",
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    ...usdtAmount(10_000_000n),
  });
  await services.transactions.submitForReview(context, actorA, {
    transactionId: draft.id,
    reason: "review",
  });
  await services.transactions.classify(context, actorA, {
    transactionId: draft.id,
    reason: "classify",
    patch: { kind: "OPENING_BALANCE", direction: "INFLOW", ...usdtAmount(10_000_000n) },
  });
  await services.repository.insertEvidenceLink({
    id: `${draft.id}-ev`,
    organizationId,
    transactionId: draft.id,
    evidenceObjectId: `${draft.id}-obj`,
  });
  return services.transactions.verify(context, actorA, {
    transactionId: draft.id,
    reason: "verify opening",
  });
}

describe("treasury ledger inception (DEE-606 WP-2)", () => {
  it("requires VERIFIED evidence-backed same-org OPENING_BALANCE", async () => {
    const { services } = createAuditedTreasuryServices();
    const opening = await verifiedOpeningBalance(services, ORG_A, ctxA);
    const inception = await services.inceptions.createActive(ctxA, actorA, {
      network: "TRC-20",
      tokenContract: "TUSDT",
      assetCode: "USDT",
      inceptionBlock: "100",
      inceptionTime: new Date("2026-01-01T00:00:00.000Z"),
      openingBalanceTransactionId: opening.id,
      watcherStartBlock: "101",
      reason: "activate",
    });
    expect(inception.status).toBe("ACTIVE");
    expect(inception.approvedByUserId).toBe(actorA.actorUserId);
  });

  it("rejects opening balance from another org", async () => {
    const { services } = createAuditedTreasuryServices();
    const foreign = await verifiedOpeningBalance(services, ORG_B, ctxB);
    await expect(
      services.inceptions.createActive(ctxA, actorA, {
        network: "TRC-20",
        tokenContract: "TUSDT",
        assetCode: "USDT",
        inceptionBlock: "100",
        inceptionTime: new Date("2026-01-01T00:00:00.000Z"),
        openingBalanceTransactionId: foreign.id,
        watcherStartBlock: "101",
        reason: "cross-org",
      }),
    ).rejects.toThrow();
  });

  it("rejects opening balance that is not evidence-backed", async () => {
    const { services } = createAuditedTreasuryServices();
    const draft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      ...usdtAmount(10_000_000n),
    });
    await services.transactions.submitForReview(ctxA, actorA, {
      transactionId: draft.id,
      reason: "review",
    });
    await services.transactions.classify(ctxA, actorA, {
      transactionId: draft.id,
      reason: "classify",
      patch: { kind: "OPENING_BALANCE", ...usdtAmount(10_000_000n) },
    });
    await expect(
      services.transactions.verify(ctxA, actorA, {
        transactionId: draft.id,
        reason: "no evidence",
      }),
    ).rejects.toThrow(TreasuryValidationError);
  });

  it("rejects watcher_start_block <= inception_block", async () => {
    const { services } = createAuditedTreasuryServices();
    const opening = await verifiedOpeningBalance(services, ORG_A, ctxA);
    await expect(
      services.inceptions.createActive(ctxA, actorA, {
        network: "TRC-20",
        tokenContract: "TUSDT",
        assetCode: "USDT",
        inceptionBlock: "200",
        inceptionTime: new Date("2026-01-01T00:00:00.000Z"),
        openingBalanceTransactionId: opening.id,
        watcherStartBlock: "200",
        reason: "bad start",
      }),
    ).rejects.toThrow(/WATCHER_START_NOT_AFTER_INCEPTION/);
  });

  it("rejects a second ACTIVE inception without supersede", async () => {
    const { services } = createAuditedTreasuryServices();
    const opening = await verifiedOpeningBalance(services, ORG_A, ctxA);
    await services.inceptions.createActive(ctxA, actorA, {
      network: "TRC-20",
      tokenContract: "TUSDT",
      assetCode: "USDT",
      inceptionBlock: "10",
      inceptionTime: new Date("2026-01-01T00:00:00.000Z"),
      openingBalanceTransactionId: opening.id,
      watcherStartBlock: "11",
      reason: "first",
    });
    const opening2 = await verifiedOpeningBalance(services, ORG_A, ctxA);
    await expect(
      services.inceptions.createActive(ctxA, actorA, {
        network: "TRC-20",
        tokenContract: "TUSDT",
        assetCode: "USDT",
        inceptionBlock: "20",
        inceptionTime: new Date("2026-02-01T00:00:00.000Z"),
        openingBalanceTransactionId: opening2.id,
        watcherStartBlock: "21",
        reason: "second",
      }),
    ).rejects.toThrow(/INCEPTION_ACTIVE_EXISTS/);
  });

  it("allows explicit supersede/replacement and does not seed watcher checkpoints", async () => {
    const { services, audits } = createAuditedTreasuryServices();
    const opening = await verifiedOpeningBalance(services, ORG_A, ctxA);
    const first = await services.inceptions.createActive(ctxA, actorA, {
      network: "TRC-20",
      tokenContract: "TUSDT",
      assetCode: "USDT",
      inceptionBlock: "10",
      inceptionTime: new Date("2026-01-01T00:00:00.000Z"),
      openingBalanceTransactionId: opening.id,
      watcherStartBlock: "11",
      reason: "first",
    });
    const opening2 = await verifiedOpeningBalance(services, ORG_A, ctxA);
    const replacement = await services.inceptions.replaceActive(ctxA, actorA, {
      supersedeInceptionId: first.id,
      network: "TRC-20",
      tokenContract: "TUSDT",
      assetCode: "USDT",
      inceptionBlock: "50",
      inceptionTime: new Date("2026-03-01T00:00:00.000Z"),
      openingBalanceTransactionId: opening2.id,
      watcherStartBlock: "51",
      reason: "rebase",
    });
    expect(replacement.status).toBe("ACTIVE");
    const superseded = await services.repository.getInception(ctxA, first.id);
    expect(superseded?.status).toBe("SUPERSEDED");
    expect(audits.some((row) => row.action === "treasury.inception.supersede")).toBe(true);
    expect(Object.keys(services.repository)).not.toContain("seedWatcherCheckpoint");
  });
});
