import type {
  TreasuryFundingNeedRecord,
  TreasuryIdealBudgetRecord,
  TreasuryPublicationSettingsRecord,
  TreasuryRunwayPlanRecord,
} from "@/lib/waia-core/treasury/admin/catalog-types";
import type {
  TreasuryCategoryBudgetHistoryRecord,
  TreasuryCategoryRecord,
  TreasuryProjectRecord,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  TreasuryBalanceCheckpointRecord,
  TreasuryRunwaySnapshotRecord,
} from "@/lib/waia-core/treasury/breath/types";
import type {
  TreasuryCommitmentRecord,
  TreasuryInceptionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import type { TreasuryBalanceReconciliationRecord } from "@/lib/waia-core/treasury/watcher/types";

export type PublicTreasuryAttributionFact = {
  id: string;
  organizationId: string;
  transactionId: string;
  status: "UNMATCHED" | "ATTRIBUTED" | "ANONYMOUS" | "REVOKED";
  contributorUserId: string | null;
  consentPublicIdentity: boolean;
  publicSiteUrl: string | null;
  twinProfileUrl: string | null;
  createdAt: Date;
  attributedAt: Date | null;
  revokedAt: Date | null;
};

export type PublicTreasuryProfileFact = {
  userId: string;
  displayName: string;
  updatedAt: Date;
};

export type PublicTreasuryIdealAuditFact = {
  entityId: string;
  createdAt: Date;
};

export type PublicTreasuryFacts = {
  organizationId: string;
  settings: TreasuryPublicationSettingsRecord | null;
  transactions: TreasuryTransactionRecord[];
  commitments: TreasuryCommitmentRecord[];
  fundingNeeds: TreasuryFundingNeedRecord[];
  idealBudgets: TreasuryIdealBudgetRecord[];
  runwayPlans: TreasuryRunwayPlanRecord[];
  runwaySnapshots: TreasuryRunwaySnapshotRecord[];
  reconciliations: TreasuryBalanceReconciliationRecord[];
  inceptions: TreasuryInceptionRecord[];
  balanceCheckpoints?: TreasuryBalanceCheckpointRecord[];
  categories: TreasuryCategoryRecord[];
  categoryBudgetHistory: TreasuryCategoryBudgetHistoryRecord[];
  projects: TreasuryProjectRecord[];
  attributions: PublicTreasuryAttributionFact[];
  profiles: PublicTreasuryProfileFact[];
  idealAuditFacts: PublicTreasuryIdealAuditFact[];
};

export type PublicTreasuryFactsRepository = {
  loadFacts(context: OrgContext): Promise<PublicTreasuryFacts>;
};
