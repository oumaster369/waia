import { parseHtxV5Bills, type HtxV5BillCategory } from "./htx-v5-read-contract";

export type HtxV5ObservedBillGroup = Readonly<{
  currency: string;
  type: string;
  category: HtxV5BillCategory;
  observedAmountSum: string;
  recordCount: number;
}>;

export type HtxV5BillBreakdown = Readonly<{
  status: "OBSERVED_RECORDS_ONLY" | "NO_OBSERVED_RECORDS";
  windowStartMs: number;
  windowEndMs: number;
  windowConvention: "START_INCLUSIVE_END_EXCLUSIVE";
  pagesRead: number;
  observedRecordCount: number;
  groups: readonly HtxV5ObservedBillGroup[];
  completeness: "unknown";
  amountSemantics: "RAW_SIGNED_AMOUNTS_NO_SIGN_CONVERSION";
  accountBinding: "NOT_ESTABLISHED_BY_BILLS_RESPONSE";
  netPnl: null;
  dailyPnl: null;
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

/** UNWIRED observed-record arithmetic, not a daily ledger acceptance or net result.
 * Caller must separately establish common account/current-key scope for all pages.
 * Reject duplicate IDs across pages and any row outside the explicit window; no
 * deduplication, ordering/exhaustion inference, fills join, currency conversion or I/O.
 * At most ten 100-row pages is a local resource bound, not a venue history guarantee. */
export function htxV5BillBreakdown(input: Readonly<{
  payloads: readonly string[];
  windowStartMs: number;
  windowEndMs: number;
}>): HtxV5BillBreakdown {
  const { payloads, windowStartMs, windowEndMs } = input;
  if (!Number.isSafeInteger(windowStartMs) || !Number.isSafeInteger(windowEndMs) ||
    windowStartMs < 0 || windowEndMs <= windowStartMs || windowEndMs > 8.64e15) return invalid("INVALID_WINDOW");
  if (!Array.isArray(payloads) || payloads.length > 10) return invalid("PAGE_BOUND");
  const seen = new Set<string>();
  const groups = new Map<string, { currency: string; type: string; category: HtxV5BillCategory; amount: Amount; count: number }>();
  for (const payload of payloads) {
    const page = parseHtxV5Bills(payload);
    for (const row of page.rows) {
      if (seen.has(row.id)) return invalid("DUPLICATE_ID");
      seen.add(row.id);
      if (row.createdTimeMs < windowStartMs || row.createdTimeMs >= windowEndMs) return invalid("OUTSIDE_WINDOW");
      const amount = exactAmount(row.amount);
      const key = `${row.currency}\u0000${row.type}`;
      const prior = groups.get(key);
      groups.set(key, { currency: row.currency, type: row.type, category: row.category,
        amount: prior ? add(prior.amount, amount) : amount, count: (prior?.count ?? 0) + 1 });
    }
  }
  const observedGroups = [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([, group]): HtxV5ObservedBillGroup => Object.freeze({
      currency: group.currency, type: group.type, category: group.category,
      observedAmountSum: decimal(group.amount), recordCount: group.count,
    }));
  return Object.freeze({
    status: seen.size ? "OBSERVED_RECORDS_ONLY" : "NO_OBSERVED_RECORDS",
    windowStartMs, windowEndMs, windowConvention: "START_INCLUSIVE_END_EXCLUSIVE",
    pagesRead: payloads.length, observedRecordCount: seen.size, groups: Object.freeze(observedGroups),
    completeness: "unknown", amountSemantics: "RAW_SIGNED_AMOUNTS_NO_SIGN_CONVERSION",
    accountBinding: "NOT_ESTABLISHED_BY_BILLS_RESPONSE", netPnl: null, dailyPnl: null,
  });
}
