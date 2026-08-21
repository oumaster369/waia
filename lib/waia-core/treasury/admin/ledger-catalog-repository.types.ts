import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  TreasuryAccountRecord,
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
  categories: CatalogRepositoryMethods<TreasuryCategoryRecord>;
  projects: CatalogRepositoryMethods<TreasuryProjectRecord>;
};
