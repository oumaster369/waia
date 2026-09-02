import { describe, expect, it } from "vitest";

import { handleTreasuryRunwayPlanCommandsPost } from "@/lib/waia-core/treasury/admin/handlers";
import { createMemoryTreasuryBreathFactsRepository } from "@/lib/waia-core/treasury/breath/memory-repository";
import { createTreasuryBreathReadModel } from "@/lib/waia-core/treasury/breath/read-model";
import type { BreathFactsRepository } from "@/lib/waia-core/treasury/breath/repository.types";
import { BREATH_DAY_MS } from "@/lib/waia-core/treasury/breath/types";
import {
  computeRunwayEndsAt,
  computeRunwayInputDigest,
} from "@/lib/waia-core/treasury/breath/runway";
import { createWp4Deps, jsonRequest } from "@/tests/unit/helpers/treasury-wp4";
import {
  NOW,
  PLAN_A,
  PLAN_B,
  createWp6Bundle,
  ctxA,
  seedCommitment,
  seedPlan,
  seedPublishableControl,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp6";

const PUBLISH = ["admin.treasury.read", "admin.treasury.mutate", "admin.treasury.publish"] as const;
const MUTATE = ["admin.treasury.read", "admin.treasury.mutate"] as const;

describe("DEE-606 WP-6 deterministic runway snapshots", () => {
  it("75-94 plan selection, digest, integer-ms floor, no sliding countdown", async () => {
    const none = createWp6Bundle();
    await seedPublishableControl(none.services);
    const pending = await none.services.breath.getAdminPreview(ctxA);
    expect(pending.runway.status).toBe("pending");
    expect(pending.status).toBe("published");

    const { services, clock } = createWp6Bundle();
    await seedPublishableControl(services);
    await seedTx(services, {
      id: "cash",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      cashEffectMicros: 2_000_000n,
      accountingAmountMicros: 2_000_000n,
      recordContentDigest: "cash-a",
    });
    await seedPlan(services, { id: PLAN_A, dailyBurnMicros: 1_000_000n });
    const first = await services.breath.getAdminPreview(ctxA);
    expect(first.runway.status).toBe("available");
    if (first.runway.status !== "available") throw new Error("expected available runway");
    expect(first.runway.freeFundsAtAsOf).toBe("2000000");
    expect(first.runway.approvedDailyBurn).toBe("1000000");
    const snapshotId = first.runwayStatus.snapshotId;
    const asOf = first.runway.runwayAsOf;
    const endsAt = first.runway.endsAt;
    clock.set(new Date(NOW.getTime() + 60_000));
    const second = await services.breath.getAdminPreview(ctxA);
    expect(second.runwayStatus.snapshotId).toBe(snapshotId);
    if (second.runway.status !== "available") throw new Error("expected available runway");
    expect(second.runway.runwayAsOf).toBe(asOf);
    expect(second.runway.endsAt).toBe(endsAt);

    await seedTx(services, {
      id: "inflow-2",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      cashEffectMicros: 1_000_000n,
      accountingAmountMicros: 1_000_000n,
      recordContentDigest: "cash-b",
    });
    const afterInflow = await services.breath.getAdminPreview(ctxA);
    expect(afterInflow.runwayStatus.snapshotId).not.toBe(snapshotId);
    if (afterInflow.runway.status !== "available") throw new Error("expected available");
    expect(afterInflow.runway.freeFundsAtAsOf).toBe("3000000");

    const afterOutflowId = afterInflow.runwayStatus.snapshotId;
    await seedTx(services, {
      id: "out-1",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      cashEffectMicros: -500_000n,
      accountingAmountMicros: 500_000n,
    });
    const afterOut = await services.breath.getAdminPreview(ctxA);
    expect(afterOut.runwayStatus.snapshotId).not.toBe(afterOutflowId);

    const beforeCommit = afterOut.runwayStatus.snapshotId;
    await seedCommitment(services, { id: "c-appr", status: "APPROVED", amountMicros: 200_000n });
    const afterCommit = await services.breath.getAdminPreview(ctxA);
    expect(afterCommit.runwayStatus.snapshotId).not.toBe(beforeCommit);

    const beforeCancel = afterCommit.runwayStatus.snapshotId;
    await services.domain.repository.updateCommitment(ctxA, "c-appr", { status: "CANCELLED" });
    const afterCancel = await services.breath.getAdminPreview(ctxA);
    expect(afterCancel.runwayStatus.snapshotId).not.toBe(beforeCancel);

    const beforePlan = afterCancel.runwayStatus.snapshotId;
    await services.catalogRepo.updateRunwayPlan(ctxA, PLAN_A, { status: "SUPERSEDED" });
    await seedPlan(services, { id: PLAN_B, dailyBurnMicros: 2_000_000n });
    const afterPlan = await services.breath.getAdminPreview(ctxA);
    expect(afterPlan.runwayStatus.snapshotId).not.toBe(beforePlan);

    const offset = createWp6Bundle();
    await seedPublishableControl(offset.services);
    await seedPlan(offset.services, { id: PLAN_A, dailyBurnMicros: 1_000_000n });
    await seedTx(offset.services, {
      id: "a",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      cashEffectMicros: 5_000_000n,
      accountingAmountMicros: 5_000_000n,
      recordContentDigest: "a",
    });
    const mid = await offset.services.breath.getAdminPreview(ctxA);
    const midDigest = mid.runwayStatus.snapshotId;
    await seedTx(offset.services, {
      id: "b-in",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      cashEffectMicros: 1_000_000n,
      accountingAmountMicros: 1_000_000n,
      recordContentDigest: "b",
    });
    await seedTx(offset.services, {
      id: "b-out",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      cashEffectMicros: -1_000_000n,
      accountingAmountMicros: 1_000_000n,
      recordContentDigest: "c",
    });
    const afterOffset = await offset.services.breath.getAdminPreview(ctxA);
    expect(afterOffset.runwayStatus.snapshotId).not.toBe(midDigest);
    if (mid.runway.status === "available" && afterOffset.runway.status === "available") {
      expect(afterOffset.runway.freeFundsAtAsOf).toBe(mid.runway.freeFundsAtAsOf);
    }

    const plan = {
      id: PLAN_A,
      organizationId: "org",
      method: "APPROVED_PLANNED_BURN",
      currency: "USD",
      dailyBurnMicros: 1n,
      effectiveFrom: NOW,
      effectiveTo: null,
      status: "ACTIVE" as const,
      createdByUserId: "u",
      approvedByUserId: "u",
      createdAt: NOW,
    };
    const txA = {
      id: "z",
      cashEffectMicros: 1n,
      recordContentDigest: "z",
      verifiedAt: NOW,
      updatedAt: NOW,
      status: "VERIFIED" as const,
    };
    const txB = {
      id: "a",
      cashEffectMicros: 2n,
      recordContentDigest: "a",
      verifiedAt: NOW,
      updatedAt: NOW,
      status: "VERIFIED" as const,
    };
    const d1 = computeRunwayInputDigest({
      verified: [txA, txB] as never,
      commitments: [],
      plan,
      freeFundsAtAsOfMicros: 3n,
    });
    const d2 = computeRunwayInputDigest({
      verified: [txB, txA] as never,
      commitments: [],
      plan,
      freeFundsAtAsOfMicros: 3n,
    });
    expect(d1).toBe(d2);

    const ends = computeRunwayEndsAt({
      runwayAsOf: NOW,
      freeFundsAtAsOfMicros: 2_000_000n,
      approvedDailyBurnMicros: 1_000_000n,
    });
    expect(ends.getTime()).toBe(NOW.getTime() + Number((2_000_000n * BREATH_DAY_MS) / 1_000_000n));
    const floored = computeRunwayEndsAt({
      runwayAsOf: NOW,
      freeFundsAtAsOfMicros: 1n,
      approvedDailyBurnMicros: BREATH_DAY_MS + 1n,
    });
    expect(floored.getTime()).toBe(NOW.getTime());

    expect(() =>
      computeRunwayEndsAt({
        runwayAsOf: NOW,
        freeFundsAtAsOfMicros: 10n ** 18n,
        approvedDailyBurnMicros: 1n,
      }),
    ).toThrow(/RUNWAY_DATE_OUT_OF_RANGE/);

    const overflow = createWp6Bundle();
    await seedPublishableControl(overflow.services);
    await seedTx(overflow.services, {
      id: "huge-cash",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      cashEffectMicros: 10n ** 18n,
      accountingAmountMicros: 10n ** 18n,
    });
    await seedPlan(overflow.services, { id: PLAN_A, dailyBurnMicros: 1n });
    const overflowPreview = await overflow.services.breath.getAdminPreview(ctxA);
    expect(overflowPreview.runway.status).toBe("pending");
    expect(overflowPreview.pendingReasons).toContain("RUNWAY_DATE_OUT_OF_RANGE");
    expect(overflowPreview.status).toBe("published");

    const amb = createWp6Bundle();
    await seedPublishableControl(amb.services);
    await seedPlan(amb.services, { id: PLAN_A });
    await seedPlan(amb.services, { id: PLAN_B });
    const ambPreview = await amb.services.breath.getAdminPreview(ctxA);
    expect(ambPreview.runway.status).toBe("pending");
    expect(ambPreview.pendingReasons).toContain("ACTIVE_RUNWAY_PLAN_AMBIGUOUS");

    const concurrent = createWp6Bundle();
    await seedPublishableControl(concurrent.services);
    await seedPlan(concurrent.services, { id: PLAN_A, dailyBurnMicros: 1_000_000n });
    await seedTx(concurrent.services, {
      id: "c-cash",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      cashEffectMicros: 4_000_000n,
      accountingAmountMicros: 4_000_000n,
    });
    const [r1, r2] = await Promise.all([
      concurrent.services.breath.getAdminPreview(ctxA),
      concurrent.services.breath.getAdminPreview(ctxA),
    ]);
    expect(r1.runwayStatus.snapshotId).toBe(r2.runwayStatus.snapshotId);
    if (r1.runway.status === "available" && r2.runway.status === "available") {
      expect(r1.runway.endsAt).toBe(r2.runway.endsAt);
      expect(r1.runway.runwayAsOf).toBe(r2.runway.runwayAsOf);
    }
  });

  it("95-104 explicit refresh_snapshot permission, audit, no caller inputs", async () => {
    const { services, audits, clock } = createWp6Bundle();
    await seedPublishableControl(services);
    await seedPlan(services, { id: PLAN_A, dailyBurnMicros: 1_000_000n });
    await seedTx(services, {
      id: "cash",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      cashEffectMicros: 3_000_000n,
      accountingAmountMicros: 3_000_000n,
    });
    const first = await services.breath.getAdminPreview(ctxA);
    const firstId = first.runwayStatus.snapshotId;
    clock.set(new Date(NOW.getTime() + 5_000));

    const sessionless = createWp4Deps({ services, userId: null, permissions: PUBLISH });
    const unauth = await handleTreasuryRunwayPlanCommandsPost(
      jsonRequest("/api/admin/treasury/runway-plans/commands", {
        organization_id: ctxA.organizationId,
        command: "refresh_snapshot",
        reason: "refresh",
      }),
      sessionless,
    );
    expect(unauth.status).toBe(401);

    const mutateOnly = createWp4Deps({ services, permissions: MUTATE });
    const denied = await handleTreasuryRunwayPlanCommandsPost(
      jsonRequest("/api/admin/treasury/runway-plans/commands", {
        organization_id: ctxA.organizationId,
        command: "refresh_snapshot",
        reason: "refresh",
      }),
      mutateOnly,
    );
    expect(denied.status).toBe(403);

    const all = createWp4Deps({ services, permissions: PUBLISH });
    const missingReason = await handleTreasuryRunwayPlanCommandsPost(
      jsonRequest("/api/admin/treasury/runway-plans/commands", {
        organization_id: ctxA.organizationId,
        command: "refresh_snapshot",
      }),
      all,
    );
    expect(missingReason.status).toBe(400);

    const injected = await handleTreasuryRunwayPlanCommandsPost(
      jsonRequest("/api/admin/treasury/runway-plans/commands", {
        organization_id: ctxA.organizationId,
        command: "refresh_snapshot",
        reason: "refresh",
        free_funds_at_as_of_micros: "1",
        approved_daily_burn_micros: "1",
        ends_at: "2099-01-01T00:00:00.000Z",
      }),
      all,
    );
    expect(injected.status).toBe(400);

    const refreshed = await handleTreasuryRunwayPlanCommandsPost(
      jsonRequest("/api/admin/treasury/runway-plans/commands", {
        organization_id: ctxA.organizationId,
        command: "refresh_snapshot",
        reason: "human refresh",
      }),
      all,
    );
    expect(refreshed.status).toBe(200);
    const body = refreshed.body as { snapshot: { id: string; runwayAsOf: string; endsAt: string } };
    expect(body.snapshot.id).not.toBe(firstId);
    expect(audits.some((row) => row.action === "treasury.runway.snapshot_refresh")).toBe(true);

    const after = await services.breath.getAdminPreview(ctxA);
    expect(after.runwayStatus.snapshotId).toBe(body.snapshot.id);
    if (after.runway.status === "available") {
      expect(after.runway.runwayAsOf).toBe(body.snapshot.runwayAsOf);
      expect(after.runway.endsAt).toBe(body.snapshot.endsAt);
    }
  });

  it("loads locked runway facts through the exclusive store", async () => {
    const { services } = createWp6Bundle();
    await seedPublishableControl(services);
    await seedPlan(services, { id: PLAN_A, dailyBurnMicros: 1_000_000n });
    await seedTx(services, {
      id: "locked-cash",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      cashEffectMicros: 3_000_000n,
      accountingAmountMicros: 3_000_000n,
    });

    const baseFacts = createMemoryTreasuryBreathFactsRepository({
      treasury: services.domain.repository,
      catalog: services.catalogRepo,
      watcher: services.watcher,
    });
    let rootLoads = 0;
    let exclusiveLoads = 0;
    const facts: BreathFactsRepository = {
      ...baseFacts,
      async loadFacts(context) {
        rootLoads += 1;
        return baseFacts.loadFacts(context);
      },
      async runExclusive(organizationId, fn) {
        return baseFacts.runExclusive(organizationId, (store) =>
          fn({
            ...store,
            async loadFacts(context) {
              exclusiveLoads += 1;
              return store.loadFacts(context);
            },
          }),
        );
      },
    };
    const breath = createTreasuryBreathReadModel({
      facts,
      writeAudit: async () => "audit-runway-refresh",
      now: () => NOW,
      newId: () => "snapshot-exclusive-store",
    });

    const refreshed = await breath.refreshRunwaySnapshot(
      ctxA,
      { actorType: "admin", actorUserId: "user-runway-operator" },
      "Human-approved refresh",
    );

    expect(refreshed.id).toBe("snapshot-exclusive-store");
    expect(rootLoads).toBe(1);
    expect(exclusiveLoads).toBe(1);
  });
});
