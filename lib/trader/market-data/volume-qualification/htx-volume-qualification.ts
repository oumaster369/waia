import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

/**
 * Semantic contract v2: HTX spot kline `amount` is base-asset quantity,
 * `vol` is quote-currency turnover. v1 receipts used the reversed identity
 * and MUST NOT qualify under this path.
 */
export const HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION =
  "htx-volume-qualification-receipt/v2" as const;

export const HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_V1_RETIRED =
  "htx-volume-qualification-receipt/v1" as const;

export const HTX_BASE_VOLUME_FIELD = "amount" as const;
export const HTX_QUOTE_TURNOVER_FIELD = "vol" as const;

export const HTX_VOLUME_AUTHORITY_VERDICTS = [
  "HTX_VOLUME_AUTHORITY_QUALIFIED",
  "HTX_VOLUME_AUTHORITY_BLOCKED_AMBIGUOUS_FIELDS",
  "HTX_VOLUME_AUTHORITY_BLOCKED_AMOUNT_VOL_DIVERGENCE",
  "HTX_VOLUME_AUTHORITY_BLOCKED_MISSING_FIELDS",
  "HTX_VOLUME_AUTHORITY_BLOCKED_NON_POSITIVE_PRICE",
  "HTX_VOLUME_AUTHORITY_BLOCKED_ZERO_BASE_POSITIVE_QUOTE",
  "HTX_VOLUME_AUTHORITY_BLOCKED_IMPLIED_VWAP_OUT_OF_RANGE",
  "HTX_VOLUME_AUTHORITY_BLOCKED_RETIRED_SEMANTICS",
] as const;

export type HtxVolumeAuthorityVerdict = (typeof HTX_VOLUME_AUTHORITY_VERDICTS)[number];

export type HtxVolumeQualificationReceiptV1 = Readonly<{
  schemaVersion: typeof HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION;
  verdict: HtxVolumeAuthorityVerdict;
  authorityField: typeof HTX_BASE_VOLUME_FIELD | null;
  quoteTurnoverField: typeof HTX_QUOTE_TURNOVER_FIELD | null;
  venue: "HTX";
  marketType: "SPOT";
  symbol: string;
  interval: "1m";
  sampleCount: number;
  divergenceCount: number;
  qualifiedAtUtc: string;
  qualificationReceiptDigest: string;
  detail?: string;
}>;

export class HtxVolumeQualificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HtxVolumeQualificationError";
  }
}

/** Decimal/serialization slack for implied VWAP vs candle [low, high]. Not a close-equality check. */
const VWAP_RANGE_RELATIVE_TOLERANCE = 1e-6;

function computeReceiptDigest(
  receipt: Omit<HtxVolumeQualificationReceiptV1, "qualificationReceiptDigest">,
): string {
  return computePayloadDigest(receipt);
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function impliedVwapInCandleRange(row: HtxKlineRow, vwap: number): boolean {
  const low = row.low;
  const high = row.high;
  if (!isPositiveFinite(low) || !isPositiveFinite(high) || high < low) {
    return false;
  }
  const span = Math.max(high - low, Math.abs(high) * VWAP_RANGE_RELATIVE_TOLERANCE, Number.EPSILON);
  const slack = span * VWAP_RANGE_RELATIVE_TOLERANCE + Number.EPSILON;
  return vwap + slack >= low && vwap - slack <= high;
}

function blockedReceipt(input: {
  symbol: string;
  sampleCount: number;
  divergenceCount: number;
  qualifiedAtUtc: string;
  verdict: Exclude<HtxVolumeAuthorityVerdict, "HTX_VOLUME_AUTHORITY_QUALIFIED">;
  detail: string;
}): HtxVolumeQualificationReceiptV1 {
  const body = {
    schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
    verdict: input.verdict,
    authorityField: null,
    quoteTurnoverField: null,
    venue: "HTX" as const,
    marketType: "SPOT" as const,
    symbol: input.symbol,
    interval: "1m" as const,
    sampleCount: input.sampleCount,
    divergenceCount: input.divergenceCount,
    qualifiedAtUtc: input.qualifiedAtUtc,
    detail: input.detail,
  };
  return { ...body, qualificationReceiptDigest: computeReceiptDigest(body) };
}

export function qualifyHtxKlineVolumeAuthority(input: {
  symbol: string;
  rows: readonly HtxKlineRow[];
  qualifiedAtUtc?: string;
}): HtxVolumeQualificationReceiptV1 {
  const qualifiedAtUtc = input.qualifiedAtUtc ?? new Date().toISOString();
  let divergenceCount = 0;

  if (input.rows.length === 0) {
    return blockedReceipt({
      symbol: input.symbol,
      sampleCount: 0,
      divergenceCount: 0,
      qualifiedAtUtc,
      verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_MISSING_FIELDS",
      detail: "empty sample",
    });
  }

  let ambiguousEqualFields = true;

  for (const row of input.rows) {
    if (!isPositiveFinite(row.close) || !isPositiveFinite(row.low) || !isPositiveFinite(row.high)) {
      return blockedReceipt({
        symbol: input.symbol,
        sampleCount: input.rows.length,
        divergenceCount,
        qualifiedAtUtc,
        verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_NON_POSITIVE_PRICE",
        detail: `non-positive OHLC at id=${row.id}`,
      });
    }

    const amount = row.amount;
    const vol = row.vol;
    if (amount !== vol) {
      ambiguousEqualFields = false;
    }
    if (!isNonNegativeFinite(amount) || !isNonNegativeFinite(vol)) {
      return blockedReceipt({
        symbol: input.symbol,
        sampleCount: input.rows.length,
        divergenceCount,
        qualifiedAtUtc,
        verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_MISSING_FIELDS",
        detail: `missing amount/vol at id=${row.id}`,
      });
    }

    if (amount === 0) {
      if (vol > 0) {
        return blockedReceipt({
          symbol: input.symbol,
          sampleCount: input.rows.length,
          divergenceCount,
          qualifiedAtUtc,
          verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_ZERO_BASE_POSITIVE_QUOTE",
          detail: `quote turnover without base quantity at id=${row.id}`,
        });
      }
      continue;
    }

    const impliedVwap = vol / amount;
    if (!Number.isFinite(impliedVwap) || impliedVwap <= 0) {
      divergenceCount += 1;
      continue;
    }
    if (!impliedVwapInCandleRange(row, impliedVwap)) {
      divergenceCount += 1;
    }
  }

  if (ambiguousEqualFields) {
    return blockedReceipt({
      symbol: input.symbol,
      sampleCount: input.rows.length,
      divergenceCount,
      qualifiedAtUtc,
      verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_AMBIGUOUS_FIELDS",
      detail: "amount and vol are identical across samples; quote/base authority cannot be proven",
    });
  }

  if (divergenceCount > 0) {
    return blockedReceipt({
      symbol: input.symbol,
      sampleCount: input.rows.length,
      divergenceCount,
      qualifiedAtUtc,
      verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_IMPLIED_VWAP_OUT_OF_RANGE",
      detail: "implied quote/base VWAP is not inside candle [low, high]",
    });
  }

  const body = {
    schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
    verdict: "HTX_VOLUME_AUTHORITY_QUALIFIED" as const,
    authorityField: HTX_BASE_VOLUME_FIELD,
    quoteTurnoverField: HTX_QUOTE_TURNOVER_FIELD,
    venue: "HTX" as const,
    marketType: "SPOT" as const,
    symbol: input.symbol,
    interval: "1m" as const,
    sampleCount: input.rows.length,
    divergenceCount: 0,
    qualifiedAtUtc,
  };
  return { ...body, qualificationReceiptDigest: computeReceiptDigest(body) };
}

export function readHtxVolumeQualificationReceipt(
  receipt: HtxVolumeQualificationReceiptV1,
): HtxVolumeQualificationReceiptV1 {
  if (receipt.schemaVersion !== HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION) {
    throw new HtxVolumeQualificationError(
      "HTX_VOLUME_AUTHORITY_BLOCKED_RETIRED_SEMANTICS",
      `HTX volume receipt schema ${String(receipt.schemaVersion)} is not the corrected amount=base / vol=quote contract`,
    );
  }
  const { qualificationReceiptDigest, ...body } = receipt;
  if (computeReceiptDigest(body) !== qualificationReceiptDigest) {
    throw new HtxVolumeQualificationError(
      "QUALIFICATION_RECEIPT_DIGEST_MISMATCH",
      "HTX volume qualification receipt digest mismatch.",
    );
  }
  return receipt;
}

export function assertHtxVolumeAuthorityQualified(receipt: HtxVolumeQualificationReceiptV1): void {
  readHtxVolumeQualificationReceipt(receipt);
  if (receipt.verdict !== "HTX_VOLUME_AUTHORITY_QUALIFIED") {
    throw new HtxVolumeQualificationError(
      receipt.verdict,
      `HTX volume authority blocked: ${receipt.verdict}`,
    );
  }
  if (receipt.authorityField !== HTX_BASE_VOLUME_FIELD) {
    throw new HtxVolumeQualificationError(
      "HTX_VOLUME_AUTHORITY_FIELD_UNSUPPORTED",
      `authorityField must be ${HTX_BASE_VOLUME_FIELD} (base quantity)`,
    );
  }
}
