import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  TreasuryAccountRecord,
  TreasuryCategoryBudgetHistoryRecord,
  TreasuryCategoryRecord,
  TreasuryCounterpartyRecord,
  TreasuryLedgerCatalogQuery,
  TreasuryProjectRecord,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-types";

type CatalogRepositoryMethods<T> = {
  list(context: OrgContext, query: TreasuryLedgerCatalogQuery): Promise<T[]>;
  get(context: OrgContext, id: string): Promise<T | null>;
  insert(record: T): Promise<void>;
  update(context: OrgContext, id: string, patch: Partial<T>): Promise<T>;
};

export type TreasuryLedgerCatalogRepository = {
  counterparties: CatalogRepositoryMethods<TreasuryCounterpartyRecord> & {
    findByWaiaUserId(
      context: OrgContext,
      waiaUserId: string,
    ): Promise<TreasuryCounterpartyRecord | null>;
  };
  accounts: CatalogRepositoryMethods<TreasuryAccountRecord>;
  categories: CatalogRepositoryMethods<TreasuryCategoryRecord> & {
    findByCode(context: OrgContext, code: string): Promise<TreasuryCategoryRecord | null>;
    insertWithBudget(
      record: TreasuryCategoryRecord,
      budget: TreasuryCategoryBudgetHistoryRecord,
    ): Promise<void>;
    updateWithBudget(
      context: OrgContext,
      id: string,
      patch: Partial<TreasuryCategoryRecord>,
      budget?: TreasuryCategoryBudgetHistoryRecord,
    ): Promise<TreasuryCategoryRecord>;
  };
  categoryBudgetHistory: {
    list(context: OrgContext): Promise<TreasuryCategoryBudgetHistoryRecord[]>;
  };
  projects: CatalogRepositoryMethods<TreasuryProjectRecord>;
};
