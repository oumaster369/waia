import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export const HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION =
  "htx-volume-qualification-receipt/v1" as const;

export const HTX_VOLUME_AUTHORITY_VERDICTS = [
  "HTX_VOLUME_AUTHORITY_QUALIFIED",
  "HTX_VOLUME_AUTHORITY_BLOCKED_AMBIGUOUS_FIELDS",
  "HTX_VOLUME_AUTHORITY_BLOCKED_AMOUNT_VOL_DIVERGENCE",
  "HTX_VOLUME_AUTHORITY_BLOCKED_MISSING_FIELDS",
  "HTX_VOLUME_AUTHORITY_BLOCKED_NON_POSITIVE_PRICE",
] as const;

export type HtxVolumeAuthorityVerdict = (typeof HTX_VOLUME_AUTHORITY_VERDICTS)[number];

export type HtxVolumeQualificationReceiptV1 = Readonly<{
  schemaVersion: typeof HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION;
  verdict: HtxVolumeAuthorityVerdict;
  authorityField: "amount" | null;
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

const RELATIVE_TOLERANCE = 0.02;

function computeReceiptDigest(
  receipt: Omit<HtxVolumeQualificationReceiptV1, "qualificationReceiptDigest">,
): string {
  return computePayloadDigest(receipt);
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function qualifyHtxKlineVolumeAuthority(input: {
  symbol: string;
  rows: readonly HtxKlineRow[];
  qualifiedAtUtc?: string;
}): HtxVolumeQualificationReceiptV1 {
  const qualifiedAtUtc = input.qualifiedAtUtc ?? new Date().toISOString();
  let divergenceCount = 0;

  if (input.rows.length === 0) {
    const body = {
      schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
      verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_MISSING_FIELDS" as const,
      authorityField: null,
      venue: "HTX" as const,
      marketType: "SPOT" as const,
      symbol: input.symbol,
      interval: "1m" as const,
      sampleCount: 0,
      divergenceCount: 0,
      qualifiedAtUtc,
      detail: "empty sample",
    };
    return { ...body, qualificationReceiptDigest: computeReceiptDigest(body) };
  }

  let ambiguousEqualFields = true;

  for (const row of input.rows) {
    if (!isPositiveFinite(row.close)) {
      const body = {
        schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
        verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_NON_POSITIVE_PRICE" as const,
        authorityField: null,
        venue: "HTX" as const,
        marketType: "SPOT" as const,
        symbol: input.symbol,
        interval: "1m" as const,
        sampleCount: input.rows.length,
        divergenceCount,
        qualifiedAtUtc,
        detail: `non-positive close at id=${row.id}`,
      };
      return { ...body, qualificationReceiptDigest: computeReceiptDigest(body) };
    }

    const amount = row.amount;
    const vol = row.vol;
    if (amount !== vol) {
      ambiguousEqualFields = false;
    }
    if (!Number.isFinite(amount) || !Number.isFinite(vol)) {
      const body = {
        schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
        verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_MISSING_FIELDS" as const,
        authorityField: null,
        venue: "HTX" as const,
        marketType: "SPOT" as const,
        symbol: input.symbol,
        interval: "1m" as const,
        sampleCount: input.rows.length,
        divergenceCount,
        qualifiedAtUtc,
        detail: `missing amount/vol at id=${row.id}`,
      };
      return { ...body, qualificationReceiptDigest: computeReceiptDigest(body) };
    }

    const impliedAmount = vol * row.close;
    const relativeError =
      amount > 0 ? Math.abs(impliedAmount - amount) / amount : Number.POSITIVE_INFINITY;
    if (relativeError > RELATIVE_TOLERANCE) {
      divergenceCount += 1;
    }
  }

  if (ambiguousEqualFields) {
    const body = {
      schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
      verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_AMBIGUOUS_FIELDS" as const,
      authorityField: null,
      venue: "HTX" as const,
      marketType: "SPOT" as const,
      symbol: input.symbol,
      interval: "1m" as const,
      sampleCount: input.rows.length,
      divergenceCount,
      qualifiedAtUtc,
      detail: "amount and vol are identical across samples; quote/base authority cannot be proven",
    };
    return { ...body, qualificationReceiptDigest: computeReceiptDigest(body) };
  }

  if (divergenceCount > 0) {
    const body = {
      schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
      verdict: "HTX_VOLUME_AUTHORITY_BLOCKED_AMOUNT_VOL_DIVERGENCE" as const,
      authorityField: null,
      venue: "HTX" as const,
      marketType: "SPOT" as const,
      symbol: input.symbol,
      interval: "1m" as const,
      sampleCount: input.rows.length,
      divergenceCount,
      qualifiedAtUtc,
      detail: "amount and vol are not dimensionally consistent with close",
    };
    return { ...body, qualificationReceiptDigest: computeReceiptDigest(body) };
  }

  const body = {
    schemaVersion: HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
    verdict: "HTX_VOLUME_AUTHORITY_QUALIFIED" as const,
    authorityField: "amount" as const,
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
}
