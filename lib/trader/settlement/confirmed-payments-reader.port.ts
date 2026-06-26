import type { ConfirmedPaymentForSettlement } from "@/lib/trader/settlement/settlement.types";

export type ConfirmedPaymentsReader = {
  listUnsettledConfirmedTraderPayments(limit?: number): Promise<ConfirmedPaymentForSettlement[]>;
  countUnsettledConfirmedTraderPayments(): Promise<number>;
  countExceptionSettlements(): Promise<number>;
};
