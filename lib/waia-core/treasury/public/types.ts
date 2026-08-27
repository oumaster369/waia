export const PUBLIC_TREASURY_SCHEMA_VERSION = "waia-public-treasury/v1" as const;
export const PUBLIC_TREASURY_TRANSACTION_LIMIT = 100;
/** 1,000,000 parts represent 100%. Display-only; exact money remains numerator/denominator. */
export const PUBLIC_TREASURY_SHARE_SCALE = 1_000_000n;

export const publicTreasuryPendingReasons = {
  PUBLICATION_DISABLED: "PUBLICATION_DISABLED",
  ANNUAL_BUDGET_UNAVAILABLE: "ANNUAL_BUDGET_UNAVAILABLE",
  BALANCE_CONFIRMATION_PENDING: "BALANCE_CONFIRMATION_PENDING",
  FINANCIAL_RECORD_INCOMPLETE: "FINANCIAL_RECORD_INCOMPLETE",
  RUNWAY_UNAVAILABLE: "RUNWAY_UNAVAILABLE",
  ANNUAL_BUDGET_DETAILS_UNAVAILABLE: "ANNUAL_BUDGET_DETAILS_UNAVAILABLE",
  PATRON_ATTRIBUTION_UNAVAILABLE: "PATRON_ATTRIBUTION_UNAVAILABLE",
} as const;

export type PublicTreasuryPendingReason =
  (typeof publicTreasuryPendingReasons)[keyof typeof publicTreasuryPendingReasons];

export type PublicTreasuryStatus = "pending" | "published";

export type PublicTreasuryRunway =
  | { status: "pending" }
  | {
      status: "published";
      asOf: string;
      endsAt: string;
    };

export type PublicTreasuryBreath = {
  status: PublicTreasuryStatus;
  pendingReasons: PublicTreasuryPendingReason[];
  availableAmountMicros: string | null;
  availableCurrency: string | null;
  runway: PublicTreasuryRunway;
  annualBudgetAmountMicros: string | null;
  annualBudgetCurrency: string | null;
  lastUpdatedAt: string | null;
};
export type PublicTreasuryBudgetCategory = {
  code: string;
  name: string;
  groupName: string;
  currency: string;
  budgetMicros: string;
  spentMicros: string;
  remainingMicros: string;
};

export type PublicTreasuryBudgetGroup = {
  groupName: string;
  currency: string;
  budgetMicros: string;
  spentMicros: string;
  remainingMicros: string;
};

export type PublicTreasuryBudgetMonth = {
  month: string;
  categories: PublicTreasuryBudgetCategory[];
  groups: PublicTreasuryBudgetGroup[];
};

export type PublicTreasuryBudget = {
  status: PublicTreasuryStatus;
  year: number | null;
  currency: string | null;
  annualBudgetAmountMicros: string | null;
  months: PublicTreasuryBudgetMonth[];
};

export type PublicTreasuryTransaction = {
  occurredAt: string;
  amountMicros: string;
  currency: string;
  categoryName: string | null;
  categoryGroup: string | null;
  projectName: string | null;
  description: string | null;
};

export type PublicTreasuryFundingNeed = {
  title: string;
  explanation: string | null;
  targetStage: string | null;
  status: "OPEN" | "PARTIALLY_FUNDED";
  currency: string;
  requiredAmountMicros: string;
  fundedAmountMicros: string;
  remainingAmountMicros: string;
};

export type PublicTreasuryShare = {
  numeratorMicros: string;
  denominatorMicros: string;
  partsPerMillion: string;
};

export type PublicTreasuryPatron = {
  displayName: string;
  publicSiteUrl: string | null;
  twinProfileUrl: string | null;
  contributedAmountMicros: string;
  currency: string;
  share: PublicTreasuryShare;
};

export type PublicTreasuryPrivateSupport = {
  contributedAmountMicros: string;
  currency: string;
  share: PublicTreasuryShare;
};

export type PublicTreasuryPatrons = {
  status: PublicTreasuryStatus;
  totalContributedAmountMicros: string | null;
  currency: string | null;
  patrons: PublicTreasuryPatron[];
  privateSupport: PublicTreasuryPrivateSupport | null;
  lastUpdatedAt: string | null;
};

export type PublicTreasuryFundAllocation =
  | { status: "pending"; reason: string }
  | {
      status: "published";
      currency: string;
      allocationAsOf: string;
      canonicalFreeFundsMicros: string;
      protectedAnnualBudgetMicros: string;
      operatingAllocationMicros: string;
      developmentAllocationMicros: string;
      policyCode: string;
      policyVersion: number;
    };

export type PublicTreasuryProjection = {
  schemaVersion: typeof PUBLIC_TREASURY_SCHEMA_VERSION;
  breath: PublicTreasuryBreath;
  budget: PublicTreasuryBudget;
  transactions: PublicTreasuryTransaction[];
  transactionPagination: {
    offset: number;
    limit: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  fundingNeeds: PublicTreasuryFundingNeed[];
  patrons: PublicTreasuryPatrons;
  funds: PublicTreasuryFundAllocation;
};
