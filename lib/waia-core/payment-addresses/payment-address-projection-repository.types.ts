import type { PaymentAddressSubjectModule } from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import type { PaymentAddressProjectionView } from "@/lib/waia-core/payment-addresses/payment-address-projection.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ListPaymentAddressesQuery = {
  status?: PaymentAddressProjectionView["status"];
  subjectModule?: PaymentAddressProjectionView["subjectModule"];
  subjectRef?: string;
  walletId?: string;
  limit?: number;
};

export const DEFAULT_PAYMENT_ADDRESSES_LIST_LIMIT = 100;
export const MAX_PAYMENT_ADDRESSES_LIST_LIMIT = 500;

export type PaymentAddressProjectionRepository = {
  upsertProjection(
    context: OrgContext,
    projection: PaymentAddressProjectionView,
  ): Promise<PaymentAddressProjectionView>;
  getByAddressId(
    context: OrgContext,
    addressId: string,
  ): Promise<PaymentAddressProjectionView | null>;
  getByNetworkAddress(
    context: OrgContext,
    network: string,
    address: string,
  ): Promise<PaymentAddressProjectionView | null>;
  findActiveBySubject(
    context: OrgContext,
    subjectModule: PaymentAddressSubjectModule,
    subjectRef: string,
  ): Promise<PaymentAddressProjectionView | null>;
  listAddresses(
    context: OrgContext,
    query?: ListPaymentAddressesQuery,
  ): Promise<PaymentAddressProjectionView[]>;
  deleteAllForOrg(context: OrgContext): Promise<number>;
  deleteByAddressId(context: OrgContext, addressId: string): Promise<boolean>;
};
