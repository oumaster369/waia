import type {
  PaymentAddressEventRecordPayload,
  PaymentAddressEventRecordView,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type InsertPaymentAddressEventRepoInput = {
  payload: PaymentAddressEventRecordPayload;
};

export type ListPaymentAddressEventsQuery = {
  addressId?: string;
  limit?: number;
};

export const DEFAULT_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT = 100;
export const MAX_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT = 500;

export type PaymentAddressEventsRepository = {
  insertEvent(
    context: OrgContext,
    input: InsertPaymentAddressEventRepoInput,
  ): Promise<PaymentAddressEventRecordView>;
  listEvents(
    context: OrgContext,
    query?: ListPaymentAddressEventsQuery,
  ): Promise<PaymentAddressEventRecordView[]>;
  listEventsForAddress(
    context: OrgContext,
    addressId: string,
  ): Promise<PaymentAddressEventRecordView[]>;
};
