import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/catalog-repository.types";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import type {
  ContributionShareFacts,
  ContributionShareFactsRepository,
} from "@/lib/waia-core/treasury/share/repository.types";
import type { ShareAttributionFact } from "@/lib/waia-core/treasury/share/types";

function scoped(context: OrgContext): OrgContext {
  return requireOrgContext(context.organizationId);
}

/**
 * Memory share facts. Transactions are loaded via `listTransactions(context)`
 * with NO query object (complete org set). Attributions are the union of the
 * catalog org list and per-transaction domain rows, keyed by attribution id.
 */
export function createMemoryContributionShareFactsRepository(deps: {
  treasury: TreasuryRepository;
  catalog?: TreasuryCatalogRepository;
}): ContributionShareFactsRepository {
  return {
    async loadFacts(context): Promise<ContributionShareFacts> {
      const org = scoped(context);
      const transactions = await deps.treasury.listTransactions(org);
      const byId = new Map<string, ShareAttributionFact>();
      if (deps.catalog) {
        for (const row of await deps.catalog.listOrgAttributions(org)) {
          byId.set(row.id, {
            id: row.id,
            organizationId: row.organizationId,
            transactionId: row.transactionId,
            status: row.status,
            contributorUserId: row.contributorUserId,
            revokedAt: row.revokedAt,
            createdAt: row.createdAt,
            attributedAt: row.attributedAt,
          });
        }
      }
      for (const tx of transactions) {
        for (const row of await deps.treasury.listAttributions(org, tx.id)) {
          if (byId.has(row.id)) continue;
          byId.set(row.id, {
            id: row.id,
            organizationId: row.organizationId,
            transactionId: row.transactionId,
            status: row.status,
            contributorUserId: row.contributorUserId,
            revokedAt: row.revokedAt,
            createdAt: null,
            attributedAt: null,
          });
        }
      }
      return { transactions, attributions: [...byId.values()] };
    },
  };
}
