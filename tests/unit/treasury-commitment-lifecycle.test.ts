import { describe, expect, it } from "vitest";

import {
  IllegalTreasuryTransitionError,
  TREASURY_COMMITMENT_STATUSES,
  TreasuryValidationError,
  assertTreasuryCommitmentTransitionAllowed,
  deriveActiveCommittedFundsMicros,
  isActiveCommittedStatus,
  isTreasuryCommitmentTransitionAllowed,
  type TreasuryCommitmentStatus,
} from "@/lib/waia-core/treasury";
import {
  ORG_A,
  ORG_B,
  actorA,
  createAuditedTreasuryServices,
  ctxA,
  ctxB,
  usdtAmount,
} from "@/tests/unit/helpers/treasury-wp2";

const ALLOWED: Array<[TreasuryCommitmentStatus, TreasuryCommitmentStatus]> = [
  ["DRAFT", "APPROVED"],
  ["APPROVED", "RELEASED"],
  ["APPROVED", "CANCELLED"],
  ["RELEASED", "FULFILLED"],
  ["RELEASED", "CANCELLED"],
];
const ALLOWED_SET = new Set(ALLOWED.map(([from, to]) => `${from}->${to}`));
const FORBIDDEN = TREASURY_COMMITMENT_STATUSES.flatMap((from) =>
  TREASURY_COMMITMENT_STATUSES.filter((to) => !ALLOWED_SET.has(`${from}->${to}`)).map(
    (to) => [from, to] as [TreasuryCommitmentStatus, TreasuryCommitmentStatus],
  ),
);

describe("treasury commitment lifecycle (DEE-606 WP-2)", () => {
  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(isTreasuryCommitmentTransitionAllowed(from, to)).toBe(true);
    expect(() => assertTreasuryCommitmentTransitionAllowed("c1", from, to, "reason")).not.toThrow();
  });

  it.each(FORBIDDEN)("forbids %s -> %s", (from, to) => {
    expect(isTreasuryCommitmentTransitionAllowed(from, to)).toBe(false);
    expect(() => assertTreasuryCommitmentTransitionAllowed("c1", from, to, "reason")).toThrow(
      IllegalTreasuryTransitionError,
    );
  });

  it("counts APPROVED and RELEASED as active committed funds", () => {
    expect(isActiveCommittedStatus("APPROVED")).toBe(true);
    expect(isActiveCommittedStatus("RELEASED")).toBe(true);
    expect(isActiveCommittedStatus("DRAFT")).toBe(false);
    expect(isActiveCommittedStatus("FULFILLED")).toBe(false);
    expect(isActiveCommittedStatus("CANCELLED")).toBe(false);
    expect(
      deriveActiveCommittedFundsMicros([
        { status: "DRAFT", amountMicros: 10n } as never,
        { status: "APPROVED", amountMicros: 3n } as never,
        { status: "RELEASED", amountMicros: 4n } as never,
        { status: "FULFILLED", amountMicros: 9n } as never,
        { status: "CANCELLED", amountMicros: 8n } as never,
      ]),
    ).toBe(7n);
  });

  it("requires reason for RELEASED -> CANCELLED", () => {
    expect(() =>
      assertTreasuryCommitmentTransitionAllowed("c1", "RELEASED", "CANCELLED", ""),
    ).toThrow(TreasuryValidationError);
  });

  it("runs create/approve/release/fulfill/cancel with audit and same-org fulfillment", async () => {
    const { services, audits } = createAuditedTreasuryServices();
    const expenseDraft = await services.transactions.createManualDraft(ctxA, actorA, {
      direction: "OUTFLOW",
      kind: "EXPENSE",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(3_000_000n),
    });
    await services.transactions.submitForReview(ctxA, actorA, {
      transactionId: expenseDraft.id,
      reason: "review",
    });
    await services.transactions.classify(ctxA, actorA, {
      transactionId: expenseDraft.id,
      reason: "classify",
      patch: { kind: "EXPENSE", direction: "OUTFLOW", ...usdtAmount(3_000_000n) },
    });
    const expense = await services.transactions.verify(ctxA, actorA, {
      transactionId: expenseDraft.id,
      reason: "verify expense",
    });

    const draft = await services.commitments.createDraft(ctxA, actorA, {
      amountMicros: 3_000_000n,
      purpose: "vendor",
      reason: "create",
    });
    expect(isActiveCommittedStatus(draft.status)).toBe(false);
    const approved = await services.commitments.approve(ctxA, actorA, {
      commitmentId: draft.id,
      reason: "approve",
    });
    expect(approved.status).toBe("APPROVED");
    expect(await services.commitments.activeCommittedFundsMicros(ctxA)).toBe(3_000_000n);
    const released = await services.commitments.release(ctxA, actorA, {
      commitmentId: draft.id,
      reason: "release",
    });
    expect(released.status).toBe("RELEASED");
    expect(await services.commitments.activeCommittedFundsMicros(ctxA)).toBe(3_000_000n);
    const fulfilled = await services.commitments.fulfill(ctxA, actorA, {
      commitmentId: draft.id,
      fulfillsTransactionId: expense.id,
      reason: "paid",
    });
    expect(fulfilled.status).toBe("FULFILLED");
    expect(await services.commitments.activeCommittedFundsMicros(ctxA)).toBe(0n);
    expect(audits.some((row) => row.action === "treasury.commitment.fulfill")).toBe(true);

    const cancelDraft = await services.commitments.createDraft(ctxA, actorA, {
      amountMicros: 1n,
      purpose: "cancel-me",
    });
    await services.commitments.approve(ctxA, actorA, {
      commitmentId: cancelDraft.id,
      reason: "approve",
    });
    await services.commitments.release(ctxA, actorA, {
      commitmentId: cancelDraft.id,
      reason: "release",
    });
    await expect(
      services.commitments.cancel(ctxA, actorA, { commitmentId: cancelDraft.id, reason: "" }),
    ).rejects.toThrow(TreasuryValidationError);
    const cancelled = await services.commitments.cancel(ctxA, actorA, {
      commitmentId: cancelDraft.id,
      reason: "explicit cancel",
    });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("rejects fulfillment against another organization's transaction", async () => {
    const { services } = createAuditedTreasuryServices();
    const foreign = await services.transactions.createManualDraft(ctxB, actorA, {
      direction: "OUTFLOW",
      kind: "EXPENSE",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      ...usdtAmount(1_000_000n),
    });
    const commitment = await services.commitments.createDraft(ctxA, actorA, {
      amountMicros: 1_000_000n,
      purpose: "same-org only",
    });
    await services.commitments.approve(ctxA, actorA, { commitmentId: commitment.id, reason: "a" });
    await services.commitments.release(ctxA, actorA, { commitmentId: commitment.id, reason: "r" });
    await expect(
      services.commitments.fulfill(ctxA, actorA, {
        commitmentId: commitment.id,
        fulfillsTransactionId: foreign.id,
        reason: "cross-org",
      }),
    ).rejects.toThrow();
    expect(ORG_A).not.toBe(ORG_B);
  });
});
