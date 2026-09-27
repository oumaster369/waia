import type { Bar } from "@/lib/trader/intelligence/types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { parseDecimal } from "@/lib/trader/risk/numeric";

export type RecordedNoncapitalInputV2 = Readonly<{
  organizationId: string;
  accountId: string;
  releaseSha: string;
  bar: Readonly<Bar>;
}>;
export function canonicalTime(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Exact recorded input integrity, not a qualified external source receipt. */
export function normalizeRecordedNoncapitalInputV2(input: RecordedNoncapitalInputV2): RecordedNoncapitalInputV2 {
  const { bar } = input;
  if (!input.organizationId?.trim() || !input.accountId?.trim() || !bar?.symbol?.trim() ||
      !/^[0-9a-f]{40}$/.test(input.releaseSha) ||
      !["1m", "15m", "1h", "4h", "1d"].includes(bar.interval) ||
      !canonicalTime(bar.barOpenTime) || !canonicalTime(bar.barCloseTime) ||
      bar.barOpenTime >= bar.barCloseTime) throw new Error("NONCAPITAL_CYCLE_INVALID_INPUT");
  const [open, high, low, close, volume] = [bar.open, bar.high, bar.low, bar.close, bar.volume].map(parseDecimal);
  if (open <= 0n || high <= 0n || low <= 0n || close <= 0n || volume < 0n ||
      high < open || high < close || low > open || low > close || high < low) {
    throw new Error("NONCAPITAL_CYCLE_INVALID_BAR");
  }
  return Object.freeze({ organizationId: input.organizationId, accountId: input.accountId,
    releaseSha: input.releaseSha, bar: Object.freeze({ symbol: bar.symbol, interval: bar.interval,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
      barOpenTime: bar.barOpenTime, barCloseTime: bar.barCloseTime }) });
}

export function recordedNoncapitalInputDigestV2(input: RecordedNoncapitalInputV2): string {
  return computeSemanticSha256Hex({ schemaVersion: "waia.trader.recorded_noncapital_input.v2",
    input: normalizeRecordedNoncapitalInputV2(input) });
}

