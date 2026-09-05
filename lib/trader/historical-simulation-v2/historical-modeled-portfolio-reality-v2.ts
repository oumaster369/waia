import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { computeAccountingSemanticDigest } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  addDecimal,
  compareDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import type { RiskAccountAccountingV2 } from "@/lib/trader/risk/v2/risk-admission-service-v2";
import { evaluateLongOnlyExposureReductionV2 } from
  "@/lib/trader/risk/v2/protective-posture-v2";
import type { HistoricalPortfolioProposalV2 } from
  "@/lib/trader/backtest/historical-simulation-v2";

export const HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_V2_SCHEMA =
  "waia.trader.historical_modeled_portfolio_lifecycle.v2" as const;
export const HISTORICAL_MODELED_REALITY_V2_SCHEMA =
  "waia.trader.historical_modeled_reality.v2" as const;

const DIGEST = /^[0-9a-f]{64}$/;
const LIFECYCLE_KEYS = Object.freeze([
  "accountId", "accountingFrontierContentDigestHex", "action", "capitalEligible", "contentDigestHex",
  "cycleId", "exposureNotionalAfter", "exposureNotionalBefore", "organizationId",
  "positionQuantityAfter", "positionQuantityBefore", "quantity", "referencePrice", "runId",
  "schemaVersion", "source", "strictExposureReduction", "symbol", "transition", "transitionStatus",
].sort());
const REALITY_KEYS = Object.freeze([
  "accountDrawdownBps", "accountId", "accountingFrontierContentDigestHex", "accountingFrontierId",
  "asOfUtc", "capitalEligible", "cash", "contentDigestHex", "cycleId", "equity",
  "equityHighWaterMark", "organizationId", "portfolioLifecycleContentDigestHex", "positions",
  "realityClass", "reconciledExposureNotional", "runId", "schemaVersion", "source",
].sort());

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

type HistoricalModeledSourceV2 = Readonly<{
  source: "MODELED_HISTORICAL";
  capitalEligible: false;
}>;

export type HistoricalModeledRiskAccountingV2 = Readonly<{
  frontier: AccountingFrontierV1;
  frontierContentDigestHex: string;
  accounting: RiskAccountAccountingV2;
  openPositionCount: number;
}>;

export type HistoricalModeledPortfolioLifecycleReceiptV2 = HistoricalModeledSourceV2 & Readonly<{
  schemaVersion: typeof HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_V2_SCHEMA;
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  action: "ENTER_LONG" | "CASH" | "REDUCE" | "CLOSE";
  quantity: string | null;
  referencePrice: string;
  accountingFrontierContentDigestHex: string;
  positionQuantityBefore: string;
  positionQuantityAfter: string;
  exposureNotionalBefore: string;
  exposureNotionalAfter: string;
  strictExposureReduction: boolean;
  transition: "ENTER" | "NO_CHANGE" | "REDUCE" | "CLOSE";
  /** This is an order intent projection. Only a later Accounting Frontier may make it observed truth. */
  transitionStatus: "PRE_FILL_PROPOSAL";
  contentDigestHex: string;
}>;

export type HistoricalModeledRealityPositionV2 = Readonly<{
  symbol: string;
  quantity: string;
  markPrice: string;
  markedExposureNotional: string;
}>;

/**
 * Historical simulation truth is intentionally separate from canonical Reality V2.  It is an
 * immutable projection of the modeled Accounting Frontier and can never authorize capital.
 */
export type HistoricalModeledRealityV2 = HistoricalModeledSourceV2 & Readonly<{
  schemaVersion: typeof HISTORICAL_MODELED_REALITY_V2_SCHEMA;
  realityClass: "HISTORICAL_MODELED_ACCOUNTING_FRONTIER";
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  asOfUtc: string;
  accountingFrontierId: string;
  accountingFrontierContentDigestHex: string;
  portfolioLifecycleContentDigestHex: string;
  positions: readonly HistoricalModeledRealityPositionV2[];
  reconciledExposureNotional: string;
  cash: string;
  equity: string;
  equityHighWaterMark: string;
  accountDrawdownBps: number;
  contentDigestHex: string;
}>;

function canonicalNonnegative(value: string, field: string): string {
  const parsed = parseDecimal(value);
  if (parsed < 0n) throw new Error(`HISTORICAL_MODELED_PORTFOLIO_REFUSED:${field}`);
  return formatDecimal(parsed);
}

function assertUtc(value: string, field: string): void {
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`HISTORICAL_MODELED_PORTFOLIO_REFUSED:${field}`);
  }
}

function assertFrontierIdentity(input: Readonly<{
  frontier: AccountingFrontierV1;
  organizationId: string;
  accountId: string;
  runId: string;
}>): void {
  const frontier = input.frontier;
  if (frontier.organizationId !== input.organizationId || frontier.accountKey !== input.accountId ||
      frontier.runId !== input.runId || !DIGEST.test(frontier.semanticContentDigest) ||
      computeAccountingSemanticDigest(frontier) !== frontier.semanticContentDigest) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:ACCOUNTING_FRONTIER_IDENTITY");
  }
  assertUtc(frontier.frontierAsOf, "ACCOUNTING_FRONTIER_AS_OF");
}

function derivePositions(frontier: AccountingFrontierV1): readonly HistoricalModeledRealityPositionV2[] {
  const positions: HistoricalModeledRealityPositionV2[] = [];
  for (const [symbol, position] of Object.entries(frontier.positions).sort(([left], [right]) =>
    left.localeCompare(right))) {
    const quantity = canonicalNonnegative(position.quantity, "POSITION_QUANTITY");
    if (compareDecimal(quantity, "0") === 0) continue;
    const mark = frontier.marks[symbol];
    if (!mark) throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:MISSING_POSITION_MARK");
    const markPrice = canonicalNonnegative(mark.price, "MARK_PRICE");
    if (compareDecimal(markPrice, "0") <= 0) {
      throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:MARK_PRICE_NOT_POSITIVE");
    }
    assertUtc(mark.barCloseTime, "MARK_BAR_CLOSE_TIME");
    if (Date.parse(mark.barCloseTime) > Date.parse(frontier.frontierAsOf)) {
      throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:FUTURE_MARK");
    }
    positions.push(Object.freeze({
      symbol,
      quantity,
      markPrice,
      markedExposureNotional: multiplyDecimal(quantity, markPrice),
    }));
  }
  return Object.freeze(positions);
}

/** Derives current exposure from the exact sealed Accounting Frontier; callers cannot supply it. */
export function deriveHistoricalModeledRiskAccountingV2(input: Readonly<{
  frontier: AccountingFrontierV1;
  organizationId: string;
  accountId: string;
  runId: string;
  exposureLimitNotional: string;
  worstCasePendingExposureNotional: string;
  outstandingReservationNotional: string;
}>): HistoricalModeledRiskAccountingV2 {
  assertFrontierIdentity(input);
  const positions = derivePositions(input.frontier);
  const reconciledExposureNotional = positions.reduce((sum, position) =>
    addDecimal(sum, position.markedExposureNotional), "0");
  if (compareDecimal(reconciledExposureNotional, input.frontier.markedPositionValue) !== 0 ||
      compareDecimal(addDecimal(input.frontier.cash, reconciledExposureNotional), input.frontier.equity) !== 0) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:ACCOUNTING_EXPOSURE_DIVERGENT");
  }
  return Object.freeze({
    frontier: input.frontier,
    frontierContentDigestHex: input.frontier.semanticContentDigest,
    accounting: Object.freeze({
      reconciledExposureNotional,
      worstCasePendingExposureNotional: canonicalNonnegative(
        input.worstCasePendingExposureNotional, "PENDING_EXPOSURE"),
      outstandingReservationNotional: canonicalNonnegative(
        input.outstandingReservationNotional, "OUTSTANDING_RESERVATION"),
      exposureLimitNotional: canonicalNonnegative(input.exposureLimitNotional, "EXPOSURE_LIMIT"),
    }),
    openPositionCount: positions.length,
  });
}

/**
 * Adds the durable Accounting portfolio state to DEE-660's entry-only choice without inventing a
 * reduction signal.  An existing position is closed only when Decision selected CASH.  A repeated
 * ENTER becomes an explicit hold, and an in-flight modeled order suppresses any duplicate action.
 */
export function resolveHistoricalModeledPortfolioProposalV2(input: Readonly<{
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  decisionProposal: HistoricalPortfolioProposalV2;
  accounting: HistoricalModeledRiskAccountingV2;
  hasPendingModeledOrder: boolean;
}>): HistoricalPortfolioProposalV2 {
  assertFrontierIdentity({ frontier: input.accounting.frontier, organizationId: input.organizationId,
    accountId: input.accountId, runId: input.runId });
  if (input.accounting.frontierContentDigestHex !== input.accounting.frontier.semanticContentDigest ||
      !DIGEST.test(input.decisionProposal.proposalContentDigestHex) ||
      !DIGEST.test(input.decisionProposal.decisionContentDigestHex) ||
      !DIGEST.test(input.decisionProposal.whyNotCashReceiptDigestHex)) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:PROPOSAL_AUTHORITY");
  }
  const currentQuantity = canonicalNonnegative(
    input.accounting.frontier.positions[input.symbol]?.quantity ?? "0", "CURRENT_POSITION_QUANTITY");
  const hasPosition = compareDecimal(currentQuantity, "0") > 0;
  let action = input.decisionProposal.action;
  let quantity = input.decisionProposal.quantity;
  let portfolioReason: string | null = null;
  if (input.hasPendingModeledOrder) {
    action = "CASH";
    quantity = null;
    portfolioReason = "HISTORICAL_PORTFOLIO_ORDER_TRANSITION_PENDING";
  } else if (hasPosition && input.decisionProposal.action === "CASH") {
    action = "CLOSE";
    quantity = currentQuantity;
    portfolioReason = "HISTORICAL_PORTFOLIO_DECISION_CASH_CLOSES_OPEN_POSITION";
  } else if (hasPosition && input.decisionProposal.action === "ENTER_LONG") {
    action = "CASH";
    quantity = null;
    portfolioReason = "HISTORICAL_PORTFOLIO_POSITION_ALREADY_OPEN";
  }
  if (portfolioReason === null) return input.decisionProposal;
  const reasonCodes = Object.freeze([...input.decisionProposal.reasonCodes, portfolioReason]);
  const proposalBody = Object.freeze({
    schemaVersion: "waia.trader.historical_modeled_portfolio_proposal.v2",
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    accountingFrontierContentDigestHex: input.accounting.frontierContentDigestHex,
    sourceDecisionProposalContentDigestHex: input.decisionProposal.proposalContentDigestHex,
    hasPendingModeledOrder: input.hasPendingModeledOrder,
    positionQuantityBefore: currentQuantity,
    action,
    quantity,
    reasonCodes,
  });
  return Object.freeze({ ...input.decisionProposal, action, quantity, reasonCodes,
    portfolioReasonCodes: Object.freeze([portfolioReason]),
    proposalContentDigestHex: computeSemanticSha256Hex(proposalBody) });
}

export function buildHistoricalModeledPortfolioLifecycleV2(input: Readonly<{
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  action: "ENTER_LONG" | "CASH" | "REDUCE" | "CLOSE";
  quantity: string | null;
  referencePrice: string;
  accounting: HistoricalModeledRiskAccountingV2;
}>): HistoricalModeledPortfolioLifecycleReceiptV2 {
  assertFrontierIdentity({ frontier: input.accounting.frontier, organizationId: input.organizationId,
    accountId: input.accountId, runId: input.runId });
  if (input.accounting.frontierContentDigestHex !== input.accounting.frontier.semanticContentDigest) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:ACCOUNTING_DIGEST_MISMATCH");
  }
  const referencePrice = canonicalNonnegative(input.referencePrice, "REFERENCE_PRICE");
  if (compareDecimal(referencePrice, "0") <= 0) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:REFERENCE_PRICE_NOT_POSITIVE");
  }
  const current = canonicalNonnegative(
    input.accounting.frontier.positions[input.symbol]?.quantity ?? "0", "CURRENT_POSITION_QUANTITY");
  let quantity: string | null = null;
  let projected = current;
  let strictExposureReduction = false;
  let transition: HistoricalModeledPortfolioLifecycleReceiptV2["transition"] = "NO_CHANGE";

  if (input.action === "CASH") {
    if (input.quantity !== null) throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:CASH_QUANTITY");
  } else {
    if (input.quantity === null) throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:QUANTITY_REQUIRED");
    quantity = canonicalNonnegative(input.quantity, "QUANTITY");
    if (compareDecimal(quantity, "0") <= 0) {
      throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:QUANTITY_NOT_POSITIVE");
    }
    if (input.action === "ENTER_LONG") {
      if (compareDecimal(current, "0") !== 0) {
        throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:ENTER_REQUIRES_FLAT_POSITION");
      }
      projected = quantity;
      transition = "ENTER";
    } else {
      const reduction = evaluateLongOnlyExposureReductionV2({
        side: "SELL", currentBaseQuantity: current, requestedBaseQuantity: quantity,
      });
      if (!reduction.isStrictExposureReduction || reduction.projectedBaseQuantity === null) {
        throw new Error(`HISTORICAL_MODELED_PORTFOLIO_REFUSED:${reduction.reason}`);
      }
      projected = reduction.projectedBaseQuantity;
      strictExposureReduction = true;
      if (input.action === "REDUCE") {
        if (compareDecimal(projected, "0") <= 0) {
          throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:REDUCE_MUST_REMAIN_OPEN");
        }
        transition = "REDUCE";
      } else {
        if (compareDecimal(projected, "0") !== 0) {
          throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:CLOSE_MUST_FLATTEN");
        }
        transition = "CLOSE";
      }
    }
  }

  const body = {
    schemaVersion: HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_V2_SCHEMA,
    source: "MODELED_HISTORICAL" as const,
    capitalEligible: false as const,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    action: input.action,
    quantity,
    referencePrice,
    accountingFrontierContentDigestHex: input.accounting.frontierContentDigestHex,
    positionQuantityBefore: current,
    positionQuantityAfter: projected,
    exposureNotionalBefore: multiplyDecimal(current, referencePrice),
    exposureNotionalAfter: multiplyDecimal(projected, referencePrice),
    strictExposureReduction,
    transition,
    transitionStatus: "PRE_FILL_PROPOSAL" as const,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function assertHistoricalModeledPortfolioLifecycleV2(
  value: HistoricalModeledPortfolioLifecycleReceiptV2,
): void {
  const { contentDigestHex, ...body } = value;
  if (value.schemaVersion !== HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_V2_SCHEMA ||
      value.source !== "MODELED_HISTORICAL" || value.capitalEligible !== false ||
      !hasExactKeys(value, LIFECYCLE_KEYS) || value.organizationId.trim() === "" ||
      value.accountId.trim() === "" || value.runId.trim() === "" || value.cycleId.trim() === "" ||
      value.symbol.trim() === "" || !DIGEST.test(value.accountingFrontierContentDigestHex) ||
      !DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
  }
  if (value.transitionStatus !== "PRE_FILL_PROPOSAL") {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
  }
  const reference = canonicalNonnegative(value.referencePrice, "REFERENCE_PRICE");
  const before = canonicalNonnegative(value.positionQuantityBefore, "POSITION_BEFORE");
  const after = canonicalNonnegative(value.positionQuantityAfter, "POSITION_AFTER");
  if (reference !== value.referencePrice || before !== value.positionQuantityBefore ||
      after !== value.positionQuantityAfter || compareDecimal(reference, "0") <= 0 ||
      value.exposureNotionalBefore !== multiplyDecimal(before, reference) ||
      value.exposureNotionalAfter !== multiplyDecimal(after, reference)) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
  }
  if (value.action === "CASH") {
    if (value.quantity !== null || value.transition !== "NO_CHANGE" || value.strictExposureReduction ||
        compareDecimal(before, after) !== 0) {
      throw new Error("HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
    }
    return;
  }
  if (value.quantity === null) throw new Error("HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
  const quantity = canonicalNonnegative(value.quantity, "QUANTITY");
  if (quantity !== value.quantity) throw new Error("HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
  if (value.action === "ENTER_LONG") {
    if (value.transition !== "ENTER" || value.strictExposureReduction ||
        compareDecimal(before, "0") !== 0 || compareDecimal(after, quantity) !== 0) {
      throw new Error("HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
    }
    return;
  }
  const reduction = evaluateLongOnlyExposureReductionV2({ side: "SELL",
    currentBaseQuantity: before, requestedBaseQuantity: quantity });
  if (!reduction.isStrictExposureReduction || reduction.projectedBaseQuantity !== after ||
      !value.strictExposureReduction || (value.action === "REDUCE" &&
        (value.transition !== "REDUCE" || compareDecimal(after, "0") <= 0)) ||
      (value.action === "CLOSE" && (value.transition !== "CLOSE" || compareDecimal(after, "0") !== 0))) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
  }
}

export function buildHistoricalModeledRealityV2(input: Readonly<{
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  accounting: HistoricalModeledRiskAccountingV2;
  portfolioLifecycle: HistoricalModeledPortfolioLifecycleReceiptV2;
}>): HistoricalModeledRealityV2 {
  assertFrontierIdentity({ frontier: input.accounting.frontier, organizationId: input.organizationId,
    accountId: input.accountId, runId: input.runId });
  if (input.portfolioLifecycle.organizationId !== input.organizationId ||
      input.portfolioLifecycle.accountId !== input.accountId || input.portfolioLifecycle.runId !== input.runId ||
      input.portfolioLifecycle.cycleId !== input.cycleId ||
      input.portfolioLifecycle.accountingFrontierContentDigestHex !== input.accounting.frontierContentDigestHex) {
    throw new Error("HISTORICAL_MODELED_PORTFOLIO_REFUSED:LIFECYCLE_SCOPE_MISMATCH");
  }
  const lifecycleDigest = input.portfolioLifecycle.contentDigestHex;
  assertHistoricalModeledPortfolioLifecycleV2(input.portfolioLifecycle);
  const positions = derivePositions(input.accounting.frontier);
  const body = {
    schemaVersion: HISTORICAL_MODELED_REALITY_V2_SCHEMA,
    realityClass: "HISTORICAL_MODELED_ACCOUNTING_FRONTIER" as const,
    source: "MODELED_HISTORICAL" as const,
    capitalEligible: false as const,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    cycleId: input.cycleId,
    asOfUtc: input.accounting.frontier.frontierAsOf,
    accountingFrontierId: input.accounting.frontier.id,
    accountingFrontierContentDigestHex: input.accounting.frontierContentDigestHex,
    portfolioLifecycleContentDigestHex: lifecycleDigest,
    positions,
    reconciledExposureNotional: input.accounting.accounting.reconciledExposureNotional,
    cash: formatDecimal(parseDecimal(input.accounting.frontier.cash)),
    equity: formatDecimal(parseDecimal(input.accounting.frontier.equity)),
    equityHighWaterMark: formatDecimal(parseDecimal(input.accounting.frontier.equityHwm)),
    accountDrawdownBps: input.accounting.frontier.accountDrawdownBps,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function assertHistoricalModeledRealityV2(value: HistoricalModeledRealityV2): void {
  const { contentDigestHex, ...body } = value;
  if (value.schemaVersion !== HISTORICAL_MODELED_REALITY_V2_SCHEMA ||
      value.realityClass !== "HISTORICAL_MODELED_ACCOUNTING_FRONTIER" ||
      value.source !== "MODELED_HISTORICAL" || value.capitalEligible !== false ||
      !hasExactKeys(value, REALITY_KEYS) || value.organizationId.trim() === "" || value.accountId.trim() === "" ||
      value.runId.trim() === "" || value.cycleId.trim() === "" || value.accountingFrontierId.trim() === "" ||
      !DIGEST.test(value.accountingFrontierContentDigestHex) ||
      !DIGEST.test(value.portfolioLifecycleContentDigestHex) ||
      !Number.isSafeInteger(value.accountDrawdownBps) || value.accountDrawdownBps < 0 ||
      !DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex ||
      value.positions.reduce((sum, position) => addDecimal(sum, position.markedExposureNotional), "0") !==
        value.reconciledExposureNotional || compareDecimal(value.equity, addDecimal(value.cash,
        value.reconciledExposureNotional)) !== 0 || compareDecimal(subtractDecimal(value.equityHighWaterMark,
        value.equity), "0") < 0) {
    throw new Error("HISTORICAL_MODELED_REALITY_INVALID");
  }
  assertUtc(value.asOfUtc, "REALITY_AS_OF");
  let previousSymbol: string | null = null;
  for (const position of value.positions) {
    if (!hasExactKeys(position, ["markPrice", "markedExposureNotional", "quantity", "symbol"]) ||
        position.symbol.trim() === "" || (previousSymbol !== null && previousSymbol.localeCompare(position.symbol) >= 0) ||
        canonicalNonnegative(position.quantity, "REALITY_POSITION_QUANTITY") !== position.quantity ||
        compareDecimal(position.quantity, "0") <= 0 ||
        canonicalNonnegative(position.markPrice, "REALITY_MARK_PRICE") !== position.markPrice ||
        compareDecimal(position.markPrice, "0") <= 0 ||
        position.markedExposureNotional !== multiplyDecimal(position.quantity, position.markPrice)) {
      throw new Error("HISTORICAL_MODELED_REALITY_INVALID");
    }
    previousSymbol = position.symbol;
  }
  for (const [valueToCheck, field] of [[value.reconciledExposureNotional, "REALITY_EXPOSURE"],
    [value.cash, "REALITY_CASH"], [value.equity, "REALITY_EQUITY"],
    [value.equityHighWaterMark, "REALITY_EQUITY_HWM"]] as const) {
    if (formatDecimal(parseDecimal(valueToCheck)) !== valueToCheck) {
      throw new Error(`HISTORICAL_MODELED_REALITY_INVALID:${field}`);
    }
  }
}

export function assertHistoricalModeledRealityAgainstAccountingV2(input: Readonly<{
  reality: HistoricalModeledRealityV2;
  portfolioLifecycle: HistoricalModeledPortfolioLifecycleReceiptV2;
  accounting: HistoricalModeledRiskAccountingV2;
}>): void {
  assertHistoricalModeledRealityV2(input.reality);
  assertHistoricalModeledPortfolioLifecycleV2(input.portfolioLifecycle);
  const positions = derivePositions(input.accounting.frontier);
  const actualQuantity = input.accounting.frontier.positions[input.portfolioLifecycle.symbol]?.quantity ?? "0";
  if (input.reality.accountingFrontierId !== input.accounting.frontier.id ||
      input.reality.accountingFrontierContentDigestHex !== input.accounting.frontierContentDigestHex ||
      input.reality.portfolioLifecycleContentDigestHex !== input.portfolioLifecycle.contentDigestHex ||
      input.reality.reconciledExposureNotional !== input.accounting.accounting.reconciledExposureNotional ||
      canonicalClone(input.reality.positions) !== canonicalClone(positions) ||
      input.reality.cash !== formatDecimal(parseDecimal(input.accounting.frontier.cash)) ||
      input.reality.equity !== formatDecimal(parseDecimal(input.accounting.frontier.equity)) ||
      input.reality.equityHighWaterMark !== formatDecimal(parseDecimal(input.accounting.frontier.equityHwm)) ||
      input.reality.accountDrawdownBps !== input.accounting.frontier.accountDrawdownBps ||
      compareDecimal(input.portfolioLifecycle.positionQuantityBefore, actualQuantity) !== 0) {
    throw new Error("HISTORICAL_MODELED_REALITY_ACCOUNTING_DIVERGENT");
  }
}

function canonicalClone(value: unknown): string {
  return JSON.stringify(value);
}
