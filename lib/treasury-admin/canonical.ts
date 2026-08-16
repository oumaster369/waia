import {
  treasuryDetailPublicationEnum,
  treasuryProvenanceEnum,
  treasuryTxDirectionEnum,
  treasuryTxKindEnum,
  treasuryTxStatusEnum,
} from "@/db/core-enums";
import { TREASURY_USDT_V1_ASSET, TREASURY_USDT_V1_DECIMALS } from "@/lib/waia-core/treasury/types";

export {
  treasuryDetailPublicationEnum,
  treasuryProvenanceEnum,
  treasuryTxDirectionEnum,
  treasuryTxKindEnum,
  treasuryTxStatusEnum,
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_DECIMALS,
};

export const UNCLASSIFIED_KIND_VALUE = "" as const;
export const FILTER_ANY_VALUE = "" as const;

export type TreasuryCanonicalDirection = (typeof treasuryTxDirectionEnum)[number];
export type TreasuryCanonicalKind = (typeof treasuryTxKindEnum)[number];
export type TreasuryCanonicalStatus = (typeof treasuryTxStatusEnum)[number];
export type TreasuryCanonicalPublication = (typeof treasuryDetailPublicationEnum)[number];
export type TreasuryCanonicalProvenance = (typeof treasuryProvenanceEnum)[number];

export type CanonicalOption<T extends string> = {
  value: T;
  label: string;
};

function spaced(value: string): string {
  return value.replaceAll("_", " ");
}

function titled(value: string): string {
  const lower = spaced(value).toLowerCase();
  return lower.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function option<T extends string>(
  value: T,
  label = `${titled(value)} (${value})`,
): CanonicalOption<T> {
  return { value, label };
}

export const TREASURY_DIRECTION_OPTIONS: readonly CanonicalOption<TreasuryCanonicalDirection>[] =
  treasuryTxDirectionEnum.map((value) => option(value));

export const TREASURY_KIND_OPTIONS: readonly CanonicalOption<TreasuryCanonicalKind>[] =
  treasuryTxKindEnum.map((value) => option(value));

export const TREASURY_STATUS_OPTIONS: readonly CanonicalOption<TreasuryCanonicalStatus>[] =
  treasuryTxStatusEnum.map((value) =>
    value === "RECONCILIATION_REQUIRED"
      ? option(value, `Needs reconciliation (${value})`)
      : option(value),
  );

export const TREASURY_PUBLICATION_OPTIONS: readonly CanonicalOption<TreasuryCanonicalPublication>[] =
  treasuryDetailPublicationEnum.map((value) =>
    value === "DETAIL_PUBLIC" ? option(value, `Public detail (${value})`) : option(value),
  );

export const TREASURY_PROVENANCE_OPTIONS: readonly CanonicalOption<TreasuryCanonicalProvenance>[] =
  treasuryProvenanceEnum.map((value) => option(value));

export const TREASURY_USDT_V1_ASSET_OPTIONS = [
  option(TREASURY_USDT_V1_ASSET, `USDT (${TREASURY_USDT_V1_DECIMALS} decimals, Treasury V1)`),
] as const;
