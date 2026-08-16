import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import {
  assertHtxVolumeAuthorityQualified,
  HTX_BASE_VOLUME_FIELD,
  HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
  HtxVolumeQualificationError,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

/**
 * Mapper/raw ingestion may retain amount/vol for provenance, but that surface is NEVER
 * capital-authoritative without a QUALIFIED v2 receipt (DEE-526).
 */
export const HTX_MAPPED_VOLUME_AUTHORITY = "NON_AUTHORITATIVE_RAW_INGESTION" as const;

export class HtxVolumeCapitalAuthorityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HtxVolumeCapitalAuthorityError";
  }
}

/**
 * Resolve authoritative HTX **base** volume for capital/capacity/participation paths.
 *
 * v2 contract: base units are `amount`. Quote turnover `vol` must not become capacity.
 * Fail-closed on missing/BLOCKED/retired-v1 receipts.
 */
export function resolveAuthoritativeHtxBaseVolumeForCapital(input: {
  receipt: HtxVolumeQualificationReceiptV1 | null | undefined;
  amount: number | null | undefined;
  vol: number | null | undefined;
}): number {
  if (!input.receipt) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_MISSING",
      "HTX volume capital authority requires a qualification receipt",
    );
  }
  if (input.receipt.schemaVersion !== HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_BLOCKED_RETIRED_SEMANTICS",
      "old reversed HTX volume receipts cannot authorize the corrected execution path",
    );
  }
  try {
    assertHtxVolumeAuthorityQualified(input.receipt);
  } catch (err) {
    if (err instanceof HtxVolumeQualificationError) {
      throw new HtxVolumeCapitalAuthorityError(err.code, err.message);
    }
    throw err;
  }
  if (input.receipt.authorityField !== HTX_BASE_VOLUME_FIELD) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_FIELD_UNSUPPORTED",
      `unsupported HTX volume authorityField=${String(input.receipt.authorityField)}`,
    );
  }
  if (!Number.isFinite(input.amount) || (input.amount as number) < 0) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_AMOUNT_INVALID",
      "qualified HTX volume authority requires a finite non-negative base amount",
    );
  }
  const amount = input.amount as number;
  const vol = input.vol;
  if (vol !== null && vol !== undefined) {
    if (!Number.isFinite(vol) || vol < 0) {
      throw new HtxVolumeCapitalAuthorityError(
        "HTX_VOLUME_AUTHORITY_VOL_INVALID",
        "qualified HTX quote turnover requires a finite non-negative vol when supplied",
      );
    }
    if (amount === 0 && vol > 0) {
      throw new HtxVolumeCapitalAuthorityError(
        "HTX_VOLUME_AUTHORITY_BLOCKED_ZERO_BASE_POSITIVE_QUOTE",
        "quote turnover cannot create positive base participation capacity",
      );
    }
  }
  return amount;
}

/** Capital/capacity gate: QUALIFIED v2 permits; BLOCKED/missing/retired denies. */
export function assertHtxVolumeCapitalAuthorityPermitsCapacity(
  receipt: HtxVolumeQualificationReceiptV1 | null | undefined,
): asserts receipt is HtxVolumeQualificationReceiptV1 {
  if (!receipt) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_MISSING",
      "capacity/participation requires HTX volume qualification receipt",
    );
  }
  if (receipt.schemaVersion !== HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_BLOCKED_RETIRED_SEMANTICS",
      "old reversed HTX volume receipts cannot authorize the corrected execution path",
    );
  }
  try {
    assertHtxVolumeAuthorityQualified(receipt);
  } catch (err) {
    if (err instanceof HtxVolumeQualificationError) {
      throw new HtxVolumeCapitalAuthorityError(err.code, err.message);
    }
    throw err;
  }
}

/**
 * Map a qualified HTX row to capital-authoritative base volume string.
 * Quote turnover is never treated as base quantity.
 */
export function authoritativeBaseVolumeFromQualifiedHtxRow(
  row: Pick<HtxKlineRow, "amount" | "vol">,
  receipt: HtxVolumeQualificationReceiptV1,
): string {
  const base = resolveAuthoritativeHtxBaseVolumeForCapital({
    receipt,
    amount: row.amount,
    vol: row.vol,
  });
  return base.toFixed(8).replace(/\.?0+$/, "") || "0";
}
