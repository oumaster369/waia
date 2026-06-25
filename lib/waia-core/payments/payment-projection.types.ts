import { paymentDirectionEnum, paymentStatusEnum, paymentSubjectModuleEnum } from "@/db/core-enums";

export const paymentStatuses = paymentStatusEnum;
export type PaymentStatus = (typeof paymentStatuses)[number];

export type PaymentProjectionView = {
  paymentId: string;
  organizationId: string;
  status: PaymentStatus;
  direction: (typeof paymentDirectionEnum)[number];
  subjectModule: (typeof paymentSubjectModuleEnum)[number];
  subjectInvoiceId: string | null;
  settlementAmount: string | null;
  settlementAsset: string | null;
  settlementNetwork: string | null;
  settlementTxHash: string | null;
  transferIndex: number | null;
  valuedAmountUsd: string | null;
  valuationSource: string | null;
  lastEventSeq: number;
  lastEventDigest: string;
  createdAt: Date;
  updatedAt: Date;
};
