import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { isActiveCommittedStatus } from "@/lib/waia-core/treasury/commitment-fsm";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { USDT_NOMINAL_USD_POLICY_V1 } from "@/lib/waia-core/treasury/types";
import {
  computeVerifiedAccountingTotals,
  deriveActiveCommittedFunds,
} from "@/lib/waia-core/treasury/breath/accounting";
import {
  evaluateBalanceReconciliationGate,
  evaluateMaterialUnresolvedReconciliation,
  latestReconciliation,
  selectApplicablePublicIdeals,
} from "@/lib/waia-core/treasury/breath/publication-gates";
import { computeVirtualFundAllocation } from "@/lib/waia-core/treasury/allocation/engine";
import {
  computeFundAllocationInputDigest,
  computeFundAllocationOutputDigest,
} from "@/lib/waia-core/treasury/allocation/digest";
import type { FundAllocationRepository } from "@/lib/waia-core/treasury/allocation/repository.types";
import {
  fundAllocationUnavailableReasons,
  TREASURY_FUND_ALLOCATION_ACCOUNTING_CURRENCY,
  TREASURY_FUND_ALLOCATION_POLICY_CODE,
  TREASURY_FUND_ALLOCATION_POLICY_VERSION,
  type EvaluatedFundAllocationInput,
  type FundAllocationCurrent,
  type FundAllocationFacts,
  type FundAllocationUnavailableReason,
} from "@/lib/waia-core/treasury/allocation/types";

function mapBalanceReason(reason: string | null): FundAllocationUnavailableReason {
  switch (reason) {
    case "BALANCE_RECONCILIATION_STALE":
      return fundAllocationUnavailableReasons.BALANCE_RECONCILIATION_STALE;
    case "BALANCE_RECONCILIATION_UNAVAILABLE":
      return fundAllocationUnavailableReasons.BALANCE_RECONCILIATION_UNAVAILABLE;
    case "BALANCE_RECONCILIATION_MISMATCH":
      return fundAllocationUnavailableReasons.BALANCE_RECONCILIATION_MISMATCH;
    case "BALANCE_RECONCILIATION_SCOPE_INVALID":
      return fundAllocationUnavailableReasons.BALANCE_RECONCILIATION_SCOPE_INVALID;
    case "BALANCE_RECONCILIATION_PENDING_UNEXPLAINED":
      return fundAllocationUnavailableReasons.BALANCE_RECONCILIATION_PENDING_UNEXPLAINED;
    default:
      return fundAllocationUnavailableReasons.BALANCE_RECONCILIATION_MISSING;
  }
}

export function evaluateFundAllocationFacts(
  facts: FundAllocationFacts,
  now: Date,
):
  | { status: "unavailable"; reason: FundAllocationUnavailableReason }
  | { status: "available"; input: EvaluatedFundAllocationInput } {
  const ideals = selectApplicablePublicIdeals(facts.idealBudgets, now);
  if (ideals.length === 0) {
    return { status: "unavailable", reason: fundAllocationUnavailableReasons.IDEAL_BUDGET_MISSING };
  }
  if (ideals.length !== 1) {
    return {
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.IDEAL_BUDGET_AMBIGUOUS,
    };
  }
  if (evaluateMaterialUnresolvedReconciliation(facts.transactions)) {
    return {
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.MATERIAL_RECONCILIATION_REQUIRED,
    };
  }
  const reconciliation = latestReconciliation(facts.reconciliations);
  const balanceGate = evaluateBalanceReconciliationGate({
    latest: reconciliation,
    inceptions: facts.inceptions,
    now,
  });
  if (!balanceGate.ok || !reconciliation) {
    return { status: "unavailable", reason: mapBalanceReason(balanceGate.reason) };
  }
  const activeInceptions = facts.inceptions.filter((row) => row.status === "ACTIVE");
  if (activeInceptions.length !== 1) {
    return {
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.BALANCE_RECONCILIATION_SCOPE_INVALID,
    };
  }
  const idealBudget = ideals[0]!;
  if (idealBudget.currency !== TREASURY_FUND_ALLOCATION_ACCOUNTING_CURRENCY) {
    return { status: "unavailable", reason: fundAllocationUnavailableReasons.CURRENCY_MISMATCH };
  }
  const activeCommitments = facts.commitments.filter((row) => isActiveCommittedStatus(row.status));
  if (activeCommitments.some((row) => row.currency !== idealBudget.currency)) {
    return { status: "unavailable", reason: fundAllocationUnavailableReasons.CURRENCY_MISMATCH };
  }
  if (
    facts.transactions.some(
      (row) =>
        row.status === "VERIFIED" &&
        row.accountingDenominationPolicy !== USDT_NOMINAL_USD_POLICY_V1,
    )
  ) {
    return { status: "unavailable", reason: fundAllocationUnavailableReasons.CURRENCY_MISMATCH };
  }

  let accountingCashBalanceMicros: bigint;
  try {
    accountingCashBalanceMicros = computeVerifiedAccountingTotals(
      facts.transactions,
    ).accountingCashBalance;
  } catch (error) {
    if (
      error instanceof TreasuryValidationError &&
      error.reasonCode === "VERIFIED_FINANCIAL_ROW_INCOMPLETE"
    ) {
      return {
        status: "unavailable",
        reason: fundAllocationUnavailableReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE,
      };
    }
    throw error;
  }
  if (reconciliation.accountingCashBalanceMicros !== accountingCashBalanceMicros) {
    return {
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.ACCOUNTING_BALANCE_MISMATCH,
    };
  }
  const activeCommitmentsMicros = deriveActiveCommittedFunds(facts.commitments);
  const canonicalFreeFundsMicros = accountingCashBalanceMicros - activeCommitmentsMicros;
  if (accountingCashBalanceMicros < 0n || canonicalFreeFundsMicros < 0n) {
    return {
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.NEGATIVE_FREE_FUNDS,
    };
  }
  return {
    status: "available",
    input: {
      facts,
      idealBudget,
      reconciliation,
      activeInception: activeInceptions[0]!,
      accountingCurrency: TREASURY_FUND_ALLOCATION_ACCOUNTING_CURRENCY,
      accountingCashBalanceMicros,
      activeCommitmentsMicros,
      canonicalFreeFundsMicros,
      protectedAnnualBudgetMicros: idealBudget.amountMicros,
    },
  };
}

export type TreasuryFundAllocationService = {
  getCurrent(context: OrgContext): Promise<FundAllocationCurrent>;
};

export function createTreasuryFundAllocationService(deps: {
  repository: FundAllocationRepository;
  now?: () => Date;
  newId?: () => string;
}): TreasuryFundAllocationService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  return {
    async getCurrent(context) {
      const org = requireOrgContext(context.organizationId);
      return deps.repository.runExclusive(org.organizationId, async (store) => {
        const evaluatedAt = now();
        const facts = await store.loadFacts(org);
        const evaluation = evaluateFundAllocationFacts(facts, evaluatedAt);
        if (evaluation.status === "unavailable") return evaluation;

        const inputDigest = computeFundAllocationInputDigest(evaluation.input);
        const existing = await store.getEvidenceByInputDigest(org, inputDigest);
        if (existing) return { status: "available", evidence: existing };

        const amounts = computeVirtualFundAllocation({
          canonicalFreeFundsMicros: evaluation.input.canonicalFreeFundsMicros,
          protectedAnnualBudgetMicros: evaluation.input.protectedAnnualBudgetMicros,
        });
        const outputDigest = computeFundAllocationOutputDigest({
          inputDigest,
          accountingCurrency: evaluation.input.accountingCurrency,
          canonicalFreeFundsMicros: evaluation.input.canonicalFreeFundsMicros,
          protectedAnnualBudgetMicros: evaluation.input.protectedAnnualBudgetMicros,
          amounts,
        });
        const evidence = await store.insertEvidence({
          id: newId(),
          organizationId: org.organizationId,
          policyCode: TREASURY_FUND_ALLOCATION_POLICY_CODE,
          policyVersion: TREASURY_FUND_ALLOCATION_POLICY_VERSION,
          accountingCurrency: evaluation.input.accountingCurrency,
          idealAnnualBudgetId: evaluation.input.idealBudget.id,
          balanceReconciliationId: evaluation.input.reconciliation.id,
          accountingAsOf: evaluation.input.reconciliation.asOfTime,
          accountingCashBalanceMicros: evaluation.input.accountingCashBalanceMicros,
          activeCommitmentsMicros: evaluation.input.activeCommitmentsMicros,
          canonicalFreeFundsMicros: evaluation.input.canonicalFreeFundsMicros,
          protectedAnnualBudgetMicros: evaluation.input.protectedAnnualBudgetMicros,
          ...amounts,
          inputDigest,
          outputDigest,
          createdAt: evaluatedAt,
        });
        return { status: "available", evidence };
      });
    },
  };
}
