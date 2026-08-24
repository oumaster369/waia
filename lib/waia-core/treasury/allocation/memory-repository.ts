import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/catalog-repository.types";
import type {
  FundAllocationRepository,
  FundAllocationStore,
} from "@/lib/waia-core/treasury/allocation/repository.types";
import type { FundAllocationEvidenceRecord } from "@/lib/waia-core/treasury/allocation/types";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import type { TreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/repository.types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMemoryTreasuryFundAllocationRepository(deps: {
  treasury: TreasuryRepository;
  catalog: TreasuryCatalogRepository;
  watcher: TreasuryWatcherRepository;
}): FundAllocationRepository & {
  listEvidence(context: OrgContext): FundAllocationEvidenceRecord[];
} {
  const evidence: FundAllocationEvidenceRecord[] = [];
  const locks = new Map<string, Promise<unknown>>();

  const store: FundAllocationStore = {
    async loadFacts(context) {
      const org = requireOrgContext(context.organizationId);
      const [transactions, commitments, idealBudgets, reconciliations, inceptions] =
        await Promise.all([
          deps.treasury.listTransactions(org),
          deps.treasury.listCommitments(org),
          deps.catalog.listIdealBudgets(org),
          deps.watcher.listBalanceReconciliations(org),
          deps.treasury.listInceptions(org),
        ]);
      return { transactions, commitments, idealBudgets, reconciliations, inceptions };
    },
    async getEvidenceByInputDigest(context, inputDigest) {
      const org = requireOrgContext(context.organizationId);
      const row = evidence.find(
        (item) => item.organizationId === org.organizationId && item.inputDigest === inputDigest,
      );
      return row ? clone(row) : null;
    },
    async getLatestEvidence(context) {
      const org = requireOrgContext(context.organizationId);
      const rows = evidence
        .filter((row) => row.organizationId === org.organizationId)
        .sort((a, b) => {
          const byTime = b.createdAt.getTime() - a.createdAt.getTime();
          return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
        });
      return rows[0] ? clone(rows[0]) : null;
    },
    async insertEvidence(record) {
      requireOrgContext(record.organizationId);
      const existing = evidence.find(
        (row) =>
          row.organizationId === record.organizationId && row.inputDigest === record.inputDigest,
      );
      if (existing) return clone(existing);
      evidence.push(clone(record));
      return clone(record);
    },
  };

  return {
    ...store,
    listEvidence(context) {
      const org = requireOrgContext(context.organizationId);
      return evidence.filter((row) => row.organizationId === org.organizationId).map(clone);
    },
    async runExclusive(organizationId, fn) {
      requireOrgContext(organizationId);
      const previous = locks.get(organizationId) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gate = previous.then(() => current);
      locks.set(organizationId, gate);
      await previous;
      try {
        return await fn(store);
      } finally {
        release();
        if (locks.get(organizationId) === gate) locks.delete(organizationId);
      }
    },
  };
}
