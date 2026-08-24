import { isActiveCommittedStatus } from "@/lib/waia-core/treasury/commitment-fsm";
import { computeTreasuryContentDigest } from "@/lib/waia-core/treasury/digest";
import type {
  EvaluatedFundAllocationInput,
  FundAllocationAmounts,
} from "@/lib/waia-core/treasury/allocation/types";
import {
  TREASURY_FUND_ALLOCATION_POLICY_CODE,
  TREASURY_FUND_ALLOCATION_POLICY_VERSION,
} from "@/lib/waia-core/treasury/allocation/types";

export function computeFundAllocationInputDigest(input: EvaluatedFundAllocationInput): string {
  const verifiedTransactions = [...input.facts.transactions]
    .filter((row) => row.status === "VERIFIED")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      cashEffectMicros: row.cashEffectMicros?.toString(10) ?? null,
      accountingDenominationPolicy: row.accountingDenominationPolicy,
      recordContentDigest: row.recordContentDigest,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }));
  const activeCommitments = [...input.facts.commitments]
    .filter((row) => isActiveCommittedStatus(row.status))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      amountMicros: row.amountMicros.toString(10),
      currency: row.currency,
      status: row.status,
      recordContentDigest: row.recordContentDigest,
      updatedAt: row.updatedAt.toISOString(),
    }));
  return computeTreasuryContentDigest({
    schema: "treasury-fund-allocation-input-v1",
    policyCode: TREASURY_FUND_ALLOCATION_POLICY_CODE,
    policyVersion: TREASURY_FUND_ALLOCATION_POLICY_VERSION,
    accountingCurrency: input.accountingCurrency,
    verifiedTransactions,
    activeCommitments,
    idealBudget: {
      id: input.idealBudget.id,
      periodYear: input.idealBudget.periodYear,
      currency: input.idealBudget.currency,
      amountMicros: input.idealBudget.amountMicros.toString(10),
      effectiveFrom: input.idealBudget.effectiveFrom.toISOString(),
      effectiveTo: input.idealBudget.effectiveTo?.toISOString() ?? null,
      status: input.idealBudget.status,
      publicationState: input.idealBudget.publicationState,
    },
    reconciliation: {
      id: input.reconciliation.id,
      ledgerInceptionId: input.reconciliation.ledgerInceptionId,
      asOfBlock: input.reconciliation.asOfBlock,
      asOfTime: input.reconciliation.asOfTime.toISOString(),
      accountingCashBalanceMicros:
        input.reconciliation.accountingCashBalanceMicros?.toString(10) ?? null,
      observedOnchainBalanceAtomic:
        input.reconciliation.observedOnchainBalanceAtomic?.toString(10) ?? null,
      deltaMicros: input.reconciliation.deltaMicros?.toString(10) ?? null,
      explainedPendingMicros: input.reconciliation.explainedPendingMicros.toString(10),
      unexplainedResidualMicros:
        input.reconciliation.unexplainedResidualMicros?.toString(10) ?? null,
      status: input.reconciliation.status,
      toleranceMicros: input.reconciliation.toleranceMicros.toString(10),
      createdAt: input.reconciliation.createdAt.toISOString(),
    },
    activeInceptionId: input.activeInception.id,
    accountingCashBalanceMicros: input.accountingCashBalanceMicros.toString(10),
    activeCommitmentsMicros: input.activeCommitmentsMicros.toString(10),
    canonicalFreeFundsMicros: input.canonicalFreeFundsMicros.toString(10),
    protectedAnnualBudgetMicros: input.protectedAnnualBudgetMicros.toString(10),
  });
}

export function computeFundAllocationOutputDigest(input: {
  inputDigest: string;
  accountingCurrency: string;
  canonicalFreeFundsMicros: bigint;
  protectedAnnualBudgetMicros: bigint;
  amounts: FundAllocationAmounts;
}): string {
  return computeTreasuryContentDigest({
    schema: "treasury-fund-allocation-output-v1",
    policyCode: TREASURY_FUND_ALLOCATION_POLICY_CODE,
    policyVersion: TREASURY_FUND_ALLOCATION_POLICY_VERSION,
    inputDigest: input.inputDigest,
    accountingCurrency: input.accountingCurrency,
    canonicalFreeFundsMicros: input.canonicalFreeFundsMicros.toString(10),
    protectedAnnualBudgetMicros: input.protectedAnnualBudgetMicros.toString(10),
    operatingAllocationMicros: input.amounts.operatingAllocationMicros.toString(10),
    developmentAllocationMicros: input.amounts.developmentAllocationMicros.toString(10),
  });
}
