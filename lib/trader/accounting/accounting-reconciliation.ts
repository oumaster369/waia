import {
  grossUnrealizedPnl,
  netUnrealizedPnl,
  remainingGrossPositionBasis,
  remainingNetPositionBasis,
} from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { accountingInvariantCodes } from "@/lib/trader/accounting/accounting-invariant-codes";
import type {
  AccountingReconciliationInput,
  AccountingReconciliationResult,
  AccountingReconciliationViolation,
  HistoricalRealityReconciliationReport,
} from "@/lib/trader/accounting/accounting-reconciliation.types";
import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

function violation(
  code: AccountingReconciliationViolation["code"],
  message: string,
): AccountingReconciliationViolation {
  return { code, message };
}

export function reconcileAccountingInvariants(
  input: AccountingReconciliationInput,
): AccountingReconciliationResult {
  const violations: AccountingReconciliationViolation[] = [];
  const { state } = input;

  const expectedEquity = addDecimal(state.cash, state.markedPositionValue);
  if (compareDecimal(state.equity, expectedEquity) !== 0) {
    violations.push(
      violation(
        accountingInvariantCodes.cashEquityConservation,
        `equity ${state.equity} != cash ${state.cash} + marked ${state.markedPositionValue}`,
      ),
    );
  }

  if (input.inventoryOpenQtyBySymbol) {
    for (const [symbol, expectedQty] of Object.entries(input.inventoryOpenQtyBySymbol)) {
      const actualQty = state.positions[symbol]?.quantity ?? "0";
      if (compareDecimal(actualQty, expectedQty) !== 0) {
        violations.push(
          violation(
            accountingInvariantCodes.inventoryParity,
            `inventory mismatch for ${symbol}: expected ${expectedQty}, actual ${actualQty}`,
          ),
        );
      }
    }
  }

  const grossUnrealized = grossUnrealizedPnl(state);
  const netUnrealized = netUnrealizedPnl(state);
  const grossTotal = addDecimal(state.grossRealizedPnl, grossUnrealized);
  const netTotal = addDecimal(state.netRealizedPnl, netUnrealized);
  const executionCost = subtractDecimal(grossTotal, netTotal);
  const grossMinusCost = subtractDecimal(grossTotal, executionCost);
  if (compareDecimal(grossMinusCost, netTotal) !== 0) {
    violations.push(
      violation(
        accountingInvariantCodes.grossNetExecutionCost,
        `grossResult - executionCost != netResult`,
      ),
    );
  }

  const terminalEquityFromPnl = addDecimal(
    input.startingEquityUsdt,
    addDecimal(state.netRealizedPnl, netUnrealized),
  );
  if (compareDecimal(state.equity, terminalEquityFromPnl) !== 0) {
    violations.push(
      violation(
        accountingInvariantCodes.startingEquityTerminal,
        `startingEquity + netResult != terminalEquity`,
      ),
    );
  }

  if (
    input.equitySeriesTerminal &&
    compareDecimal(input.equitySeriesTerminal, state.equity) !== 0
  ) {
    violations.push(
      violation(
        accountingInvariantCodes.equitySeriesTerminal,
        `equity-series terminal != account equity`,
      ),
    );
  }

  if (input.cashEvents) {
    const seen = new Set<string>();
    let cashSum = input.startingCashUsdt;
    for (const event of input.cashEvents) {
      if (seen.has(event.fillId)) {
        violations.push(
          violation(
            accountingInvariantCodes.oneConsumptionPerFill,
            `duplicate cash event for fill ${event.fillId}`,
          ),
        );
      }
      seen.add(event.fillId);
      cashSum = addDecimal(cashSum, event.netCashEffect);
    }
    if (compareDecimal(state.cash, cashSum) !== 0) {
      violations.push(
        violation(
          accountingInvariantCodes.cashLedgerTerminal,
          `cash-ledger terminal != terminal cash`,
        ),
      );
    }
    for (const fillId of state.consumedFillIds) {
      if (!seen.has(fillId)) {
        violations.push(
          violation(
            accountingInvariantCodes.cashEventIntegrity,
            `missing cash event for consumed fill ${fillId}`,
          ),
        );
      }
    }
  }

  if (
    input.expectedAccountingSequence != null &&
    state.accountingSequence !== input.expectedAccountingSequence
  ) {
    violations.push(
      violation(
        accountingInvariantCodes.sequenceContiguous,
        `accounting sequence ${state.accountingSequence} != expected ${input.expectedAccountingSequence}`,
      ),
    );
  }

  if (input.pnlReport) {
    if (compareDecimal(input.pnlReport.terminalEquityUsdt, state.equity) !== 0) {
      violations.push(
        violation(
          accountingInvariantCodes.pnlReportTerminal,
          `PnL report terminal equity != accounting state`,
        ),
      );
    }
    if (compareDecimal(input.pnlReport.terminalCashUsdt, state.cash) !== 0) {
      violations.push(
        violation(
          accountingInvariantCodes.pnlReportTerminal,
          `PnL report terminal cash != accounting state`,
        ),
      );
    }
  }

  return { pass: violations.length === 0, violations };
}

export function buildHistoricalRealityReconciliationReport(
  input: AccountingReconciliationInput,
): HistoricalRealityReconciliationReport {
  const result = reconcileAccountingInvariants(input);
  return {
    ...result,
    organizationId: input.state.organizationId,
    accountKey: input.state.accountKey,
    runId: input.state.runId,
    accountingSequence: input.state.accountingSequence,
    terminalEquityUsdt: input.state.equity,
    terminalCashUsdt: input.state.cash,
  };
}

export function assertAccountingReconciliation(input: AccountingReconciliationInput): void {
  const result = reconcileAccountingInvariants(input);
  if (!result.pass) {
    const messages = result.violations.map((v) => `${v.code}: ${v.message}`).join("; ");
    throw new Error(`[accounting/reconciliation] fail-closed: ${messages}`);
  }
}

export { remainingGrossPositionBasis, remainingNetPositionBasis };
