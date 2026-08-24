import type { TreasuryIdealBudgetRecord } from "@/lib/waia-core/treasury/admin/catalog-types";
import type {
  TreasuryCommitmentRecord,
  TreasuryInceptionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import type { TreasuryBalanceReconciliationRecord } from "@/lib/waia-core/treasury/watcher/types";

export const TREASURY_FUND_ALLOCATION_POLICY_CODE =
  "WAIA_DEVELOPMENT_FUND_EXCESS_ANNUAL_BUDGET" as const;
export const TREASURY_FUND_ALLOCATION_POLICY_VERSION = 1 as const;
export const TREASURY_FUND_ALLOCATION_ACCOUNTING_CURRENCY = "USD" as const;

export const fundAllocationUnavailableReasons = {
  IDEAL_BUDGET_MISSING: "IDEAL_BUDGET_MISSING",
  IDEAL_BUDGET_AMBIGUOUS: "IDEAL_BUDGET_AMBIGUOUS",
  MATERIAL_RECONCILIATION_REQUIRED: "MATERIAL_RECONCILIATION_REQUIRED",
  BALANCE_RECONCILIATION_MISSING: "BALANCE_RECONCILIATION_MISSING",
  BALANCE_RECONCILIATION_STALE: "BALANCE_RECONCILIATION_STALE",
  BALANCE_RECONCILIATION_UNAVAILABLE: "BALANCE_RECONCILIATION_UNAVAILABLE",
  BALANCE_RECONCILIATION_MISMATCH: "BALANCE_RECONCILIATION_MISMATCH",
  BALANCE_RECONCILIATION_SCOPE_INVALID: "BALANCE_RECONCILIATION_SCOPE_INVALID",
  BALANCE_RECONCILIATION_PENDING_UNEXPLAINED: "BALANCE_RECONCILIATION_PENDING_UNEXPLAINED",
  ACCOUNTING_BALANCE_MISMATCH: "ACCOUNTING_BALANCE_MISMATCH",
  VERIFIED_FINANCIAL_ROW_INCOMPLETE: "VERIFIED_FINANCIAL_ROW_INCOMPLETE",
  NEGATIVE_FREE_FUNDS: "NEGATIVE_FREE_FUNDS",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
} as const;

export type FundAllocationUnavailableReason =
  (typeof fundAllocationUnavailableReasons)[keyof typeof fundAllocationUnavailableReasons];

export type FundAllocationFacts = {
  transactions: TreasuryTransactionRecord[];
  commitments: TreasuryCommitmentRecord[];
  idealBudgets: TreasuryIdealBudgetRecord[];
  reconciliations: TreasuryBalanceReconciliationRecord[];
  inceptions: TreasuryInceptionRecord[];
};

export type FundAllocationAmounts = {
  operatingAllocationMicros: bigint;
  developmentAllocationMicros: bigint;
};

export type FundAllocationEvidenceRecord = {
  id: string;
  organizationId: string;
  policyCode: typeof TREASURY_FUND_ALLOCATION_POLICY_CODE;
  policyVersion: typeof TREASURY_FUND_ALLOCATION_POLICY_VERSION;
  accountingCurrency: string;
  idealAnnualBudgetId: string;
  balanceReconciliationId: string;
  accountingAsOf: Date;
  accountingCashBalanceMicros: bigint;
  activeCommitmentsMicros: bigint;
  canonicalFreeFundsMicros: bigint;
  protectedAnnualBudgetMicros: bigint;
  operatingAllocationMicros: bigint;
  developmentAllocationMicros: bigint;
  inputDigest: string;
  outputDigest: string;
  createdAt: Date;
};

export type FundAllocationCurrent =
  | {
      status: "unavailable";
      reason: FundAllocationUnavailableReason;
    }
  | {
      status: "available";
      evidence: FundAllocationEvidenceRecord;
    };

export type EvaluatedFundAllocationInput = {
  facts: FundAllocationFacts;
  idealBudget: TreasuryIdealBudgetRecord;
  reconciliation: TreasuryBalanceReconciliationRecord;
  activeInception: TreasuryInceptionRecord;
  accountingCurrency: string;
  accountingCashBalanceMicros: bigint;
  activeCommitmentsMicros: bigint;
  canonicalFreeFundsMicros: bigint;
  protectedAnnualBudgetMicros: bigint;
};
