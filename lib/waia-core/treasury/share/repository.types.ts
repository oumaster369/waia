import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";
import type { ShareAttributionFact } from "@/lib/waia-core/treasury/share/types";

/**
 * Complete, unpaginated contribution-share facts.
 * Must never call `TreasuryRepository.listTransactions(context, query)`.
 *
 * Public aggregate must load contribution facts only.
 * Self-share loads contribution facts and attribution facts separately.
 */
export type ContributionShareFactsRepository = {
  loadContributionFacts(context: OrgContext): Promise<TreasuryTransactionRecord[]>;
  loadAttributionFacts(context: OrgContext): Promise<ShareAttributionFact[]>;
};
