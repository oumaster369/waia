import type { PaymentProjectionView } from "@/lib/waia-core/payments/payment-projection.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ListPaymentsQuery = {
  subjectModule?: PaymentProjectionView["subjectModule"];
  subjectInvoiceId?: string;
  status?: PaymentProjectionView["status"];
  limit?: number;
};

export const DEFAULT_PAYMENTS_LIST_LIMIT = 100;
export const MAX_PAYMENTS_LIST_LIMIT = 500;

export type PaymentsProjectionRepository = {
  upsertProjection(
    context: OrgContext,
    projection: PaymentProjectionView,
  ): Promise<PaymentProjectionView>;
  getByPaymentId(context: OrgContext, paymentId: string): Promise<PaymentProjectionView | null>;
  listPayments(context: OrgContext, query?: ListPaymentsQuery): Promise<PaymentProjectionView[]>;
  deleteAllForOrg(context: OrgContext): Promise<number>;
  deleteByPaymentId(context: OrgContext, paymentId: string): Promise<boolean>;
};
