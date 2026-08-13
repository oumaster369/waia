import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryRunwaySnapshotRecord } from "@/lib/waia-core/treasury/breath/types";
import type {
  TreasuryBudgetRecord,
  TreasuryFundingNeedRecord,
  TreasuryIdealBudgetRecord,
  TreasuryPublicationSettingsRecord,
  TreasuryRunwayPlanRecord,
} from "@/lib/waia-core/treasury/admin/catalog-types";
import type {
  TreasuryCommitmentRecord,
  TreasuryInceptionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import type { TreasuryBalanceReconciliationRecord } from "@/lib/waia-core/treasury/watcher/types";

/**
 * Complete, unpaginated Breath facts. Must never call
 * `TreasuryRepository.listTransactions(context, query)` — that admin listing
 * primitive defaults to 50 rows and is forbidden as financial truth.
 */
export type BreathLoadedFacts = {
  settings: TreasuryPublicationSettingsRecord | null;
  transactions: TreasuryTransactionRecord[];
  commitments: TreasuryCommitmentRecord[];
  budgets: TreasuryBudgetRecord[];
  fundingNeeds: TreasuryFundingNeedRecord[];
  idealBudgets: TreasuryIdealBudgetRecord[];
  runwayPlans: TreasuryRunwayPlanRecord[];
  reconciliations: TreasuryBalanceReconciliationRecord[];
  inceptions: TreasuryInceptionRecord[];
};

export type BreathSnapshotStore = {
  getLatestRunwaySnapshot(
    context: OrgContext,
    runwayPlanId: string,
  ): Promise<TreasuryRunwaySnapshotRecord | null>;
  insertRunwaySnapshot(record: TreasuryRunwaySnapshotRecord): Promise<void>;
};

export type BreathIdealAuditEvent = {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: string;
  createdAt: Date;
};

export type BreathFactsRepository = BreathSnapshotStore & {
  loadFacts(context: OrgContext): Promise<BreathLoadedFacts>;
  listIdealBudgetAuditTimes(context: OrgContext, idealId: string): Promise<Date[]>;
  runExclusive<T>(
    organizationId: string,
    fn: (store: BreathSnapshotStore) => Promise<T>,
  ): Promise<T>;
};
