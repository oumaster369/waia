import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";
import type { ShareAttributionFact } from "@/lib/waia-core/treasury/share/types";

/**
 * Complete, unpaginated contribution-share facts.
 * Must never call `TreasuryRepository.listTransactions(context, query)`.
 */
export type ContributionShareFacts = {
  transactions: TreasuryTransactionRecord[];
  attributions: ShareAttributionFact[];
};

export type ContributionShareFactsRepository = {
  loadFacts(context: OrgContext): Promise<ContributionShareFacts>;
};
