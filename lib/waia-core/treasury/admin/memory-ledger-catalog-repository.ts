import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryLedgerCatalogRepository } from "@/lib/waia-core/treasury/admin/ledger-catalog-repository.types";
import type {
  TreasuryCategoryBudgetHistoryRecord,
  TreasuryCategoryRecord,
  TreasuryCounterpartyRecord,
  TreasuryLedgerCatalogQuery,
  TreasuryLedgerCatalogRecord,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-types";
import { TreasuryNotFoundError } from "@/lib/waia-core/treasury/errors";

function key(organizationId: string, id: string): string {
  return `${organizationId}:${id}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nameOf(row: TreasuryLedgerCatalogRecord): string {
  return "displayName" in row ? row.displayName : row.name;
}

function listRows<T extends TreasuryLedgerCatalogRecord>(
  rows: Map<string, T>,
  context: OrgContext,
  query: TreasuryLedgerCatalogQuery,
): T[] {
  const org = requireOrgContext(context.organizationId);
  const q = query.q?.trim().toLocaleLowerCase();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100) + 1;
  return [...rows.values()]
    .filter((row) => row.organizationId === org.organizationId)
    .filter((row) => query.active === undefined || row.isActive === query.active)
    .filter((row) => !q || nameOf(row).toLocaleLowerCase().includes(q))
    .filter((row) => {
      if (!query.afterName || !query.afterId) return true;
      const name = nameOf(row);
      const nameOrder = name.localeCompare(query.afterName);
      return nameOrder > 0 || (nameOrder === 0 && row.id.localeCompare(query.afterId) > 0);
    })
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(clone);
}

function methods<T extends TreasuryLedgerCatalogRecord>(entity: string, rows: Map<string, T>) {
  return {
    async list(context: OrgContext, query: TreasuryLedgerCatalogQuery) {
      return listRows(rows, context, query);
    },
    async get(context: OrgContext, id: string) {
      const org = requireOrgContext(context.organizationId);
      const row = rows.get(key(org.organizationId, id));
      return row ? clone(row) : null;
    },
    async insert(record: T) {
      requireOrgContext(record.organizationId);
      rows.set(key(record.organizationId, record.id), clone(record));
    },
    async update(context: OrgContext, id: string, patch: Partial<T>) {
      const org = requireOrgContext(context.organizationId);
      const scopedKey = key(org.organizationId, id);
      const current = rows.get(scopedKey);
      if (!current) throw new TreasuryNotFoundError(entity, id);
      const next = { ...current, ...patch, id: current.id, organizationId: current.organizationId };
      rows.set(scopedKey, clone(next));
      return clone(next);
    },
  };
}

export function createMemoryTreasuryLedgerCatalogRepository(): TreasuryLedgerCatalogRepository {
  const counterparties = new Map<string, TreasuryCounterpartyRecord>();
  const categories = new Map<string, TreasuryCategoryRecord>();
  const categoryBudgetHistory = new Map<string, TreasuryCategoryBudgetHistoryRecord>();
  const categoryMethods = methods("category", categories);
  return {
    counterparties: {
      ...methods("counterparty", counterparties),
      async findByWaiaUserId(context, waiaUserId) {
        const org = requireOrgContext(context.organizationId);
        const row = [...counterparties.values()].find(
          (candidate) =>
            candidate.organizationId === org.organizationId && candidate.waiaUserId === waiaUserId,
        );
        return row ? clone(row) : null;
      },
    },
    accounts: methods("account", new Map()),
    categories: {
      ...categoryMethods,
      async findByCode(context, code) {
        const org = requireOrgContext(context.organizationId);
        const row = [...categories.values()].find(
          (candidate) => candidate.organizationId === org.organizationId && candidate.code === code,
        );
        return row ? clone(row) : null;
      },
      async insertWithBudget(record, budget) {
        await categoryMethods.insert(record);
        categoryBudgetHistory.set(
          `${budget.organizationId}:${budget.categoryId}:${budget.effectiveMonth}`,
          clone(budget),
        );
      },
      async updateWithBudget(context, id, patch, budget) {
        const updated = await categoryMethods.update(context, id, patch);
        if (budget) {
          const historyKey = `${budget.organizationId}:${budget.categoryId}:${budget.effectiveMonth}`;
          const current = categoryBudgetHistory.get(historyKey);
          categoryBudgetHistory.set(
            historyKey,
            clone(
              current
                ? { ...current, ...budget, id: current.id, createdAt: current.createdAt }
                : budget,
            ),
          );
        }
        return updated;
      },
    },
    categoryBudgetHistory: {
      async list(context) {
        const org = requireOrgContext(context.organizationId);
        return [...categoryBudgetHistory.values()]
          .filter((row) => row.organizationId === org.organizationId)
          .sort(
            (a, b) =>
              a.effectiveMonth.localeCompare(b.effectiveMonth) ||
              a.categoryId.localeCompare(b.categoryId),
          )
          .map(clone);
      },
    },
    projects: methods("project", new Map()),
  };
}
