import { treasuryAccountKindEnum } from "@/db/core-enums";

export type TreasuryAccountKind = (typeof treasuryAccountKindEnum)[number];

export type TreasuryLedgerCatalogQuery = {
  q?: string;
  active?: boolean;
  limit?: number;
  afterName?: string;
  afterId?: string;
};

export type TreasuryCounterpartyRecord = {
  id: string;
  organizationId: string;
  displayName: string;
  websiteUrl: string | null;
  email: string | null;
  phone: string | null;
  paymentInstructions: string | null;
  waiaUserId: string | null;
  waiaUsername: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryAccountRecord = {
  id: string;
  organizationId: string;
  displayName: string;
  kind: TreasuryAccountKind;
  currency: string;
  network: string | null;
  address: string | null;
  maskedRequisites: string | null;
  watchedAddressId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryCategoryRecord = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  monthlyBudgetMicros: bigint;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryProjectRecord = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryLedgerCatalogRecord =
  | TreasuryCounterpartyRecord
  | TreasuryAccountRecord
  | TreasuryCategoryRecord
  | TreasuryProjectRecord;

export type TreasuryLedgerCatalogPage<T> = {
  items: T[];
  next: { afterName: string; afterId: string } | null;
};

export type TreasuryCounterpartyInput = Pick<TreasuryCounterpartyRecord, "displayName"> &
  Partial<
    Pick<
      TreasuryCounterpartyRecord,
      "websiteUrl" | "email" | "phone" | "paymentInstructions" | "waiaUsername" | "isActive"
    >
  >;

export type TreasuryAccountInput = Pick<
  TreasuryAccountRecord,
  "displayName" | "kind" | "currency"
> &
  Partial<
    Pick<
      TreasuryAccountRecord,
      "network" | "address" | "maskedRequisites" | "watchedAddressId" | "isActive"
    >
  >;

export type TreasuryCategoryInput = Pick<
  TreasuryCategoryRecord,
  "code" | "name" | "monthlyBudgetMicros" | "currency"
> &
  Partial<Pick<TreasuryCategoryRecord, "description" | "isActive">>;

export type TreasuryProjectInput = Pick<TreasuryProjectRecord, "name"> &
  Partial<Pick<TreasuryProjectRecord, "description" | "startsOn" | "endsOn" | "isActive">>;
