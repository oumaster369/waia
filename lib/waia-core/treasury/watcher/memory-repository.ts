import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { TreasuryNotFoundError, TreasuryOrgScopeError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import type { TreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/repository.types";
import type {
  TreasuryBalanceReconciliationRecord,
  TreasuryChainObservationRecord,
  TreasuryObservationLinkRecord,
  TreasuryWatchedAddressRecord,
  TreasuryWatcherCheckpointRecord,
} from "@/lib/waia-core/treasury/watcher/types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopedId(organizationId: string, id: string): string {
  return `${organizationId}:${id}`;
}

export function createMemoryTreasuryWatcherRepository(
  treasury: TreasuryRepository,
): TreasuryWatcherRepository {
  const addresses = new Map<string, TreasuryWatchedAddressRecord>();
  const observations = new Map<string, TreasuryChainObservationRecord>();
  const observationsByIdempotency = new Map<string, string>();
  const links: TreasuryObservationLinkRecord[] = [];
  const checkpoints = new Map<string, TreasuryWatcherCheckpointRecord>();
  const reconciliations: TreasuryBalanceReconciliationRecord[] = [];

  function requireScope(context: OrgContext): OrgContext {
    const scoped = requireOrgContext(context.organizationId);
    if (!scoped.organizationId) throw new TreasuryOrgScopeError();
    return scoped;
  }

  return {
    async listActiveWatchedAddresses(context, network, tokenContract) {
      const scoped = requireScope(context);
      return [...addresses.values()]
        .filter(
          (row) =>
            row.organizationId === scoped.organizationId &&
            row.network === network &&
            row.tokenContract === tokenContract &&
            row.isActive,
        )
        .map(clone);
    },

    async insertWatchedAddress(record) {
      requireOrgContext(record.organizationId);
      addresses.set(scopedId(record.organizationId, record.id), clone(record));
    },

    async getObservationByIdempotency(context, idempotencyKey) {
      const scoped = requireScope(context);
      const id = observationsByIdempotency.get(`${scoped.organizationId}:${idempotencyKey}`);
      if (!id) return null;
      const row = observations.get(scopedId(scoped.organizationId, id));
      return row ? clone(row) : null;
    },

    async getObservationById(context, observationId) {
      const scoped = requireScope(context);
      const row = observations.get(scopedId(scoped.organizationId, observationId));
      return row ? clone(row) : null;
    },

    async insertChainObservation(record) {
      requireOrgContext(record.organizationId);
      observations.set(scopedId(record.organizationId, record.id), clone(record));
      observationsByIdempotency.set(`${record.organizationId}:${record.idempotencyKey}`, record.id);
      await treasury.insertObservation({
        id: record.id,
        organizationId: record.organizationId,
        observationStatus: record.observationStatus,
        confirmationsObserved: record.confirmationsObserved,
        confirmationsRequired: record.confirmationsRequired,
      });
    },

    async updateObservationLifecycle(context, observationId, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, observationId);
      const existing = observations.get(key);
      if (!existing) {
        throw new TreasuryNotFoundError("observation", observationId);
      }
      if (existing.observationStatus === "DROPPED") {
        return clone(existing);
      }
      const next = {
        ...existing,
        confirmationsObserved: patch.confirmationsObserved,
        observationStatus: patch.observationStatus,
      };
      observations.set(key, next);
      await treasury.updateObservationLifecycle(scoped, observationId, {
        confirmationsObserved: patch.confirmationsObserved,
        observationStatus: patch.observationStatus,
      });
      return clone(next);
    },

    async listObservationsForOrg(context) {
      const scoped = requireScope(context);
      return [...observations.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },

    async listLinkedFullObservations(context, transactionId) {
      const scoped = requireScope(context);
      return links
        .filter(
          (link) =>
            link.organizationId === scoped.organizationId && link.transactionId === transactionId,
        )
        .map((link) => observations.get(scopedId(scoped.organizationId, link.observationId)))
        .filter((row): row is TreasuryChainObservationRecord => Boolean(row))
        .map(clone);
    },

    async insertObservationLink(record) {
      requireOrgContext(record.organizationId);
      const duplicate = links.find(
        (row) =>
          row.organizationId === record.organizationId &&
          (row.observationId === record.observationId ||
            (row.transactionId === record.transactionId &&
              row.observationId === record.observationId)),
      );
      if (duplicate) return;
      links.push(clone(record));
      await treasury.insertObservationLink({
        id: record.id,
        organizationId: record.organizationId,
        transactionId: record.transactionId,
        observationId: record.observationId,
        observationRole: record.observationRole,
      });
    },

    async getLinkForObservation(context, observationId) {
      const scoped = requireScope(context);
      const row = links.find(
        (link) =>
          link.organizationId === scoped.organizationId && link.observationId === observationId,
      );
      return row ? clone(row) : null;
    },

    async listLinksForTransaction(context, transactionId) {
      const scoped = requireScope(context);
      return links
        .filter(
          (link) =>
            link.organizationId === scoped.organizationId && link.transactionId === transactionId,
        )
        .map(clone);
    },

    async getCheckpoint(context, checkpointKey) {
      const scoped = requireScope(context);
      const row = checkpoints.get(`${scoped.organizationId}:${checkpointKey}`);
      return row ? clone(row) : null;
    },

    async insertCheckpoint(record) {
      requireOrgContext(record.organizationId);
      const key = `${record.organizationId}:${record.checkpointKey}`;
      if (checkpoints.has(key)) return;
      checkpoints.set(key, clone(record));
    },

    async tryAcquireLease(context, checkpointKey, leaseTtlSeconds, now) {
      const scoped = requireScope(context);
      const key = `${scoped.organizationId}:${checkpointKey}`;
      const existing = checkpoints.get(key);
      if (!existing) return false;
      if (existing.leaseUntil && existing.leaseUntil.getTime() > now.getTime()) {
        return false;
      }
      checkpoints.set(key, {
        ...existing,
        leaseUntil: new Date(now.getTime() + leaseTtlSeconds * 1000),
        updatedAt: now,
      });
      return true;
    },

    async releaseLease(context, checkpointKey, now) {
      const scoped = requireScope(context);
      const key = `${scoped.organizationId}:${checkpointKey}`;
      const existing = checkpoints.get(key);
      if (!existing) return;
      checkpoints.set(key, { ...existing, leaseUntil: null, updatedAt: now });
    },

    async advanceCursor(context, checkpointKey, lastScannedBlock, now) {
      const scoped = requireScope(context);
      const key = `${scoped.organizationId}:${checkpointKey}`;
      const existing = checkpoints.get(key);
      if (!existing) {
        throw new TreasuryNotFoundError("checkpoint", checkpointKey);
      }
      checkpoints.set(key, {
        ...existing,
        lastScannedBlock,
        lastScannedAt: now,
        lastError: null,
        lastErrorAt: null,
        cycleCount: existing.cycleCount + 1,
        updatedAt: now,
      });
    },

    async recordError(context, checkpointKey, message, now) {
      const scoped = requireScope(context);
      const key = `${scoped.organizationId}:${checkpointKey}`;
      const existing = checkpoints.get(key);
      if (!existing) return;
      checkpoints.set(key, {
        ...existing,
        lastError: message,
        lastErrorAt: now,
        updatedAt: now,
      });
    },

    async getTransactionByCanonicalTransfer(context, query) {
      return treasury.getTransactionByCanonicalTransfer(context, query);
    },

    async listOrgTransactions(context) {
      return treasury.listTransactions(context);
    },

    async insertBalanceReconciliation(record) {
      requireOrgContext(record.organizationId);
      reconciliations.push(clone(record));
    },

    async listBalanceReconciliations(context) {
      const scoped = requireScope(context);
      return reconciliations
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },
  };
}
