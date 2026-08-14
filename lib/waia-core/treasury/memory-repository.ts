import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { TreasuryNotFoundError, TreasuryOrgScopeError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import { finalizeTransactionList } from "@/lib/waia-core/treasury/transaction-list-query";
import type {
  TreasuryAttributionRecord,
  TreasuryCommitmentRecord,
  TreasuryCommitmentRevisionRecord,
  TreasuryEvidenceLinkRecord,
  TreasuryInceptionRecord,
  TreasuryObservationRecord,
  TreasuryRevisionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopedId(organizationId: string, id: string): string {
  return `${organizationId}:${id}`;
}

export function createMemoryTreasuryRepository(): TreasuryRepository {
  const transactions = new Map<string, TreasuryTransactionRecord>();
  const observations = new Map<string, TreasuryObservationRecord>();
  const observationLinks: Array<{
    id: string;
    organizationId: string;
    transactionId: string;
    observationId: string;
    observationRole: "PRIMARY" | "INTERNAL_COUNTERPARTY" | "SECONDARY";
  }> = [];
  const evidenceLinks: TreasuryEvidenceLinkRecord[] = [];
  const revisions: TreasuryRevisionRecord[] = [];
  const commitments = new Map<string, TreasuryCommitmentRecord>();
  const commitmentRevisions: TreasuryCommitmentRevisionRecord[] = [];
  const inceptions = new Map<string, TreasuryInceptionRecord>();
  const attributions: TreasuryAttributionRecord[] = [];

  function requireScope(context: OrgContext): OrgContext {
    const scoped = requireOrgContext(context.organizationId);
    if (!scoped.organizationId) {
      throw new TreasuryOrgScopeError();
    }
    return scoped;
  }

  return {
    async getTransaction(context, transactionId) {
      const scoped = requireScope(context);
      const row = transactions.get(scopedId(scoped.organizationId, transactionId));
      return row ? clone(row) : null;
    },

    async insertTransaction(record) {
      requireOrgContext(record.organizationId);
      transactions.set(scopedId(record.organizationId, record.id), clone(record));
    },

    async updateTransaction(context, transactionId, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, transactionId);
      const existing = transactions.get(key);
      if (!existing) {
        throw new TreasuryNotFoundError("transaction", transactionId);
      }
      const next = {
        ...existing,
        ...patch,
        organizationId: existing.organizationId,
        id: existing.id,
      };
      transactions.set(key, next);
      return clone(next);
    },

    async listLinkedObservations(context, transactionId) {
      const scoped = requireScope(context);
      return observationLinks
        .filter(
          (link) =>
            link.organizationId === scoped.organizationId && link.transactionId === transactionId,
        )
        .map((link) => observations.get(scopedId(scoped.organizationId, link.observationId)))
        .filter((row): row is TreasuryObservationRecord => Boolean(row))
        .map(clone);
    },

    async listEvidenceLinks(context, transactionId) {
      const scoped = requireScope(context);
      return evidenceLinks
        .filter(
          (link) =>
            link.organizationId === scoped.organizationId && link.transactionId === transactionId,
        )
        .map(clone);
    },

    async insertEvidenceLink(record) {
      requireOrgContext(record.organizationId);
      evidenceLinks.push(clone(record));
    },

    async deleteEvidenceLink(context, linkId) {
      const scoped = requireScope(context);
      const index = evidenceLinks.findIndex(
        (row) => row.organizationId === scoped.organizationId && row.id === linkId,
      );
      if (index >= 0) evidenceLinks.splice(index, 1);
    },

    async insertObservation(record) {
      requireOrgContext(record.organizationId);
      observations.set(scopedId(record.organizationId, record.id), clone(record));
    },

    async updateObservationLifecycle(context, observationId, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, observationId);
      const existing = observations.get(key);
      if (!existing) {
        throw new TreasuryNotFoundError("observation", observationId);
      }
      observations.set(key, {
        ...existing,
        observationStatus: patch.observationStatus,
        confirmationsObserved: patch.confirmationsObserved,
      });
    },

    async insertObservationLink(input) {
      requireOrgContext(input.organizationId);
      observationLinks.push({ ...input });
    },

    async listRevisions(context, transactionId) {
      const scoped = requireScope(context);
      return revisions
        .filter(
          (row) =>
            row.organizationId === scoped.organizationId && row.transactionId === transactionId,
        )
        .sort((a, b) => a.seq - b.seq)
        .map(clone);
    },

    async insertRevision(record) {
      requireOrgContext(record.organizationId);
      revisions.push(clone(record));
    },

    async getNextRevisionSeq(context, transactionId) {
      const existing = await this.listRevisions(context, transactionId);
      return existing.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
    },

    async getCommitment(context, commitmentId) {
      const scoped = requireScope(context);
      const row = commitments.get(scopedId(scoped.organizationId, commitmentId));
      return row ? clone(row) : null;
    },

    async insertCommitment(record) {
      requireOrgContext(record.organizationId);
      commitments.set(scopedId(record.organizationId, record.id), clone(record));
    },

    async updateCommitment(context, commitmentId, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, commitmentId);
      const existing = commitments.get(key);
      if (!existing) {
        throw new TreasuryNotFoundError("commitment", commitmentId);
      }
      const next = {
        ...existing,
        ...patch,
        organizationId: existing.organizationId,
        id: existing.id,
      };
      commitments.set(key, next);
      return clone(next);
    },

    async listCommitments(context, query) {
      const scoped = requireScope(context);
      return [...commitments.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .filter((row) => (query?.budgetId ? row.budgetId === query.budgetId : true))
        .filter((row) => (query?.statuses ? query.statuses.includes(row.status) : true))
        .map(clone);
    },

    async listCommitmentRevisions(context, commitmentId) {
      const scoped = requireScope(context);
      return commitmentRevisions
        .filter(
          (row) =>
            row.organizationId === scoped.organizationId && row.commitmentId === commitmentId,
        )
        .sort((a, b) => a.seq - b.seq)
        .map(clone);
    },

    async insertCommitmentRevision(record) {
      requireOrgContext(record.organizationId);
      commitmentRevisions.push(clone(record));
    },

    async getNextCommitmentRevisionSeq(context, commitmentId) {
      const existing = await this.listCommitmentRevisions(context, commitmentId);
      return existing.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
    },

    async listInceptions(context) {
      const scoped = requireScope(context);
      return [...inceptions.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },

    async getInception(context, inceptionId) {
      const scoped = requireScope(context);
      const row = inceptions.get(scopedId(scoped.organizationId, inceptionId));
      return row ? clone(row) : null;
    },

    async getActiveInception(context, network, tokenContract) {
      const scoped = requireScope(context);
      const row = [...inceptions.values()].find(
        (item) =>
          item.organizationId === scoped.organizationId &&
          item.network === network &&
          item.tokenContract === tokenContract &&
          item.status === "ACTIVE",
      );
      return row ? clone(row) : null;
    },

    async insertInception(record) {
      requireOrgContext(record.organizationId);
      inceptions.set(scopedId(record.organizationId, record.id), clone(record));
    },

    async updateInception(context, inceptionId, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, inceptionId);
      const existing = inceptions.get(key);
      if (!existing) {
        throw new TreasuryNotFoundError("inception", inceptionId);
      }
      const next = {
        ...existing,
        ...patch,
        organizationId: existing.organizationId,
        id: existing.id,
      };
      inceptions.set(key, next);
      return clone(next);
    },

    async listAttributions(context, transactionId) {
      const scoped = requireScope(context);
      return attributions
        .filter(
          (row) =>
            row.organizationId === scoped.organizationId && row.transactionId === transactionId,
        )
        .map(clone);
    },

    async insertAttribution(record) {
      requireOrgContext(record.organizationId);
      attributions.push(clone(record));
    },

    async listTransactions(context, query) {
      const scoped = requireScope(context);
      const rows = [...transactions.values()].filter(
        (row) => row.organizationId === scoped.organizationId,
      );
      return finalizeTransactionList(rows, query).map(clone);
    },

    async getTransactionByCanonicalTransfer(context, query) {
      const scoped = requireScope(context);
      const row = [...transactions.values()].find(
        (item) =>
          item.organizationId === scoped.organizationId &&
          item.canonicalNetwork === query.network &&
          item.canonicalTokenContract === query.tokenContract &&
          item.canonicalTxHash === query.txHash &&
          item.canonicalTransferIndex === query.transferIndex,
      );
      return row ? clone(row) : null;
    },
  };
}
