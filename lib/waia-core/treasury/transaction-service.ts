import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import type { TreasuryBoundDeps } from "@/lib/waia-core/treasury/bound-deps";
import { createTreasuryBoundRunner } from "@/lib/waia-core/treasury/bound-deps";
import { computeCanonicalCashEffect } from "@/lib/waia-core/treasury/cash-effect";
import { computeTreasuryContentDigest } from "@/lib/waia-core/treasury/digest";
import { TreasuryNotFoundError, TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { serializeMicros } from "@/lib/waia-core/treasury/money";
import { applyDetailPublicationChange } from "@/lib/waia-core/treasury/publication";
import {
  assertTreasuryTxTransitionAllowed,
  isTerminalTreasuryTxStatus,
} from "@/lib/waia-core/treasury/transaction-fsm";
import type {
  TreasuryActorContext,
  TreasuryDetailPublication,
  TreasurySemanticPatch,
  TreasuryTransactionRecord,
  TreasuryTxDirection,
  TreasuryTxKind,
  TreasuryTxStatus,
} from "@/lib/waia-core/treasury/types";
import { USDT_NOMINAL_USD_POLICY_V1 } from "@/lib/waia-core/treasury/types";
import { assertReadyToVerify } from "@/lib/waia-core/treasury/verify-rules";

export type TreasuryTransactionServiceDeps = TreasuryBoundDeps & {
  now?: () => Date;
  newId?: () => string;
  runAtomic?: <T>(fn: (bound: TreasuryBoundDeps) => Promise<T>) => Promise<T>;
};

export type CreateManualDraftInput = {
  direction: TreasuryTxDirection;
  kind?: TreasuryTxKind | null;
  nativeAmountAtomic: bigint;
  nativeDecimals: number;
  nativeAsset: string;
  nativeContract?: string | null;
  accountingAmountMicros?: bigint | null;
  accountingDenominationPolicy?: string | null;
  occurredAt: Date;
  purpose?: string | null;
  fundBucketCode?: string;
  budgetId?: string | null;
  fundingNeedId?: string | null;
  correctsTransactionId?: string | null;
  counterpartyId?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  projectId?: string | null;
  internalNotes?: string | null;
  initialStatus?: Extract<TreasuryTxStatus, "PLANNED" | "NEEDS_REVIEW">;
  reason?: string | null;
};

export type CreateWatcherDetectedInput = {
  direction: TreasuryTxDirection;
  nativeAmountAtomic: bigint;
  nativeDecimals: number;
  nativeAsset: string;
  nativeContract: string;
  canonicalNetwork: string;
  canonicalTokenContract: string;
  canonicalTxHash: string;
  canonicalTransferIndex: number;
  occurredAt: Date;
  counterpartyIsInternal: boolean;
  ledgerInceptionId?: string | null;
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
      "state-changing treasury mutations require a reason",
    );
  }
  return trimmed;
}

function digestTransaction(record: TreasuryTransactionRecord): string {
  return computeTreasuryContentDigest(
    jsonSafe({
      id: record.id,
      organizationId: record.organizationId,
      status: record.status,
      detailPublication: record.detailPublication,
      provenance: record.provenance,
      direction: record.direction,
      kind: record.kind,
      accountingAmountMicros: record.accountingAmountMicros,
      cashEffectMicros: record.cashEffectMicros,
      accountingDenominationPolicy: record.accountingDenominationPolicy,
      counterpartyId: record.counterpartyId,
      accountId: record.accountId,
      categoryId: record.categoryId,
      projectId: record.projectId,
      correctsTransactionId: record.correctsTransactionId,
      duplicateOfTransactionId: record.duplicateOfTransactionId,
      detailSupersededById: record.detailSupersededById,
    }),
  );
}

export function createTreasuryTransactionService(deps: TreasuryTransactionServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { getBound, runAtomic } = createTreasuryBoundRunner(deps);
  const bound = new Proxy({} as TreasuryBoundDeps, {
    get(_target, prop, receiver) {
      return Reflect.get(getBound(), prop, receiver);
    },
  });

  async function requireTransaction(
    context: OrgContext,
    transactionId: string,
  ): Promise<TreasuryTransactionRecord> {
    const scoped = requireOrgContext(context.organizationId);
    const row = await bound.repository.getTransaction(scoped, transactionId);
    if (!row || row.organizationId !== scoped.organizationId) {
      throw new TreasuryNotFoundError("transaction", transactionId);
    }
    return row;
  }

  async function writeRevisionAndAudit(input: {
    context: OrgContext;
    actor: TreasuryActorContext;
    tx: TreasuryTransactionRecord;
    action: string;
    reason: string | null;
    patch: Record<string, unknown>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }): Promise<TreasuryTransactionRecord> {
    const seq = await bound.repository.getNextRevisionSeq(input.context, input.tx.id);
    const prior = await bound.repository.listRevisions(input.context, input.tx.id);
    const prevRevisionDigest = prior.at(-1)?.contentDigest ?? null;
    const revisionId = newId();
    const patchJson = jsonSafe(input.patch) as Record<string, unknown>;
    const contentDigest = computeTreasuryContentDigest({
      schema: "treasury_transaction_revision.v1",
      organizationId: input.context.organizationId,
      transactionId: input.tx.id,
      seq,
      patchJson,
      prevRevisionDigest,
      reason: input.reason,
    });
    await bound.repository.insertRevision({
      id: revisionId,
      organizationId: input.context.organizationId,
      transactionId: input.tx.id,
      seq,
      patchJson,
      actorUserId: input.actor.actorUserId ?? null,
      actorType: input.actor.actorType,
      reason: input.reason,
      contentDigest,
      prevRevisionDigest,
      createdAt: now(),
    });
    const updated = await bound.repository.updateTransaction(input.context, input.tx.id, {
      latestRevisionId: revisionId,
      recordContentDigest: digestTransaction({ ...input.tx, latestRevisionId: revisionId }),
      updatedAt: now(),
    });
    await bound.writeAudit({
      actorType: input.actor.actorType,
      actorId: input.actor.actorUserId ?? null,
      action: input.action,
      entityType: treasuryEntityTypes.transaction,
      entityId: input.tx.id,
      organizationId: input.context.organizationId,
      metadata: {
        reason: input.reason,
        revisionId,
        seq,
        before: input.before,
        after: input.after,
      },
    });
    return updated;
  }

  async function applyStatus(
    context: OrgContext,
    actor: TreasuryActorContext,
    tx: TreasuryTransactionRecord,
    toStatus: TreasuryTxStatus,
    reason: string,
    extraPatch: Partial<TreasuryTransactionRecord> = {},
    action: string = treasuryAuditActions.transactionStatusTransition,
  ): Promise<TreasuryTransactionRecord> {
    assertTreasuryTxTransitionAllowed(tx.id, tx.status, toStatus);
    const next: TreasuryTransactionRecord = {
      ...tx,
      ...extraPatch,
      status: toStatus,
      updatedAt: now(),
    };
    await bound.repository.updateTransaction(context, tx.id, {
      ...extraPatch,
      status: toStatus,
      updatedAt: next.updatedAt,
    });
    return writeRevisionAndAudit({
      context,
      actor,
      tx: next,
      action,
      reason,
      patch: { status: { from: tx.status, to: toStatus }, ...extraPatch },
      before: { status: tx.status },
      after: { status: toStatus },
    });
  }

  return {
    async getTransaction(context: OrgContext, transactionId: string) {
      return requireTransaction(context, transactionId);
    },

    async ensureWatcherDetected(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: CreateWatcherDetectedInput,
    ) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await bound.repository.getTransactionByCanonicalTransfer(scoped, {
        network: input.canonicalNetwork,
        tokenContract: input.canonicalTokenContract,
        txHash: input.canonicalTxHash,
        transferIndex: input.canonicalTransferIndex,
      });
      if (existing) {
        return existing;
      }
      const createdAt = now();
      const record: TreasuryTransactionRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        status: "DETECTED",
        detailPublication: "PRIVATE",
        provenance: "WATCHER",
        canonicalNetwork: input.canonicalNetwork,
        canonicalTokenContract: input.canonicalTokenContract,
        canonicalTxHash: input.canonicalTxHash,
        canonicalTransferIndex: input.canonicalTransferIndex,
        direction: input.direction,
        kind: null,
        fundBucketCode: "UNASSIGNED",
        nativeAmountAtomic: input.nativeAmountAtomic,
        nativeDecimals: input.nativeDecimals,
        nativeAsset: input.nativeAsset,
        nativeContract: input.nativeContract,
        accountingAmountMicros: null,
        accountingDenominationPolicy: null,
        cashEffectMicros: null,
        counterpartyIsInternal: input.counterpartyIsInternal,
        counterpartyId: null,
        accountId: null,
        categoryId: null,
        projectId: null,
        occurredAt: input.occurredAt,
        purpose: null,
        category: null,
        counterpartyDisplay: null,
        publishCounterparty: false,
        projectModule: null,
        milestoneStage: null,
        budgetId: null,
        fundingNeedId: null,
        description: null,
        internalNotes: null,
        publicDescription: null,
        txHash: input.canonicalTxHash,
        correctsTransactionId: null,
        duplicateOfTransactionId: null,
        detailSupersededById: null,
        ledgerInceptionId: input.ledgerInceptionId ?? null,
        verifiedAt: null,
        verifiedByUserId: null,
        detailPublishedAt: null,
        detailPublishedByUserId: null,
        latestRevisionId: null,
        recordContentDigest: "",
        createdByUserId: null,
        createdAt,
        updatedAt: createdAt,
      };
      record.recordContentDigest = digestTransaction(record);

      return runAtomic(async () => {
        await bound.repository.insertTransaction(record);
        const withCreate = await writeRevisionAndAudit({
          context: scoped,
          actor,
          tx: record,
          action: treasuryAuditActions.transactionWatcherCreate,
          reason: "watcher ingest DETECTED",
          patch: { create: "DETECTED" },
          after: { status: "DETECTED", id: record.id },
        });
        return applyStatus(
          scoped,
          actor,
          withCreate,
          "NEEDS_REVIEW",
          "watcher ingest DETECTED -> NEEDS_REVIEW",
        );
      });
    },

    async createManualDraft(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: CreateManualDraftInput,
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (input.initialStatus === "PLANNED" && input.occurredAt.getTime() <= now().getTime()) {
        throw new TreasuryValidationError(
          "PLANNED_TIME_REQUIRED",
          "planned transactions must occur in the future",
        );
      }
      let cashEffectMicros: bigint | null = null;
      const accountingAmountMicros = input.accountingAmountMicros ?? null;
      if (input.kind && accountingAmountMicros !== null) {
        cashEffectMicros = computeCanonicalCashEffect({
          kind: input.kind,
          direction: input.direction,
          accountingAmountMicros,
        }).cashEffectMicros;
      }
      const createdAt = now();
      const record: TreasuryTransactionRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        status: "MANUAL_DRAFT",
        detailPublication: "PRIVATE",
        provenance: "MANUAL",
        canonicalNetwork: null,
        canonicalTokenContract: null,
        canonicalTxHash: null,
        canonicalTransferIndex: null,
        direction: input.direction,
        kind: input.kind ?? null,
        fundBucketCode: input.fundBucketCode ?? "UNASSIGNED",
        nativeAmountAtomic: input.nativeAmountAtomic,
        nativeDecimals: input.nativeDecimals,
        nativeAsset: input.nativeAsset,
        nativeContract: input.nativeContract ?? null,
        accountingAmountMicros,
        accountingDenominationPolicy:
          input.accountingDenominationPolicy ?? USDT_NOMINAL_USD_POLICY_V1,
        cashEffectMicros,
        counterpartyIsInternal: false,
        counterpartyId: input.counterpartyId ?? null,
        accountId: input.accountId ?? null,
        categoryId: input.categoryId ?? null,
        projectId: input.projectId ?? null,
        occurredAt: input.occurredAt,
        purpose: input.purpose ?? null,
        category: null,
        counterpartyDisplay: null,
        publishCounterparty: false,
        projectModule: null,
        milestoneStage: null,
        budgetId: input.budgetId ?? null,
        fundingNeedId: input.fundingNeedId ?? null,
        description: null,
        internalNotes: input.internalNotes ?? null,
        publicDescription: null,
        txHash: null,
        correctsTransactionId: input.correctsTransactionId ?? null,
        duplicateOfTransactionId: null,
        detailSupersededById: null,
        ledgerInceptionId: null,
        verifiedAt: null,
        verifiedByUserId: null,
        detailPublishedAt: null,
        detailPublishedByUserId: null,
        latestRevisionId: null,
        recordContentDigest: "",
        createdByUserId: actor.actorUserId ?? null,
        createdAt,
        updatedAt: createdAt,
      };
      record.recordContentDigest = digestTransaction(record);

      return runAtomic(async () => {
        await bound.repository.insertTransaction(record);
        const created = await writeRevisionAndAudit({
          context: scoped,
          actor,
          tx: record,
          action: treasuryAuditActions.transactionManualCreate,
          reason: input.reason ?? "manual draft",
          patch: { create: "MANUAL_DRAFT" },
          after: { status: record.status, id: record.id },
        });
        return input.initialStatus
          ? applyStatus(
              scoped,
              actor,
              created,
              input.initialStatus,
              input.reason ?? `manual ${input.initialStatus.toLocaleLowerCase()}`,
            )
          : created;
      });
    },

    async submitForReview(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { transactionId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const tx = await requireTransaction(context, input.transactionId);
        return applyStatus(context, actor, tx, "NEEDS_REVIEW", reason);
      });
    },

    async classify(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: {
        transactionId: string;
        reason: string;
        patch: TreasurySemanticPatch;
      },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const tx = await requireTransaction(context, input.transactionId);
        if (isTerminalTreasuryTxStatus(tx.status)) {
          throw new TreasuryValidationError("TERMINAL_STATUS", `${tx.status} cannot be classified`);
        }
        const merged: TreasuryTransactionRecord = { ...tx, ...input.patch, updatedAt: now() };
        if (merged.kind && merged.accountingAmountMicros !== null) {
          const computed = computeCanonicalCashEffect({
            kind: merged.kind,
            direction: merged.direction,
            accountingAmountMicros: merged.accountingAmountMicros,
            signedCashEffectMicros: merged.cashEffectMicros ?? undefined,
          });
          merged.accountingAmountMicros = computed.accountingAmountMicros;
          merged.cashEffectMicros = computed.cashEffectMicros;
        }
        const nextStatus: TreasuryTxStatus =
          tx.status === "NEEDS_REVIEW" ? "CLASSIFIED" : tx.status;
        if (nextStatus !== tx.status) {
          assertTreasuryTxTransitionAllowed(tx.id, tx.status, nextStatus);
        }
        merged.status = nextStatus;
        await bound.repository.updateTransaction(context, tx.id, {
          ...input.patch,
          kind: merged.kind,
          direction: merged.direction,
          accountingAmountMicros: merged.accountingAmountMicros,
          cashEffectMicros: merged.cashEffectMicros,
          status: nextStatus,
          updatedAt: merged.updatedAt,
        });
        return writeRevisionAndAudit({
          context,
          actor,
          tx: merged,
          action: treasuryAuditActions.transactionClassify,
          reason,
          patch: { ...input.patch, status: nextStatus },
          before: { status: tx.status, kind: tx.kind },
          after: { status: nextStatus, kind: merged.kind },
        });
      });
    },

    async verify(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { transactionId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const tx = await requireTransaction(context, input.transactionId);
        assertTreasuryTxTransitionAllowed(tx.id, tx.status, "VERIFIED");
        const linkedObservations = await bound.repository.listLinkedObservations(context, tx.id);
        const evidenceLinks = await bound.repository.listEvidenceLinks(context, tx.id);
        assertReadyToVerify({ tx, linkedObservations, evidenceLinks });
        const extra: Partial<TreasuryTransactionRecord> = {
          verifiedAt: now(),
          verifiedByUserId: actor.actorUserId ?? null,
        };
        return applyStatus(
          context,
          actor,
          tx,
          "VERIFIED",
          reason,
          extra,
          treasuryAuditActions.transactionVerify,
        );
      });
    },

    async reject(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { transactionId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const tx = await requireTransaction(context, input.transactionId);
        return applyStatus(
          context,
          actor,
          tx,
          "REJECTED",
          reason,
          {},
          treasuryAuditActions.transactionReject,
        );
      });
    },

    async confirmDuplicate(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { transactionId: string; duplicateOfTransactionId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const tx = await requireTransaction(context, input.transactionId);
        const survivor = await requireTransaction(context, input.duplicateOfTransactionId);
        if (survivor.organizationId !== tx.organizationId) {
          throw new TreasuryValidationError(
            "CROSS_ORG_REFERENCE",
            "duplicate survivor must be same org",
          );
        }
        return applyStatus(
          context,
          actor,
          tx,
          "DUPLICATE",
          reason,
          { duplicateOfTransactionId: survivor.id },
          treasuryAuditActions.transactionDuplicate,
        );
      });
    },

    async reopenReconciliation(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { transactionId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const tx = await requireTransaction(context, input.transactionId);
        return applyStatus(
          context,
          actor,
          tx,
          "RECONCILIATION_REQUIRED",
          reason,
          {},
          treasuryAuditActions.transactionReconciliationReopen,
        );
      });
    },

    async returnFromReconciliation(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: {
        transactionId: string;
        toStatus: Extract<TreasuryTxStatus, "NEEDS_REVIEW" | "REJECTED" | "DUPLICATE" | "VERIFIED">;
        reason: string;
        duplicateOfTransactionId?: string;
      },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const tx = await requireTransaction(context, input.transactionId);
        if (input.toStatus === "VERIFIED") {
          const linkedObservations = await bound.repository.listLinkedObservations(context, tx.id);
          const evidenceLinks = await bound.repository.listEvidenceLinks(context, tx.id);
          assertReadyToVerify({
            tx: { ...tx, status: "CLASSIFIED" },
            linkedObservations,
            evidenceLinks,
          });
        }
        return applyStatus(
          context,
          actor,
          tx,
          input.toStatus,
          reason,
          input.duplicateOfTransactionId
            ? { duplicateOfTransactionId: input.duplicateOfTransactionId }
            : {},
        );
      });
    },

    async setDetailPublication(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: {
        transactionId: string;
        detailPublication: TreasuryDetailPublication;
        reason: string;
        supersededById?: string | null;
      },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const tx = await requireTransaction(context, input.transactionId);
        const result = applyDetailPublicationChange({
          from: tx.detailPublication,
          to: input.detailPublication,
          accountingStatus: tx.status,
          supersededById: input.supersededById,
        });
        const extra: Partial<TreasuryTransactionRecord> = {
          detailPublication: result.detailPublication,
          detailSupersededById: result.detailSupersededById,
          detailPublishedAt:
            result.detailPublication === "DETAIL_PUBLIC" ? now() : tx.detailPublishedAt,
          detailPublishedByUserId:
            result.detailPublication === "DETAIL_PUBLIC"
              ? (actor.actorUserId ?? null)
              : tx.detailPublishedByUserId,
        };
        await bound.repository.updateTransaction(context, tx.id, extra);
        const merged = { ...tx, ...extra };
        return writeRevisionAndAudit({
          context,
          actor,
          tx: merged,
          action: treasuryAuditActions.transactionDetailPublication,
          reason,
          patch: extra,
          before: { status: tx.status, detailPublication: tx.detailPublication },
          after: { status: result.accountingStatus, detailPublication: result.detailPublication },
        });
      });
    },

    async linkCorrection(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { originalTransactionId: string; correctionTransactionId: string; reason: string },
    ) {
      const reason = requireReason(input.reason);
      return runAtomic(async () => {
        const original = await requireTransaction(context, input.originalTransactionId);
        const correction = await requireTransaction(context, input.correctionTransactionId);
        if (original.organizationId !== correction.organizationId) {
          throw new TreasuryValidationError("CROSS_ORG_REFERENCE", "correction must be same org");
        }
        if (original.status === "VERIFIED") {
          await applyStatus(
            context,
            actor,
            original,
            "RECONCILIATION_REQUIRED",
            reason,
            {},
            treasuryAuditActions.transactionReconciliationReopen,
          );
        }
        await bound.repository.updateTransaction(context, correction.id, {
          correctsTransactionId: original.id,
          updatedAt: now(),
        });
        const updatedCorrection = { ...correction, correctsTransactionId: original.id };
        return writeRevisionAndAudit({
          context,
          actor,
          tx: updatedCorrection,
          action: treasuryAuditActions.transactionCorrectionLink,
          reason,
          patch: { correctsTransactionId: original.id },
          before: { originalStatus: original.status },
          after: { correctsTransactionId: original.id },
        });
      });
    },
  };
}

export type TreasuryTransactionService = ReturnType<typeof createTreasuryTransactionService>;
