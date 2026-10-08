/** Browser-safe exact received-amount arithmetic and optional financial capability state.
 * No venue parser, credentials, server module, I/O, conversion or PnL inference. */
import type { HtxV5Bill } from "./htx-v5-read-contract";
import type { HtxV5AccountObservation, HtxV5BillsObservation, HtxV5FinancialHistoryScope,
  HtxV5FinancialUnavailableReason } from "../types";

export const HTX_V5_BILL_CATEGORIES = Object.freeze({
  "3": "CLOSE_LONG", "4": "CLOSE_SHORT",
  "5": "OPEN_FEE_TAKER", "6": "OPEN_FEE_MAKER",
  "7": "CLOSE_FEE_TAKER", "8": "CLOSE_FEE_MAKER",
  "9": "DELIVERY_CLOSE_LONG", "10": "DELIVERY_CLOSE_SHORT", "11": "DELIVERY_FEE",
  "12": "LIQUIDATION_CLOSE_LONG", "13": "LIQUIDATION_CLOSE_SHORT",
  "14": "SPOT_TO_CONTRACT_TRANSFER", "15": "CONTRACT_TO_SPOT_TRANSFER",
  "16": "UNREALIZED_SETTLEMENT_LONG", "17": "UNREALIZED_SETTLEMENT_SHORT",
  "19": "CLAWBACK", "26": "SYSTEM", "28": "ACTIVITY_REWARD", "29": "REBATE",
  "30": "FUNDING_INCOME", "31": "FUNDING_EXPENDITURE",
  "34": "TRANSFER_TO_SUB", "35": "TRANSFER_FROM_SUB",
  "36": "TRANSFER_TO_MASTER", "37": "TRANSFER_FROM_MASTER",
  "38": "TRANSFER_FROM_MARGIN_ACCOUNT", "39": "TRANSFER_TO_MARGIN_ACCOUNT",
  "46": "ADL_CLOSE_LONG", "47": "ADL_CLOSE_SHORT",
  "66": "SYSTEM_ADVANCE_TRANSFER_OUT", "67": "SYSTEM_ADVANCE_TRANSFER_IN",
  "141": "LIQUIDATION_FEE",
} as const);

export type HtxV5BillCategory = (typeof HTX_V5_BILL_CATEGORIES)[keyof typeof HTX_V5_BILL_CATEGORIES] | "UNKNOWN";
export type HtxV5ObservedBillGroup = Readonly<{
  currency: string;
  type: string;
  category: HtxV5BillCategory;
  observedAmountSum: string;
  recordCount: number;
}>;

type Amount = Readonly<{ coefficient: bigint; scale: number }>;
const invalid = (reason: string): never => { throw new Error(`HTX_V5_BILL_BREAKDOWN_${reason}`); };

function exactAmount(raw: string): Amount {
  // Parser already preserves the lexeme; arithmetic is intentionally more bounded.
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(raw);
  if (!match || raw.length > 80) return invalid("UNSUPPORTED_AMOUNT");
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  if (Math.abs(exponent) > 128) return invalid("UNSUPPORTED_AMOUNT");
  const fraction = match[3] ?? "";
  const scale = fraction.length - exponent;
  return { coefficient: BigInt(`${match[1]}${match[2]}${fraction}`), scale };
}

function add(left: Amount, right: Amount): Amount {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient: left.coefficient * 10n ** BigInt(scale - left.scale) +
      right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function decimal(value: Amount): string {
  if (value.coefficient === 0n) return "0";
  const sign = value.coefficient < 0n ? "-" : "";
  const digits = (value.coefficient < 0n ? -value.coefficient : value.coefficient).toString();
  if (value.scale <= 0) return sign + digits + "0".repeat(-value.scale);
  const padded = digits.padStart(value.scale + 1, "0");
  return sign + `${padded.slice(0, -value.scale)}.${padded.slice(-value.scale)}`.replace(/\.?0+$/, "");
}

export function htxV5BillGroups(rows: readonly HtxV5Bill[]): readonly HtxV5ObservedBillGroup[] {
  const groups = new Map<string, { currency: string; type: string; category: HtxV5BillCategory; amount: Amount; count: number }>();
  for (const row of rows) {
    const category = Object.hasOwn(HTX_V5_BILL_CATEGORIES, row.type)
      ? HTX_V5_BILL_CATEGORIES[row.type as keyof typeof HTX_V5_BILL_CATEGORIES] : "UNKNOWN";
    if (row.category !== category) return invalid("INVALID_CATEGORY");
    const amount = exactAmount(row.amount);
    const key = `${row.currency}\u0000${row.type}`;
    const prior = groups.get(key);
    groups.set(key, { currency: row.currency, type: row.type, category,
      amount: prior ? add(prior.amount, amount) : amount, count: (prior?.count ?? 0) + 1 });
  }
  return Object.freeze([...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([, group]): HtxV5ObservedBillGroup => Object.freeze({ currency: group.currency, type: group.type,
      category: group.category, observedAmountSum: decimal(group.amount), recordCount: group.count })));
}

export function financialScopeUnavailable(scope: Pick<HtxV5FinancialHistoryScope, "validFromMs" | "validUntilMs">,
  nowMs: number): HtxV5FinancialUnavailableReason | null {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("HTX_V5_INVALID_RESPONSE");
  return nowMs < scope.validFromMs ? "SCOPE_NOT_YET_VALID" : nowMs >= scope.validUntilMs ? "SCOPE_EXPIRED" : null;
}

export function unavailableHtxV5Bills(scope: Omit<HtxV5FinancialHistoryScope, "enabled">,
  reason: HtxV5FinancialUnavailableReason): HtxV5BillsObservation {
  return Object.freeze({ status: "UNAVAILABLE", unavailableReason: reason,
    scopeId: scope.scopeId, windowStartMs: scope.windowStartMs, windowEndMs: scope.windowEndMs,
    validFromMs: scope.validFromMs, validUntilMs: scope.validUntilMs,
    windowConvention: "START_INCLUSIVE_END_EXCLUSIVE", values: null, groups: null,
    readStartedAtMs: null, responseReceivedAtMs: null, readCompletedAtMs: null,
    responseGeneratedAtMs: null, error: null, pageScope: null, completeness: "UNKNOWN",
    amountSemantics: "RAW_SIGNED_AMOUNTS_NO_SIGN_CONVERSION",
    accountBinding: "NOT_ESTABLISHED_BY_BILLS_RESPONSE", netPnl: null, dailyPnl: null });
}

/** Only optional financial evidence is discarded. Base account authority is unchanged. */
export function htxV5FinancialScopeAt(projection: HtxV5AccountObservation, nowMs: number): HtxV5AccountObservation {
  if (projection.schemaVersion !== "htx-v5-observation/v2") return projection;
  const reason = financialScopeUnavailable(projection.bills, nowMs);
  if (!reason || projection.bills.status === "UNAVAILABLE" && projection.bills.unavailableReason === reason)
    return projection;
  const baseSuccessful = [projection.assetMode, projection.balance, projection.positions, projection.openOrders,
    projection.algoOrders, projection.fills].some(c => c.status === "COMPLETE" || c.status === "PARTIAL");
  return Object.freeze({ ...projection, htxUid: baseSuccessful ? projection.htxUid : null,
    bills: unavailableHtxV5Bills(projection.bills, reason) });
}
