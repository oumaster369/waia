import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  FundAllocationEvidenceRecord,
  FundAllocationFacts,
} from "@/lib/waia-core/treasury/allocation/types";

export type FundAllocationStore = {
  loadFacts(context: OrgContext): Promise<FundAllocationFacts>;
  getEvidenceByInputDigest(
    context: OrgContext,
    inputDigest: string,
  ): Promise<FundAllocationEvidenceRecord | null>;
  getLatestEvidence(context: OrgContext): Promise<FundAllocationEvidenceRecord | null>;
  insertEvidence(record: FundAllocationEvidenceRecord): Promise<FundAllocationEvidenceRecord>;
};

export type FundAllocationRepository = FundAllocationStore & {
  runExclusive<T>(
    organizationId: string,
    fn: (store: FundAllocationStore) => Promise<T>,
  ): Promise<T>;
};
