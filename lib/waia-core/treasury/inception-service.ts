import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import type { TreasuryBoundDeps } from "@/lib/waia-core/treasury/bound-deps";
import { createTreasuryBoundRunner } from "@/lib/waia-core/treasury/bound-deps";
import { TreasuryNotFoundError, TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  assertNoSecondActiveInception,
  assertOpeningBalanceEligibleForInception,
  assertWatcherStartAfterInception,
} from "@/lib/waia-core/treasury/inception-rules";
import type { TreasuryActorContext, TreasuryInceptionRecord } from "@/lib/waia-core/treasury/types";

export type TreasuryInceptionServiceDeps = TreasuryBoundDeps & {
  now?: () => Date;
  newId?: () => string;
  runAtomic?: <T>(fn: (bound: TreasuryBoundDeps) => Promise<T>) => Promise<T>;
};

export type CreateActiveInceptionInput = {
  network: string;
  tokenContract: string;
  assetCode: string;
  inceptionBlock: string;
  inceptionBlockHash?: string | null;
  inceptionTime: Date;
  openingBalanceTransactionId: string;
  watcherStartBlock: string;
  evidenceObjectId?: string | null;
  reason: string;
};

/**
 * Ledger inception domain service.
 * Does NOT seed or advance treasury_watcher_checkpoints (WP-3 owns inception-seeded checkpoint).
 */
export function createTreasuryInceptionService(deps: TreasuryInceptionServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { getBound, runAtomic } = createTreasuryBoundRunner(deps);
  const bound = new Proxy({} as TreasuryBoundDeps, {
    get(_target, prop, receiver) {
      return Reflect.get(getBound(), prop, receiver);
    },
  });

  async function validateOpening(context: OrgContext, openingBalanceTransactionId: string) {
    const opening = await bound.repository.getTransaction(context, openingBalanceTransactionId);
    if (!opening) {
      throw new TreasuryNotFoundError("transaction", openingBalanceTransactionId);
    }
    const evidenceLinks = await bound.repository.listEvidenceLinks(context, opening.id);
    assertOpeningBalanceEligibleForInception({
      opening,
      organizationId: context.organizationId,
      evidenceLinkCount: evidenceLinks.length,
    });
    return opening;
  }

  async function insertActive(
    context: OrgContext,
    actor: TreasuryActorContext,
    input: CreateActiveInceptionInput,
  ): Promise<TreasuryInceptionRecord> {
    if (!actor.actorUserId) {
      throw new TreasuryValidationError(
        "ACTOR_REQUIRED",
        "ACTIVE inception requires approved_by_user_id",
      );
    }
    assertWatcherStartAfterInception(input.inceptionBlock, input.watcherStartBlock);
    await validateOpening(context, input.openingBalanceTransactionId);
    const record: TreasuryInceptionRecord = {
      id: newId(),
      organizationId: context.organizationId,
      network: input.network,
      tokenContract: input.tokenContract,
      assetCode: input.assetCode,
      inceptionBlock: input.inceptionBlock,
      inceptionBlockHash: input.inceptionBlockHash ?? null,
      inceptionTime: input.inceptionTime,
      openingBalanceTransactionId: input.openingBalanceTransactionId,
      watcherStartBlock: input.watcherStartBlock,
      evidenceObjectId: input.evidenceObjectId ?? null,
      status: "ACTIVE",
      createdByUserId: actor.actorUserId,
      approvedByUserId: actor.actorUserId,
      createdAt: now(),
    };
    await bound.repository.insertInception(record);
    await bound.writeAudit({
      actorType: actor.actorType,
      actorId: actor.actorUserId,
      action: treasuryAuditActions.inceptionCreate,
      entityType: treasuryEntityTypes.inception,
      entityId: record.id,
      organizationId: context.organizationId,
      metadata: {
        reason: input.reason,
        status: "ACTIVE",
        openingBalanceTransactionId: record.openingBalanceTransactionId,
        watcherStartBlock: record.watcherStartBlock,
        inceptionBlock: record.inceptionBlock,
      },
    });
    await bound.writeAudit({
      actorType: actor.actorType,
      actorId: actor.actorUserId,
      action: treasuryAuditActions.inceptionActivate,
      entityType: treasuryEntityTypes.inception,
      entityId: record.id,
      organizationId: context.organizationId,
      metadata: { reason: input.reason, status: "ACTIVE" },
    });
    return record;
  }

  return {
    async getActiveInception(context: OrgContext, network: string, tokenContract: string) {
      const scoped = requireOrgContext(context.organizationId);
      return bound.repository.getActiveInception(scoped, network, tokenContract);
    },

    async createActive(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: CreateActiveInceptionInput,
    ) {
      const reason = input.reason.trim();
      if (!reason) {
        throw new TreasuryValidationError("REASON_REQUIRED", "inception create requires a reason");
      }
      const scoped = requireOrgContext(context.organizationId);
      return runAtomic(async () => {
        const existing = await bound.repository.getActiveInception(
          scoped,
          input.network,
          input.tokenContract,
        );
        assertNoSecondActiveInception({ existingActive: existing });
        return insertActive(scoped, actor, { ...input, reason });
      });
    },

    async replaceActive(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: CreateActiveInceptionInput & { supersedeInceptionId: string },
    ) {
      const reason = input.reason.trim();
      if (!reason) {
        throw new TreasuryValidationError(
          "REASON_REQUIRED",
          "inception replacement requires a reason",
        );
      }
      const scoped = requireOrgContext(context.organizationId);
      return runAtomic(async () => {
        const existing = await bound.repository.getInception(scoped, input.supersedeInceptionId);
        if (!existing || existing.organizationId !== scoped.organizationId) {
          throw new TreasuryNotFoundError("inception", input.supersedeInceptionId);
        }
        if (existing.status !== "ACTIVE") {
          throw new TreasuryValidationError(
            "INCEPTION_NOT_ACTIVE",
            "only an ACTIVE inception can be superseded",
          );
        }
        await bound.repository.updateInception(scoped, existing.id, { status: "SUPERSEDED" });
        await bound.writeAudit({
          actorType: actor.actorType,
          actorId: actor.actorUserId ?? null,
          action: treasuryAuditActions.inceptionSupersede,
          entityType: treasuryEntityTypes.inception,
          entityId: existing.id,
          organizationId: scoped.organizationId,
          metadata: { reason, from: "ACTIVE", to: "SUPERSEDED" },
        });
        return insertActive(scoped, actor, input);
      });
    },
  };
}

export type TreasuryInceptionService = ReturnType<typeof createTreasuryInceptionService>;
