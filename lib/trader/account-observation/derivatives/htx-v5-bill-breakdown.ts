import { parseHtxV5Bills, type HtxV5Bill } from "./htx-v5-read-contract";
import { htxV5BillGroups, type HtxV5ObservedBillGroup } from "./htx-v5-bill-groups";
export type { HtxV5ObservedBillGroup } from "./htx-v5-bill-groups";
const invalid = (reason: string): never => { throw new Error(`HTX_V5_BILL_BREAKDOWN_${reason}`); };

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
  const rows: HtxV5Bill[] = [];
  for (const payload of payloads) {
    const page = parseHtxV5Bills(payload);
    for (const row of page.rows) {
      if (seen.has(row.id)) return invalid("DUPLICATE_ID");
      seen.add(row.id);
      if (row.createdTimeMs < windowStartMs || row.createdTimeMs >= windowEndMs) return invalid("OUTSIDE_WINDOW");
      rows.push(row);
    }
  }
  const observedGroups = htxV5BillGroups(rows);
  return Object.freeze({
    status: seen.size ? "OBSERVED_RECORDS_ONLY" : "NO_OBSERVED_RECORDS",
    windowStartMs, windowEndMs, windowConvention: "START_INCLUSIVE_END_EXCLUSIVE",
    pagesRead: payloads.length, observedRecordCount: seen.size, groups: Object.freeze(observedGroups),
    completeness: "unknown", amountSemantics: "RAW_SIGNED_AMOUNTS_NO_SIGN_CONVERSION",
    accountBinding: "NOT_ESTABLISHED_BY_BILLS_RESPONSE", netPnl: null, dailyPnl: null,
  });
}
