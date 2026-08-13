import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/catalog-repository.types";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import type { TreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/repository.types";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import type {
  BreathFactsRepository,
  BreathIdealAuditEvent,
  BreathLoadedFacts,
  BreathSnapshotStore,
} from "@/lib/waia-core/treasury/breath/repository.types";
import type { TreasuryRunwaySnapshotRecord } from "@/lib/waia-core/treasury/breath/types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scoped(context: OrgContext): OrgContext {
  return requireOrgContext(context.organizationId);
}

/**
 * In-memory Breath facts. Transactions are loaded via `listTransactions(context)`
 * with NO query object so the complete org set is returned (pagination is only
 * applied when a query is provided).
 */
export function createMemoryTreasuryBreathFactsRepository(deps: {
  treasury: TreasuryRepository;
  catalog: TreasuryCatalogRepository;
  watcher: TreasuryWatcherRepository;
}): BreathFactsRepository & { recordAuditEvent: (event: BreathIdealAuditEvent) => void } {
  const snapshots: TreasuryRunwaySnapshotRecord[] = [];
  const auditEvents: BreathIdealAuditEvent[] = [];
  const locks = new Map<string, Promise<unknown>>();

  const store: BreathSnapshotStore = {
    async getLatestRunwaySnapshot(context, runwayPlanId) {
      const org = scoped(context);
      const rows = snapshots
        .filter(
          (row) => row.organizationId === org.organizationId && row.runwayPlanId === runwayPlanId,
        )
        .sort((a, b) => {
          const byTime = b.createdAt.getTime() - a.createdAt.getTime();
          if (byTime !== 0) return byTime;
          return b.id.localeCompare(a.id);
        });
      return rows[0] ? clone(rows[0]) : null;
    },
    async insertRunwaySnapshot(record) {
      requireOrgContext(record.organizationId);
      snapshots.push(clone(record));
    },
  };

  return {
    recordAuditEvent(event) {
      auditEvents.push({ ...event });
    },
    async loadFacts(context): Promise<BreathLoadedFacts> {
      const org = scoped(context);
      const [
        settings,
        transactions,
        commitments,
        budgets,
        fundingNeeds,
        idealBudgets,
        runwayPlans,
        reconciliations,
        inceptions,
      ] = await Promise.all([
        deps.catalog.getPublicationSettings(org),
        deps.treasury.listTransactions(org),
        deps.treasury.listCommitments(org),
        deps.catalog.listBudgets(org),
        deps.catalog.listFundingNeeds(org),
        deps.catalog.listIdealBudgets(org),
        deps.catalog.listRunwayPlans(org),
        deps.watcher.listBalanceReconciliations(org),
        deps.treasury.listInceptions(org),
      ]);
      return {
        settings,
        transactions,
        commitments,
        budgets,
        fundingNeeds,
        idealBudgets,
        runwayPlans,
        reconciliations,
        inceptions,
      };
    },
    getLatestRunwaySnapshot: store.getLatestRunwaySnapshot,
    insertRunwaySnapshot: store.insertRunwaySnapshot,
    async listIdealBudgetAuditTimes(context, idealId) {
      const org = scoped(context);
      return auditEvents
        .filter(
          (row) =>
            row.organizationId === org.organizationId &&
            row.entityType === treasuryEntityTypes.idealBudget &&
            row.entityId === idealId &&
            (row.action === treasuryAuditActions.idealBudgetCreate ||
              row.action === treasuryAuditActions.idealBudgetPublish),
        )
        .map((row) => row.createdAt);
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
