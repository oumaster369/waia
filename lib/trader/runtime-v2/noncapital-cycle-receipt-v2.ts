import type { Bar } from "@/lib/trader/intelligence/types";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { parseDecimal } from "@/lib/trader/risk/numeric";
import type { DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { SHADOW_PRE_QUALIFICATION_UNAVAILABLE_SOURCES } from "./shadow-canonical-runner-v2";
import type { CanonicalRecurringCycleV2Result } from "./canonical-recurring-cycle-v2";

export type RecordedNoncapitalInputV2 = Readonly<{
  organizationId: string;
  accountId: string;
  releaseSha: string;
  bar: Readonly<Bar>;
}>;
export type NoncapitalCycleReceiptV2 = Readonly<{
  schemaVersion: "waia.trader.noncapital_cycle_receipt.v2";
  input: RecordedNoncapitalInputV2;
  inputDigest: string;
  holder: DatabaseClockRuntimeHolderV2;
  recordedAtUtc: string;
  result: Extract<CanonicalRecurringCycleV2Result, { status: "NO_TRADE" }>;
  contentDigest: string;
}>;

function canonicalTime(value: string): boolean {
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

export function buildNoncapitalCycleReceiptV2(
  input: RecordedNoncapitalInputV2, holder: DatabaseClockRuntimeHolderV2,
  recordedAtUtc: string, result: CanonicalRecurringCycleV2Result,
): NoncapitalCycleReceiptV2 {
  const normalized = normalizeRecordedNoncapitalInputV2(input);
  if (holder.organizationId !== normalized.organizationId) throw new Error("NONCAPITAL_CYCLE_TENANT_MISMATCH");
  if (!holder.runtimeInstanceId?.trim() || !Number.isSafeInteger(holder.leaseEpoch) || holder.leaseEpoch < 1 ||
      !/^[0-9a-f]{64}$/.test(holder.leaseContentDigest) || !canonicalTime(recordedAtUtc)) {
    throw new Error("NONCAPITAL_CYCLE_INVALID_HOLDER");
  }
  if (result.status !== "NO_TRADE" || result.stage !== "EPISTEMIC" ||
      JSON.stringify(result.reasonCodes) !== JSON.stringify([
        ...SHADOW_PRE_QUALIFICATION_UNAVAILABLE_SOURCES.map(source => `UNAVAILABLE:${source}`),
        "PREDICTIVE_ADMISSION_NOT_ADMITTED",
      ])) {
    throw new Error("NONCAPITAL_CYCLE_RESULT_FORBIDDEN");
  }
  const body = {
    schemaVersion: "waia.trader.noncapital_cycle_receipt.v2" as const,
    input: normalized, inputDigest: recordedNoncapitalInputDigestV2(normalized),
    holder: Object.freeze({ organizationId: holder.organizationId, runtimeInstanceId: holder.runtimeInstanceId,
      leaseEpoch: holder.leaseEpoch, leaseContentDigest: holder.leaseContentDigest }), recordedAtUtc,
    result: Object.freeze({ status: "NO_TRADE" as const, stage: "EPISTEMIC" as const,
      reasonCodes: Object.freeze([...result.reasonCodes]) }),
  };
  return Object.freeze({ ...body, contentDigest: computeSemanticSha256Hex(body) });
}

export function serializeNoncapitalCycleReceiptV2(value: NoncapitalCycleReceiptV2): string {
  const rebuilt = buildNoncapitalCycleReceiptV2(value.input, value.holder, value.recordedAtUtc, value.result);
  if (canonicalizeSemanticJsonString(rebuilt) !== canonicalizeSemanticJsonString(value)) {
    throw new Error("NONCAPITAL_CYCLE_RECEIPT_CORRUPT");
  }
  return canonicalizeSemanticJsonString(rebuilt);
}
