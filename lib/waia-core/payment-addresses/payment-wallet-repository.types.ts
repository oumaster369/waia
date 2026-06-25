import type {
  PaymentWalletControlModel,
  PaymentWalletCustodyModel,
  PaymentWalletKind,
  PaymentWalletView,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type CreatePaymentWalletInput = {
  walletKind: PaymentWalletKind;
  custodyModel: PaymentWalletCustodyModel;
  controlModel: PaymentWalletControlModel;
  providerRef?: string | null;
  derivationScheme?: string | null;
  status: string;
};

export type PaymentWalletRepository = {
  createWallet(context: OrgContext, input: CreatePaymentWalletInput): Promise<PaymentWalletView>;
  getWalletById(context: OrgContext, walletId: string): Promise<PaymentWalletView | null>;
};
