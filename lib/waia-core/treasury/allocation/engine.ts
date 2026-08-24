import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { requireBigint } from "@/lib/waia-core/treasury/money";
import type { FundAllocationAmounts } from "@/lib/waia-core/treasury/allocation/types";

export function computeVirtualFundAllocation(input: {
  canonicalFreeFundsMicros: bigint;
  protectedAnnualBudgetMicros: bigint;
}): FundAllocationAmounts {
  const free = requireBigint(input.canonicalFreeFundsMicros, "canonicalFreeFundsMicros");
  const budget = requireBigint(input.protectedAnnualBudgetMicros, "protectedAnnualBudgetMicros");
  if (free < 0n) {
    throw new TreasuryValidationError(
      "NEGATIVE_FREE_FUNDS",
      "canonical free funds must be non-negative",
    );
  }
  if (budget <= 0n) {
    throw new TreasuryValidationError(
      "ANNUAL_BUDGET_NOT_POSITIVE",
      "protected annual budget must be positive",
    );
  }
  const operatingAllocationMicros = free < budget ? free : budget;
  const developmentAllocationMicros = free > budget ? free - budget : 0n;
  if (operatingAllocationMicros + developmentAllocationMicros !== free) {
    throw new TreasuryValidationError(
      "FUND_ALLOCATION_CONSERVATION_MISMATCH",
      "operating plus Development Fund allocation must equal canonical free funds",
    );
  }
  return { operatingAllocationMicros, developmentAllocationMicros };
}
