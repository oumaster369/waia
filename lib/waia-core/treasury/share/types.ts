export type ContributionShareExact = {
  numeratorMicros: string;
  denominatorMicros: string;
  isZeroShare: boolean;
};

export type PublicContributionAggregate = {
  totalNetContributionMicros: string;
  qualifyingContributionCount: number;
  lastUpdatedAt: string | null;
};

export type SelfContributionShare = ContributionShareExact & {
  lastUpdatedAt: string | null;
};

export type SelfContributionHistoryRow = {
  transactionId: string;
  occurredAt: string;
  contributedAmountMicros: string;
};

export type SelfContributionRecord = SelfContributionShare & {
  partsPerMillion: string;
  contributions: SelfContributionHistoryRow[];
};

export type ShareAttributionFact = {
  id: string;
  organizationId: string;
  transactionId: string;
  status: "UNMATCHED" | "ATTRIBUTED" | "ANONYMOUS" | "REVOKED";
  contributorUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date | null;
  attributedAt: Date | null;
};
