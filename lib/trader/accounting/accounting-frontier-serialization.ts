import type {
  AccountingFrontierV1,
  AccountingStateV1,
} from "@/lib/trader/accounting/accounting-frontier.types";
import { resolveMonthKeyUtc } from "@/lib/trader/risk/drawdown-policy-evaluator";
import { addDecimal, compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";

export type AccountingFrontierRowV1 = {
  id: string;
  organizationId: string;
  accountKey: string;
  runId: string;
  accountingSequence: number;
  frontierAsOf: string;
  cash: string;
  positionQuantityJson: Record<string, string>;
  grossPositionBasisJson: Record<string, string>;
  netPositionBasisJson: Record<string, string>;
  grossRealizedPnl: string;
  netRealizedPnl: string;
  marksJson: AccountingStateV1["marks"];
  equity: string;
  equityHwm: string;
  accountDrawdownBps: number;
  sourceFillId: string | null;
  sourceEconomicsDigest: string;
  semanticContentDigest: string;
  idempotencyKey: string;
  schemaVersion: string;
};

export function accountingFrontierToRow(frontier: AccountingFrontierV1): AccountingFrontierRowV1 {
  const positionQuantityJson: Record<string, string> = {};
  const grossPositionBasisJson: Record<string, string> = {};
  const netPositionBasisJson: Record<string, string> = {};
  for (const [symbol, pos] of Object.entries(frontier.positions)) {
    positionQuantityJson[symbol] = pos.quantity;
    grossPositionBasisJson[symbol] = pos.grossPositionBasis;
    netPositionBasisJson[symbol] = pos.netPositionBasis;
  }
  return {
    id: frontier.id,
    organizationId: frontier.organizationId,
    accountKey: frontier.accountKey,
    runId: frontier.runId,
    accountingSequence: frontier.accountingSequence,
    frontierAsOf: frontier.frontierAsOf,
    cash: frontier.cash,
    positionQuantityJson,
    grossPositionBasisJson,
    netPositionBasisJson,
    grossRealizedPnl: frontier.grossRealizedPnl,
    netRealizedPnl: frontier.netRealizedPnl,
    marksJson: frontier.marks,
    equity: frontier.equity,
    equityHwm: frontier.equityHwm,
    accountDrawdownBps: frontier.accountDrawdownBps,
    sourceFillId: frontier.sourceFillId,
    sourceEconomicsDigest: frontier.sourceEconomicsDigest,
    semanticContentDigest: frontier.semanticContentDigest,
    idempotencyKey: frontier.idempotencyKey,
    schemaVersion: frontier.schemaVersion,
  };
}

export function accountingRowToFrontier(
  row: AccountingFrontierRowV1,
  consumedFillIds: string[],
): AccountingFrontierV1 {
  const positions: AccountingStateV1["positions"] = {};
  const symbols = new Set([
    ...Object.keys(row.positionQuantityJson),
    ...Object.keys(row.grossPositionBasisJson),
    ...Object.keys(row.netPositionBasisJson),
  ]);
  for (const symbol of symbols) {
    positions[symbol] = {
      quantity: row.positionQuantityJson[symbol] ?? "0",
      grossPositionBasis: row.grossPositionBasisJson[symbol] ?? "0",
      netPositionBasis: row.netPositionBasisJson[symbol] ?? "0",
    };
  }
  let markedPositionValue = "0";
  for (const [symbol, position] of Object.entries(positions)) {
    if (compareDecimal(position.quantity, "0") <= 0) {
      continue;
    }
    const mark = row.marksJson[symbol];
    if (mark) {
      markedPositionValue = addDecimal(
        markedPositionValue,
        multiplyDecimal(position.quantity, mark.price),
      );
    }
  }
  return {
    schemaVersion: row.schemaVersion as AccountingStateV1["schemaVersion"],
    engineId: "CANONICAL_CROSS_BACKEND_ACCOUNTING_ENGINE_V1",
    basisMethod: "DUAL_GROSS_NET_WEIGHTED_AVERAGE_BASIS_V1",
    organizationId: row.organizationId,
    accountKey: row.accountKey,
    runId: row.runId,
    accountingSequence: row.accountingSequence,
    frontierAsOf: row.frontierAsOf,
    monthKey: resolveMonthKeyUtc(row.frontierAsOf),
    cash: row.cash,
    positions,
    grossRealizedPnl: row.grossRealizedPnl,
    netRealizedPnl: row.netRealizedPnl,
    marks: row.marksJson,
    markedPositionValue,
    equity: row.equity,
    equityHwm: row.equityHwm,
    monthlyPeakHwm: row.equity,
    monthlyDrawdownBps: 0,
    strategyPeakHwmByKey: {},
    strategyDrawdownBpsByKey: {},
    accountDrawdownBps: row.accountDrawdownBps,
    consumedFillIds,
    id: row.id,
    sourceFillId: row.sourceFillId,
    sourceEconomicsDigest: row.sourceEconomicsDigest,
    semanticContentDigest: row.semanticContentDigest,
    idempotencyKey: row.idempotencyKey,
  };
}
