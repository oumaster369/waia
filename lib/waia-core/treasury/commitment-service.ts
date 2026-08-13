import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import type { TreasuryBoundDeps } from "@/lib/waia-core/treasury/bound-deps";
import { createTreasuryBoundRunner } from "@/lib/waia-core/treasury/bound-deps";
import {
  assertTreasuryCommitmentTransitionAllowed,
  isActiveCommittedStatus,
} from "@/lib/waia-core/treasury/commitment-fsm";
import { computeTreasuryContentDigest } from "@/lib/waia-core/treasury/digest";
import { TreasuryNotFoundError, TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { assertPositiveMicros, serializeMicros } from "@/lib/waia-core/treasury/money";
import type {
  TreasuryActorContext,
  TreasuryCommitmentRecord,
} from "@/lib/waia-core/treasury/types";

export type TreasuryCommitmentServiceDeps = TreasuryBoundDeps & {
  now?: () => Date;
  newId?: () => string;
  runAtomic?: <T>(fn: (bound: TreasuryBoundDeps) => Promise<T>) => Promise<T>;
};

export type CreateCommitmentDraftInput = {
  amountMicros: bigint;
  currency?: string;
  purpose: string;
  budgetId?: string | null;
  counterpartyDisplay?: string | null;
  expectedAt?: string | null;
  reason?: string | null;
};

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return serializeMicros(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = jsonSafe(nested);
    }
    return out;
  }
  return value;
}

function requireReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw new TreasuryValidationError(
      "REASON_REQUIRED",
      "commitment lifecycle mutations require a reason",
    );
  }
  return trimmed;
}

function digestCommitment(record: TreasuryCommitmentRecord): string {
  return computeTreasuryContentDigest(
    jsonSafe({
      id: record.id,
      organizationId: record.organizationId,
      status: record.status,
      amountMicros: record.amountMicros,
      budgetId: record.budgetId,
      fulfillsTransactionId: record.fulfillsTransactionId,
    }),
  );
}

export function deriveActiveCommittedFundsMicros(
  commitments: readonly TreasuryCommitmentRecord[],
): bigint {
  let total = 0n;
  for (const commitment of commitments) {
    if (isActiveCommittedStatus(commitment.status)) {
      total += assertPositiveMicros(commitment.amountMicros, "amountMicros");
    }
  }
  return total;
}

export function createTreasuryCommitmentService(deps: TreasuryCommitmentServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { getBound, runAtomic } = createTreasuryBoundRunner(deps);
  const bound = new Proxy({} as TreasuryBoundDeps, {
    get(_target, prop, receiver) {
      return Reflect.get(getBound(), prop, receiver);
    },
  });

  async function requireCommitment(context: OrgContext, commitmentId: string) {
    const scoped = requireOrgContext(context.organizationId);
    const row = await bound.repository.getCommitment(scoped, commitmentId);
    if (!row || row.organizationId !== scoped.organizationId) {
      throw new TreasuryNotFoundError("commitment", commitmentId);
    }
    return row;
  }

  async function writeRevisionAndAudit(input: {
    context: OrgContext;
    actor: TreasuryActorContext;
    commitment: TreasuryCommitmentRecord;
    action: string;
    reason: string | null;
    patch: Record<string, unknown>;
  }) {
    const seq = await bound.repository.getNextCommitmentRevisionSeq(
      input.context,
      input.commitment.id,
    );
    const prior = await bound.repository.listCommitmentRevisions(
      input.context,
      input.commitment.id,
    );
    const prevRevisionDigest = prior.at(-1)?.contentDigest ?? null;
    const revisionId = newId();
    const patchJson = jsonSafe(input.patch) as Record<string, unknown>;
    const contentDigest = computeTreasuryContentDigest({
      schema: "treasury_commitment_revision.v1",
      organizationId: input.context.organizationId,
      commitmentId: input.commitment.id,
      seq,
      patchJson,
      prevRevisionDigest,
      reason: input.reason,
    });
    await bound.repository.insertCommitmentRevision({
      id: revisionId,
      organizationId: input.context.organizationId,
      commitmentId: input.commitment.id,
      seq,
      patchJson,
      actorUserId: input.actor.actorUserId ?? null,
      actorType: input.actor.actorType,
      reason: input.reason,
      contentDigest,
      prevRevisionDigest,
      createdAt: now(),
    });
    await bound.writeAudit({
      actorType: input.actor.actorType,
      actorId: input.actor.actorUserId ?? null,
      action: input.action,
      entityType: treasuryEntityTypes.commitment,
      entityId: input.commitment.id,
      organizationId: input.context.organizationId,
      metadata: { reason: input.reason, revisionId, seq, patch: patchJson },
    });
  }

  return {
    async createDraft(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: CreateCommitmentDraftInput,
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (!actor.actorUserId) {
        throw new TreasuryValidationError(
          "ACTOR_REQUIRED",
          "commitment create requires actor user id",
        );
      }
      const createdAt = now();
      const record: TreasuryCommitmentRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        budgetId: input.budgetId ?? null,
        amountMicros: assertPositiveMicros(input.amountMicros, "amountMicros"),
        currency: input.currency ?? "USD",
        purpose: input.purpose,
        counterpartyDisplay: input.counterpartyDisplay ?? null,
        publishCounterparty: false,
        detailPublication: "PRIVATE",
        expectedAt: input.expectedAt ?? null,
        effectiveFrom: createdAt,
        status: "DRAFT",
        evidenceObjectId: null,
        createdByUserId: actor.actorUserId,
        approvedByUserId: null,
        approvedAt: null,
        releasedByUserId: null,
        releasedAt: null,
        fulfilledByUserId: null,
        fulfilledAt: null,
        cancelledByUserId: null,
        cancelledAt: null,
        fulfillsTransactionId: null,
        recordContentDigest: "",
        createdAt,
        updatedAt: createdAt,
      };
      record.recordContentDigest = digestCommitment(record);
      return runAtomic(async () => {
        await bound.repository.insertCommitment(record);
        await writeRevisionAndAudit({
          context: scoped,
          actor,
          commitment: record,
          action: treasuryAuditActions.commitmentCreate,
          reason: input.reason ?? "create draft",
          patch: { status: "DRAFT" },
        });
        return record;
      });
    },

    async approve(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { commitmentId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const commitment = await requireCommitment(context, input.commitmentId);
        assertTreasuryCommitmentTransitionAllowed(commitment.id, commitment.status, "APPROVED");
        const updated = await bound.repository.updateCommitment(context, commitment.id, {
          status: "APPROVED",
          approvedByUserId: actor.actorUserId ?? null,
          approvedAt: now(),
          updatedAt: now(),
        });
        await writeRevisionAndAudit({
          context,
          actor,
          commitment: updated,
          action: treasuryAuditActions.commitmentApprove,
          reason,
          patch: { status: { from: commitment.status, to: "APPROVED" } },
        });
        return updated;
      });
    },

    async release(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { commitmentId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const commitment = await requireCommitment(context, input.commitmentId);
        assertTreasuryCommitmentTransitionAllowed(commitment.id, commitment.status, "RELEASED");
        const updated = await bound.repository.updateCommitment(context, commitment.id, {
          status: "RELEASED",
          releasedByUserId: actor.actorUserId ?? null,
          releasedAt: now(),
          updatedAt: now(),
        });
        await writeRevisionAndAudit({
          context,
          actor,
          commitment: updated,
          action: treasuryAuditActions.commitmentRelease,
          reason,
          patch: { status: { from: commitment.status, to: "RELEASED" } },
        });
        return updated;
      });
    },

    async fulfill(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { commitmentId: string; fulfillsTransactionId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const commitment = await requireCommitment(context, input.commitmentId);
        assertTreasuryCommitmentTransitionAllowed(commitment.id, commitment.status, "FULFILLED");
        const fulfillment = await bound.repository.getTransaction(
          context,
          input.fulfillsTransactionId,
        );
        if (!fulfillment || fulfillment.organizationId !== commitment.organizationId) {
          throw new TreasuryNotFoundError("transaction", input.fulfillsTransactionId);
        }
        if (fulfillment.status !== "VERIFIED") {
          throw new TreasuryValidationError(
            "FULFILLMENT_NOT_VERIFIED",
            "fulfillment transaction must be VERIFIED",
          );
        }
        if (fulfillment.kind !== "EXPENSE" && fulfillment.kind !== "EXTERNAL_OUTFLOW") {
          throw new TreasuryValidationError(
            "FULFILLMENT_KIND",
            "fulfillment transaction must be EXPENSE or EXTERNAL_OUTFLOW",
          );
        }
        const updated = await bound.repository.updateCommitment(context, commitment.id, {
          status: "FULFILLED",
          fulfillsTransactionId: fulfillment.id,
          fulfilledByUserId: actor.actorUserId ?? null,
          fulfilledAt: now(),
          updatedAt: now(),
        });
        await writeRevisionAndAudit({
          context,
          actor,
          commitment: updated,
          action: treasuryAuditActions.commitmentFulfill,
          reason,
          patch: {
            status: { from: commitment.status, to: "FULFILLED" },
            fulfillsTransactionId: fulfillment.id,
          },
        });
        return updated;
      });
    },

    async cancel(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { commitmentId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const commitment = await requireCommitment(context, input.commitmentId);
        assertTreasuryCommitmentTransitionAllowed(
          commitment.id,
          commitment.status,
          "CANCELLED",
          reason,
        );
        const updated = await bound.repository.updateCommitment(context, commitment.id, {
          status: "CANCELLED",
          cancelledByUserId: actor.actorUserId ?? null,
          cancelledAt: now(),
          updatedAt: now(),
        });
        await writeRevisionAndAudit({
          context,
          actor,
          commitment: updated,
          action: treasuryAuditActions.commitmentCancel,
          reason,
          patch: { status: { from: commitment.status, to: "CANCELLED" } },
        });
        return updated;
      });
    },

    async activeCommittedFundsMicros(context: OrgContext, budgetId?: string | null) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await bound.repository.listCommitments(scoped, {
        budgetId: budgetId ?? undefined,
        statuses: ["APPROVED", "RELEASED"],
      });
      return deriveActiveCommittedFundsMicros(rows);
    },
  };
}

export type TreasuryCommitmentService = ReturnType<typeof createTreasuryCommitmentService>;
