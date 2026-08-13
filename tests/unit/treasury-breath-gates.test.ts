import { describe, expect, it } from "vitest";

import { BREATH_RECON_MAX_AGE_MS } from "@/lib/waia-core/treasury/breath/types";
import { getBreathPublicSnapshot } from "@/lib/waia-core/treasury";
import {
  INCEPTION_A,
  NOW,
  createWp6Bundle,
  ctxA,
  exactlyTenMinutesAgo,
  seedIdeal,
  seedInception,
  seedRecon,
  seedSettings,
  seedTx,
  staleReconTime,
  IDEAL_A,
} from "@/tests/unit/helpers/treasury-wp6";

describe("DEE-606 WP-6 publication gates and privacy", () => {
  it("42-61 global Breath gates, recon freshness, MATCHED and PENDING_CONFIRMATIONS", async () => {
    const disabled = createWp6Bundle();
    await seedSettings(disabled.services, { breathEnabled: false });
    await seedIdeal(disabled.services, { id: IDEAL_A });
    await seedInception(disabled.services);
    await seedRecon(disabled.services);
    const off = await disabled.services.breath.getAdminPreview(ctxA);
    expect(off.status).toBe("pending");
    expect(off.pendingReasons).toContain("BREATH_DISABLED");
    expect(off.resources).toBeNull();
    expect(off.currentFreeFunds).toBeNull();
    expect(off.budget).toBeNull();
    expect(off.idealAnnualBudget).toBeNull();

    const missingIdeal = createWp6Bundle();
    await seedSettings(missingIdeal.services);
    await seedInception(missingIdeal.services);
    await seedRecon(missingIdeal.services);
    const noIdeal = await missingIdeal.services.breath.getAdminPreview(ctxA);
    expect(noIdeal.status).toBe("pending");
    expect(noIdeal.pendingReasons).toContain("IDEAL_BUDGET_MISSING");

    const twoIdeals = createWp6Bundle();
    await seedSettings(twoIdeals.services);
    await seedIdeal(twoIdeals.services, { id: IDEAL_A, periodYear: 2026 });
    await seedIdeal(twoIdeals.services, {
      id: "idebbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      periodYear: 2027,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    });
    await seedInception(twoIdeals.services);
    await seedRecon(twoIdeals.services);
    const ambIdeal = await twoIdeals.services.breath.getAdminPreview(ctxA);
    expect(ambIdeal.status).toBe("pending");
    expect(ambIdeal.pendingReasons).toContain("IDEAL_BUDGET_AMBIGUOUS");

    const material = createWp6Bundle();
    await seedSettings(material.services);
    await seedIdeal(material.services, { id: IDEAL_A });
    await seedInception(material.services);
    await seedRecon(material.services);
    await seedTx(material.services, {
      id: "recon-req",
      status: "RECONCILIATION_REQUIRED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      cashEffectMicros: 1_000_000n,
    });
    const blocked = await material.services.breath.getAdminPreview(ctxA);
    expect(blocked.status).toBe("pending");
    expect(blocked.pendingReasons).toContain("MATERIAL_RECONCILIATION_REQUIRED");

    const unknown = createWp6Bundle();
    await seedSettings(unknown.services);
    await seedIdeal(unknown.services, { id: IDEAL_A });
    await seedInception(unknown.services);
    await seedRecon(unknown.services);
    await seedTx(unknown.services, {
      id: "unknown-recon",
      status: "RECONCILIATION_REQUIRED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      cashEffectMicros: null,
    });
    expect((await unknown.services.breath.getAdminPreview(ctxA)).pendingReasons).toContain(
      "MATERIAL_RECONCILIATION_REQUIRED",
    );

    const internal = createWp6Bundle();
    await seedSettings(internal.services);
    await seedIdeal(internal.services, { id: IDEAL_A });
    await seedInception(internal.services);
    await seedRecon(internal.services);
    await seedTx(internal.services, {
      id: "internal-recon",
      status: "RECONCILIATION_REQUIRED",
      direction: "INTERNAL",
      kind: "INTERNAL_TRANSFER",
      cashEffectMicros: 0n,
    });
    const internalPreview = await internal.services.breath.getAdminPreview(ctxA);
    expect(internalPreview.pendingReasons).not.toContain("MATERIAL_RECONCILIATION_REQUIRED");
    expect(internalPreview.status).toBe("published");

    const missingRecon = createWp6Bundle();
    await seedSettings(missingRecon.services);
    await seedIdeal(missingRecon.services, { id: IDEAL_A });
    await seedInception(missingRecon.services);
    expect((await missingRecon.services.breath.getAdminPreview(ctxA)).pendingReasons).toContain(
      "BALANCE_RECONCILIATION_MISSING",
    );

    async function gateStatus(status: "UNAVAILABLE" | "MISMATCH") {
      const bundle = createWp6Bundle();
      await seedSettings(bundle.services);
      await seedIdeal(bundle.services, { id: IDEAL_A });
      await seedInception(bundle.services);
      await seedRecon(bundle.services, { status, deltaMicros: 1n, unexplainedResidualMicros: 1n });
      return bundle.services.breath.getAdminPreview(ctxA);
    }
    expect((await gateStatus("UNAVAILABLE")).pendingReasons).toContain(
      "BALANCE_RECONCILIATION_UNAVAILABLE",
    );
    expect((await gateStatus("MISMATCH")).pendingReasons).toContain(
      "BALANCE_RECONCILIATION_MISMATCH",
    );

    const stale = createWp6Bundle();
    await seedSettings(stale.services);
    await seedIdeal(stale.services, { id: IDEAL_A });
    await seedInception(stale.services);
    await seedRecon(stale.services, { createdAt: staleReconTime(NOW) });
    expect((await stale.services.breath.getAdminPreview(ctxA)).pendingReasons).toContain(
      "BALANCE_RECONCILIATION_STALE",
    );

    const exact = createWp6Bundle();
    await seedSettings(exact.services);
    await seedIdeal(exact.services, { id: IDEAL_A });
    await seedInception(exact.services);
    await seedRecon(exact.services, { createdAt: exactlyTenMinutesAgo(NOW) });
    const exactPreview = await exact.services.breath.getAdminPreview(ctxA);
    expect(exactPreview.pendingReasons).not.toContain("BALANCE_RECONCILIATION_STALE");
    expect(exactPreview.status).toBe("published");
    expect(BREATH_RECON_MAX_AGE_MS).toBe(10 * 60 * 1000);

    const matched = createWp6Bundle();
    await seedSettings(matched.services);
    await seedIdeal(matched.services, { id: IDEAL_A });
    await seedInception(matched.services);
    await seedRecon(matched.services, {
      status: "MATCHED",
      observedOnchainBalanceAtomic: 5n,
      accountingCashBalanceMicros: 5n,
      deltaMicros: 0n,
      unexplainedResidualMicros: 0n,
    });
    expect((await matched.services.breath.getAdminPreview(ctxA)).status).toBe("published");

    const inconsistent = createWp6Bundle();
    await seedSettings(inconsistent.services);
    await seedIdeal(inconsistent.services, { id: IDEAL_A });
    await seedInception(inconsistent.services);
    await seedRecon(inconsistent.services, {
      status: "MATCHED",
      observedOnchainBalanceAtomic: 10n,
      accountingCashBalanceMicros: 5n,
      deltaMicros: 0n,
      unexplainedResidualMicros: 0n,
    });
    expect((await inconsistent.services.breath.getAdminPreview(ctxA)).status).toBe("pending");

    const pendingOk = createWp6Bundle();
    await seedSettings(pendingOk.services);
    await seedIdeal(pendingOk.services, { id: IDEAL_A });
    await seedInception(pendingOk.services);
    await seedRecon(pendingOk.services, {
      status: "PENDING_CONFIRMATIONS",
      observedOnchainBalanceAtomic: 10n,
      accountingCashBalanceMicros: 6n,
      deltaMicros: 4n,
      explainedPendingMicros: 4n,
      unexplainedResidualMicros: 0n,
      toleranceMicros: 0n,
    });
    expect((await pendingOk.services.breath.getAdminPreview(ctxA)).status).toBe("published");

    const residual = createWp6Bundle();
    await seedSettings(residual.services);
    await seedIdeal(residual.services, { id: IDEAL_A });
    await seedInception(residual.services);
    await seedRecon(residual.services, {
      status: "PENDING_CONFIRMATIONS",
      deltaMicros: 4n,
      explainedPendingMicros: 4n,
      unexplainedResidualMicros: 1n,
    });
    expect((await residual.services.breath.getAdminPreview(ctxA)).pendingReasons).toContain(
      "BALANCE_RECONCILIATION_PENDING_UNEXPLAINED",
    );

    const deltaMismatch = createWp6Bundle();
    await seedSettings(deltaMismatch.services);
    await seedIdeal(deltaMismatch.services, { id: IDEAL_A });
    await seedInception(deltaMismatch.services);
    await seedRecon(deltaMismatch.services, {
      status: "PENDING_CONFIRMATIONS",
      deltaMicros: 4n,
      explainedPendingMicros: 3n,
      unexplainedResidualMicros: 0n,
    });
    expect((await deltaMismatch.services.breath.getAdminPreview(ctxA)).pendingReasons).toContain(
      "BALANCE_RECONCILIATION_PENDING_UNEXPLAINED",
    );

    const tol = createWp6Bundle();
    await seedSettings(tol.services);
    await seedIdeal(tol.services, { id: IDEAL_A });
    await seedInception(tol.services);
    await seedRecon(tol.services, {
      status: "MATCHED",
      observedOnchainBalanceAtomic: 5n,
      accountingCashBalanceMicros: 5n,
      deltaMicros: 0n,
      unexplainedResidualMicros: 0n,
      toleranceMicros: 1n,
    });
    expect((await tol.services.breath.getAdminPreview(ctxA)).status).toBe("pending");

    const scope = createWp6Bundle();
    await seedSettings(scope.services);
    await seedIdeal(scope.services, { id: IDEAL_A });
    await seedInception(scope.services, { id: INCEPTION_A, status: "ACTIVE" });
    await seedRecon(scope.services, { ledgerInceptionId: "otheraaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9" });
    expect((await scope.services.breath.getAdminPreview(ctxA)).pendingReasons).toContain(
      "BALANCE_RECONCILIATION_SCOPE_INVALID",
    );

    const latestWins = createWp6Bundle();
    await seedSettings(latestWins.services);
    await seedIdeal(latestWins.services, { id: IDEAL_A });
    await seedInception(latestWins.services);
    await seedRecon(latestWins.services, {
      id: "old-good",
      status: "MATCHED",
      observedOnchainBalanceAtomic: 1n,
      accountingCashBalanceMicros: 1n,
      deltaMicros: 0n,
      createdAt: new Date(NOW.getTime() - 1000),
    });
    await seedRecon(latestWins.services, {
      id: "new-bad",
      status: "MISMATCH",
      deltaMicros: 9n,
      unexplainedResidualMicros: 9n,
      createdAt: NOW,
    });
    expect((await latestWins.services.breath.getAdminPreview(ctxA)).pendingReasons).toContain(
      "BALANCE_RECONCILIATION_MISMATCH",
    );
  });

  it("62-74 recent activity filter and public privacy projection", async () => {
    const { services } = createWp6Bundle();
    await seedSettings(services, { recentActivityLimit: 2 });
    await seedIdeal(services, { id: IDEAL_A });
    await seedInception(services);
    await seedRecon(services);
    await seedTx(services, {
      id: "pub-1",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      detailPublication: "DETAIL_PUBLIC",
      publicDescription: "public one",
      counterpartyDisplay: "Alice",
      publishCounterparty: true,
      occurredAt: new Date("2026-08-13T11:00:00.000Z"),
      internalNotes: "SECRET_NOTE",
    });
    await seedTx(services, {
      id: "priv",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      detailPublication: "PRIVATE",
      publicDescription: "hidden",
      occurredAt: new Date("2026-08-13T11:30:00.000Z"),
    });
    await seedTx(services, {
      id: "unverified",
      status: "NEEDS_REVIEW",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      detailPublication: "DETAIL_PUBLIC",
      publicDescription: "not verified",
    });
    await seedTx(services, {
      id: "superseded",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      detailPublication: "SUPERSEDED",
      detailSupersededById: "pub-1",
      publicDescription: "old",
      occurredAt: new Date("2026-08-13T12:00:00.000Z"),
    });
    await seedTx(services, {
      id: "pub-2",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      detailPublication: "DETAIL_PUBLIC",
      publicDescription: "public two",
      publishCounterparty: false,
      counterpartyDisplay: "Bob",
      occurredAt: new Date("2026-08-13T10:00:00.000Z"),
    });
    await seedTx(services, {
      id: "pub-3",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      detailPublication: "DETAIL_PUBLIC",
      publicDescription: "public three",
      occurredAt: new Date("2026-08-13T09:00:00.000Z"),
    });
    const preview = await services.breath.getAdminPreview(ctxA);
    expect(preview.recentActivity.map((row) => row.publicDescription)).toEqual([
      "public one",
      "public two",
    ]);
    expect(preview.recentActivity[0]?.counterpartyDisplay).toBe("Alice");
    expect(preview.recentActivity[1]?.counterpartyDisplay).toBeNull();
    const publicSnap = await getBreathPublicSnapshot(ctxA, services.breath);
    const blob = JSON.stringify(publicSnap);
    expect(blob).not.toContain("SECRET_NOTE");
    expect(blob).not.toContain("verifiedByUserId");
    expect(blob).not.toContain(JSON.stringify({ verifiedByUserId: expect.anything() }));
    expect(blob).not.toContain("createdByUserId");
    expect(blob).not.toContain("uploadedByUserId");
    expect(blob).not.toContain("objectKey");
    expect(blob).not.toContain("contributorUserId");
    expect(blob).not.toContain("watched");
    expect(blob).not.toContain("internal recon notes");
    expect(publicSnap).not.toHaveProperty("pendingReasons");
    expect(publicSnap).not.toHaveProperty("componentStatus");
    expect("verifiedByUserId" in publicSnap).toBe(false);
  });
});
