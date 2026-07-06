import type { GuardianDecision } from "@/lib/trader/guardian/guardian.types";
import { guardianReasonCodes } from "@/lib/trader/guardian/guardian-reason-codes";
import { capSellQuantityToInventory } from "@/lib/trader/paper/derive-canonical-inventory";
import { floorToMinQty } from "@/lib/trader/portfolio/stop-based-sizing";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { multiplyDecimal } from "@/lib/trader/risk/numeric";

export type ComputeExitQuantityInput = {
  decision: GuardianDecision;
  ruleReasonCode: string;
  remainingQty: string;
  partialExitFraction?: string;
  symbol: string;
  minOrderQty: string;
  openQtyBySymbol?: ReadonlyMap<string, string>;
  batchAllocatedBySymbol?: Map<string, string>;
};

export type ComputeExitQuantityResult = {
  approvedQty: string;
  requestedQty: string;
  inventoryAvailableQty: string;
  effectiveDecision: GuardianDecision;
  effectiveReasonCode: string;
  inventoryCapApplied: boolean;
  partialExitFraction: string | null;
  belowMinQty: boolean;
};

export function computeExitQuantity(input: ComputeExitQuantityInput): ComputeExitQuantityResult {
  const requestedQty =
    input.decision === "EXIT_PARTIAL" && input.partialExitFraction
      ? floorToMinQty(
          multiplyDecimal(input.remainingQty, input.partialExitFraction),
          input.minOrderQty,
        )
      : input.remainingQty;

  let inventoryAvailableQty = requestedQty;
  let approvedQty = requestedQty;

  if (input.openQtyBySymbol) {
    inventoryAvailableQty = capSellQuantityToInventory({
      symbol: input.symbol,
      requestedQty,
      openQtyBySymbol: input.openQtyBySymbol,
      batchAllocatedBySymbol: input.batchAllocatedBySymbol,
    });
    approvedQty = inventoryAvailableQty;
  }

  const inventoryCapApplied =
    compareDecimal(approvedQty, requestedQty) < 0 && compareDecimal(approvedQty, "0") > 0;

  let effectiveDecision = input.decision;
  let effectiveReasonCode = input.ruleReasonCode;

  if (
    inventoryCapApplied ||
    (compareDecimal(approvedQty, input.remainingQty) < 0 && compareDecimal(approvedQty, "0") > 0)
  ) {
    effectiveDecision = "EXIT_PARTIAL";
    if (input.ruleReasonCode !== guardianReasonCodes.inventoryCappedPartial) {
      effectiveReasonCode = guardianReasonCodes.inventoryCappedPartial;
    }
  } else if (
    input.decision === "EXIT_PARTIAL" &&
    compareDecimal(approvedQty, input.remainingQty) === 0
  ) {
    effectiveDecision = "EXIT_FULL";
  }

  const belowMinQty =
    compareDecimal(approvedQty, "0") > 0 && compareDecimal(approvedQty, input.minOrderQty) < 0;

  return {
    approvedQty,
    requestedQty,
    inventoryAvailableQty,
    effectiveDecision,
    effectiveReasonCode,
    inventoryCapApplied,
    partialExitFraction:
      input.decision === "EXIT_PARTIAL" ? (input.partialExitFraction ?? null) : null,
    belowMinQty,
  };
}
