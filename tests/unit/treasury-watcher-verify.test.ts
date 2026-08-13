import { describe, expect, it } from "vitest";

import {
  TreasuryValidationError,
  assertWatcherVerifiedPrecondition,
} from "@/lib/waia-core/treasury";
import {
  ORG_A,
  actorA,
  createAuditedTreasuryServices,
  ctxA,
  seedObservation,
  seedWatcherTransaction,
  usdtAmount,
} from "@/tests/unit/helpers/treasury-wp2";

describe("treasury WATCHER VERIFIED precondition (DEE-606 WP-2)", () => {
  it("allows classify before confirm", async () => {
    const { services } = createAuditedTreasuryServices();
    await seedWatcherTransaction(services.repository, {
      id: "w-classify",
      organizationId: ORG_A,
      status: "NEEDS_REVIEW",
      direction: "INFLOW",
    });
    await seedObservation(services.repository, {
      id: "obs-classify",
      organizationId: ORG_A,
      transactionId: "w-classify",
      observationStatus: "OBSERVED",
      confirmationsObserved: 1,
    });
    const classified = await services.transactions.classify(ctxA, actorA, {
      transactionId: "w-classify",
      reason: "classify while observed",
      patch: {
        kind: "CONTRIBUTION",
        direction: "INFLOW",
        ...usdtAmount(1_000_000n),
      },
    });
    expect(classified.status).toBe("CLASSIFIED");
  });

  it("rejects WATCHER verify with OBSERVED link", async () => {
    const { services } = createAuditedTreasuryServices();
    await seedWatcherTransaction(services.repository, {
      id: "w-obs",
      organizationId: ORG_A,
      status: "CLASSIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
    });
    await seedObservation(services.repository, {
      id: "obs-observed",
      organizationId: ORG_A,
      transactionId: "w-obs",
      observationStatus: "OBSERVED",
      confirmationsObserved: 3,
    });
    await expect(
      services.transactions.verify(ctxA, actorA, { transactionId: "w-obs", reason: "verify" }),
    ).rejects.toThrow(TreasuryValidationError);
  });

  it("rejects WATCHER verify with insufficient confirmations", async () => {
    const { services } = createAuditedTreasuryServices();
    await seedWatcherTransaction(services.repository, {
      id: "w-low",
      organizationId: ORG_A,
      status: "CLASSIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
    });
    await seedObservation(services.repository, {
      id: "obs-low",
      organizationId: ORG_A,
      transactionId: "w-low",
      observationStatus: "CONFIRMED",
      confirmationsObserved: 5,
      confirmationsRequired: 20,
    });
    await expect(
      services.transactions.verify(ctxA, actorA, { transactionId: "w-low", reason: "verify" }),
    ).rejects.toThrow(TreasuryValidationError);
  });

  it("rejects WATCHER verify with no links", async () => {
    const { services } = createAuditedTreasuryServices();
    await seedWatcherTransaction(services.repository, {
      id: "w-none",
      organizationId: ORG_A,
      status: "CLASSIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
    });
    await expect(
      services.transactions.verify(ctxA, actorA, { transactionId: "w-none", reason: "verify" }),
    ).rejects.toThrow(TreasuryValidationError);
  });

  it("allows WATCHER verify when all links are CONFIRMED", async () => {
    const { services } = createAuditedTreasuryServices();
    await seedWatcherTransaction(services.repository, {
      id: "w-ok",
      organizationId: ORG_A,
      status: "CLASSIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
    });
    await seedObservation(services.repository, {
      id: "obs-ok",
      organizationId: ORG_A,
      transactionId: "w-ok",
      observationStatus: "CONFIRMED",
      confirmationsObserved: 20,
    });
    const verified = await services.transactions.verify(ctxA, actorA, {
      transactionId: "w-ok",
      reason: "confirm",
    });
    expect(verified.status).toBe("VERIFIED");
  });

  it("rejects internal transfer when one of two links is unconfirmed", async () => {
    const { services } = createAuditedTreasuryServices();
    await seedWatcherTransaction(services.repository, {
      id: "w-int-1",
      organizationId: ORG_A,
      status: "CLASSIFIED",
      direction: "INTERNAL",
      kind: "INTERNAL_TRANSFER",
      cashEffectMicros: 0n,
    });
    await seedObservation(services.repository, {
      id: "obs-a",
      organizationId: ORG_A,
      transactionId: "w-int-1",
      observationStatus: "CONFIRMED",
      confirmationsObserved: 20,
    });
    await seedObservation(services.repository, {
      id: "obs-b",
      organizationId: ORG_A,
      transactionId: "w-int-1",
      observationStatus: "OBSERVED",
      confirmationsObserved: 2,
    });
    await expect(
      services.transactions.verify(ctxA, actorA, { transactionId: "w-int-1", reason: "verify" }),
    ).rejects.toThrow(TreasuryValidationError);
  });

  it("allows internal transfer when both links are CONFIRMED", async () => {
    const { services } = createAuditedTreasuryServices();
    await seedWatcherTransaction(services.repository, {
      id: "w-int-2",
      organizationId: ORG_A,
      status: "CLASSIFIED",
      direction: "INTERNAL",
      kind: "INTERNAL_TRANSFER",
      cashEffectMicros: 0n,
    });
    await seedObservation(services.repository, {
      id: "obs-a2",
      organizationId: ORG_A,
      transactionId: "w-int-2",
      observationStatus: "CONFIRMED",
      confirmationsObserved: 20,
    });
    await seedObservation(services.repository, {
      id: "obs-b2",
      organizationId: ORG_A,
      transactionId: "w-int-2",
      observationStatus: "CONFIRMED",
      confirmationsObserved: 21,
    });
    const verified = await services.transactions.verify(ctxA, actorA, {
      transactionId: "w-int-2",
      reason: "both confirmed",
    });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.cashEffectMicros).toBe(0n);
  });

  it("ignores caller-provided confirmed flags and reads linked observations", () => {
    expect(() =>
      assertWatcherVerifiedPrecondition({
        provenance: "WATCHER",
        linkedObservations: [],
      }),
    ).toThrow(/WATCHER_VERIFY_NO_LINKS/);
  });
});
