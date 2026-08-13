import { serializeDecimalBigint } from "@/lib/waia-core/treasury/admin/money";
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

export const BREATH_RECON_MAX_AGE_MS = 10 * 60 * 1000;
export const BREATH_DAY_MS = 86_400_000n;
/** Display-only fill-ratio scale. 6 decimal places. Never accounting authority. */
export const BREATH_FILL_RATIO_SCALE = 1_000_000n;
export const ELIGIBLE_PUBLIC_FUNDING_NEED_STATUSES = ["OPEN", "PARTIALLY_FUNDED"] as const;

export const breathPendingReasons = {
  BREATH_DISABLED: "BREATH_DISABLED",
  IDEAL_BUDGET_MISSING: "IDEAL_BUDGET_MISSING",
  IDEAL_BUDGET_AMBIGUOUS: "IDEAL_BUDGET_AMBIGUOUS",
  MATERIAL_RECONCILIATION_REQUIRED: "MATERIAL_RECONCILIATION_REQUIRED",
  BALANCE_RECONCILIATION_MISSING: "BALANCE_RECONCILIATION_MISSING",
  BALANCE_RECONCILIATION_STALE: "BALANCE_RECONCILIATION_STALE",
  BALANCE_RECONCILIATION_UNAVAILABLE: "BALANCE_RECONCILIATION_UNAVAILABLE",
  BALANCE_RECONCILIATION_MISMATCH: "BALANCE_RECONCILIATION_MISMATCH",
  BALANCE_RECONCILIATION_PENDING_UNEXPLAINED: "BALANCE_RECONCILIATION_PENDING_UNEXPLAINED",
  BALANCE_RECONCILIATION_SCOPE_INVALID: "BALANCE_RECONCILIATION_SCOPE_INVALID",
  VERIFIED_FINANCIAL_ROW_INCOMPLETE: "VERIFIED_FINANCIAL_ROW_INCOMPLETE",
  ACTIVE_PUBLIC_BUDGET_AMBIGUOUS: "ACTIVE_PUBLIC_BUDGET_AMBIGUOUS",
  PUBLIC_FUNDING_NEED_AMBIGUOUS: "PUBLIC_FUNDING_NEED_AMBIGUOUS",
  ACTIVE_RUNWAY_PLAN_AMBIGUOUS: "ACTIVE_RUNWAY_PLAN_AMBIGUOUS",
  RUNWAY_DATE_OUT_OF_RANGE: "RUNWAY_DATE_OUT_OF_RANGE",
  IDENTITY_MISMATCH: "IDENTITY_MISMATCH",
} as const;

export type BreathPendingReason = (typeof breathPendingReasons)[keyof typeof breathPendingReasons];

export type TreasuryRunwaySnapshotRecord = {
  id: string;
  organizationId: string;
  runwayPlanId: string;
  runwayAsOf: Date;
  freeFundsAtAsOfMicros: bigint;
  approvedDailyBurnMicros: bigint;
  endsAt: Date;
  inputDigest: string;
  createdAt: Date;
};

export type BreathMoney = string;

export type BreathPublicActivity = {
  occurredAt: string;
  kind: string | null;
  direction: string;
  publicDescription: string | null;
  cashEffectMicros: BreathMoney | null;
  accountingAmountMicros: BreathMoney | null;
  counterpartyDisplay: string | null;
};

export type BreathRunwayDto =
  | { status: "pending" }
  | {
      status: "available";
      runwayAsOf: string;
      endsAt: string;
      freeFundsAtAsOf: BreathMoney;
      approvedDailyBurn: BreathMoney;
    };

export type BreathResourcesDto = {
  entered: BreathMoney;
  spent: BreathMoney;
  remaining: BreathMoney;
  allocated: BreathMoney;
  neededNext: BreathMoney | null;
};

export type BreathBudgetDto = {
  code: string;
  title: string;
  currency: string;
  planned: BreathMoney;
  funded: BreathMoney;
  committed: BreathMoney;
  spent: BreathMoney;
  remaining: BreathMoney;
  fillRatio: number;
};

export type BreathIdealBudgetDto = {
  periodYear: number;
  currency: string;
  amount: BreathMoney;
};

export type BreathPublicSnapshot = {
  status: "pending" | "published";
  lastUpdatedAt: string | null;
  stageLabel: string | null;
  work: string | null;
  methodologyNote: string | null;
  idealAnnualBudget: BreathIdealBudgetDto | null;
  resources: BreathResourcesDto | null;
  currentFreeFunds: BreathMoney | null;
  budget: BreathBudgetDto | null;
  runway: BreathRunwayDto;
  recentActivity: BreathPublicActivity[];
};

export type BreathAdminPreview = BreathPublicSnapshot & {
  pendingReasons: BreathPendingReason[];
  componentStatus: {
    breathEnabled: boolean;
    idealBudget: "ok" | "missing" | "ambiguous";
    materialReconciliation: boolean;
    balanceReconciliation:
      | "ok"
      | "missing"
      | "stale"
      | "unavailable"
      | "mismatch"
      | "scope_invalid"
      | "pending_unexplained";
    budget: "ok" | "absent" | "ambiguous";
    fundingNeed: "ok" | "absent" | "ambiguous";
    verifiedFinancialComplete: boolean;
  };
  reconciliationGate: {
    latestId: string | null;
    status: string | null;
    createdAt: string | null;
  };
  runwayStatus: {
    status: BreathRunwayDto["status"];
    reason: BreathPendingReason | null;
    snapshotId: string | null;
  };
};

export type BreathAccountingTotals = {
  accountingCashBalance: bigint;
  entered: bigint;
  spent: bigint;
  remaining: bigint;
};

export type BreathFacts = {
  now: Date;
  settings: TreasuryPublicationSettingsRecord | null;
  transactions: readonly TreasuryTransactionRecord[];
  commitments: readonly TreasuryCommitmentRecord[];
  budgets: readonly TreasuryBudgetRecord[];
  fundingNeeds: readonly TreasuryFundingNeedRecord[];
  idealBudgets: readonly TreasuryIdealBudgetRecord[];
  runwayPlans: readonly TreasuryRunwayPlanRecord[];
  reconciliations: readonly TreasuryBalanceReconciliationRecord[];
  inceptions: readonly TreasuryInceptionRecord[];
};

export function moneyString(value: bigint): string {
  const serialized = serializeDecimalBigint(value);
  if (serialized === null) {
    throw new Error("money serialization produced null");
  }
  return serialized;
}
