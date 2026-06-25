import type { PaymentWalletView } from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import type { CreatePaymentWalletInput } from "@/lib/waia-core/payment-addresses/payment-wallet-repository.types";

type PaymentWalletRow = {
  id: string;
  organizationId: string;
  walletKind: PaymentWalletView["walletKind"];
  custodyModel: PaymentWalletView["custodyModel"];
  controlModel: string;
  providerRef: string | null;
  derivationScheme: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export function mapPaymentWalletRow(row: PaymentWalletRow): PaymentWalletView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    walletKind: row.walletKind,
    custodyModel: row.custodyModel,
    controlModel: row.controlModel,
    providerRef: row.providerRef,
    derivationScheme: row.derivationScheme,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function paymentWalletToInsertValues(
  id: string,
  organizationId: string,
  input: CreatePaymentWalletInput,
  now: Date,
) {
  return {
    id,
    organizationId,
    walletKind: input.walletKind,
    custodyModel: input.custodyModel,
    controlModel: input.controlModel,
    providerRef: input.providerRef ?? null,
    derivationScheme: input.derivationScheme ?? null,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  };
}
