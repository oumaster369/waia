import type {
  PaymentEventRecordPayload,
  PaymentEventRecordView,
} from "@/lib/waia-core/payments/payment-events.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type InsertPaymentEventRepoInput = {
  payload: PaymentEventRecordPayload;
};

export type ListPaymentEventsQuery = {
  paymentId?: string;
  limit?: number;
};

export const DEFAULT_PAYMENT_EVENTS_LIST_LIMIT = 100;
export const MAX_PAYMENT_EVENTS_LIST_LIMIT = 500;

export type PaymentEventsRepository = {
  insertEvent(
    context: OrgContext,
    input: InsertPaymentEventRepoInput,
  ): Promise<PaymentEventRecordView>;
  listEvents(
    context: OrgContext,
    query?: ListPaymentEventsQuery,
  ): Promise<PaymentEventRecordView[]>;
  findByIdempotencyKey(
    context: OrgContext,
    idempotencyKey: string,
  ): Promise<PaymentEventRecordView | null>;
  findBySettlementAttribution(
    settlementNetwork: string,
    settlementTxHash: string,
    transferIndex: number,
  ): Promise<PaymentEventRecordView | null>;
  listEventsForPayment(context: OrgContext, paymentId: string): Promise<PaymentEventRecordView[]>;
};
