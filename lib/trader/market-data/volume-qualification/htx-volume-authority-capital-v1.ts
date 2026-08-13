import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import {
  assertHtxVolumeAuthorityQualified,
  HtxVolumeQualificationError,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

/**
 * Mapper/raw ingestion may retain amount/vol for provenance, but that surface is NEVER
 * capital-authoritative without a QUALIFIED receipt (DEE-526).
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
 * Qualification proves amount ≈ vol·close (quote vs base). Capital participation uses
 * base units (`vol`), never the silent `amount ?? vol` mapper fallback.
 * Fail-closed on missing receipt, BLOCKED verdict, or missing base vol.
 * Never fabricates QUALIFIED. Never invents a replacement capacity model.
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
  try {
    assertHtxVolumeAuthorityQualified(input.receipt);
  } catch (err) {
    if (err instanceof HtxVolumeQualificationError) {
      throw new HtxVolumeCapitalAuthorityError(err.code, err.message);
    }
    throw err;
  }
  if (input.receipt.authorityField !== "amount") {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_FIELD_UNSUPPORTED",
      `unsupported HTX volume authorityField=${String(input.receipt.authorityField)}`,
    );
  }
  if (!Number.isFinite(input.amount) || (input.amount as number) < 0) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_AMOUNT_INVALID",
      "qualified HTX volume authority requires a finite non-negative amount",
    );
  }
  if (!Number.isFinite(input.vol) || (input.vol as number) < 0) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_VOL_INVALID",
      "qualified HTX base volume requires a finite non-negative vol",
    );
  }
  // Do not fall back to amount as base — that is the mapper defect this gate closes.
  return input.vol as number;
}

/** Capital/capacity gate: QUALIFIED permits; BLOCKED/missing denies. */
export function assertHtxVolumeCapitalAuthorityPermitsCapacity(
  receipt: HtxVolumeQualificationReceiptV1 | null | undefined,
): asserts receipt is HtxVolumeQualificationReceiptV1 {
  if (!receipt) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_MISSING",
      "capacity/participation requires HTX volume qualification receipt",
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
 * Raw amount??vol fallback is forbidden on this path.
 */
export function authoritativeBaseVolumeFromQualifiedHtxRow(
  row: Pick<HtxKlineRow, "amount" | "vol">,
  receipt: HtxVolumeQualificationReceiptV1,
): string {
  const amount = resolveAuthoritativeHtxBaseVolumeForCapital({
    receipt,
    amount: row.amount,
    vol: row.vol,
  });
  return amount.toFixed(8).replace(/\.?0+$/, "") || "0";
}
