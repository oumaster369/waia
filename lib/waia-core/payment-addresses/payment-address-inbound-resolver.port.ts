import type { PaymentAddressStatus } from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import type { PaymentSubjectModule } from "@/lib/waia-core/payments/payment-events.types";

/** Minimal DTO for inbound deposit attribution (service-role only). */
export type InboundAttribution = {
  addressId: string;
  organizationId: string;
  status: PaymentAddressStatus;
  subjectModule: PaymentSubjectModule | null;
};

/** Registry-owned port: resolve deposit address owner without prior org context. */
export type PaymentAddressInboundResolver = {
  resolveOwnerByDepositAddress(
    network: string,
    address: string,
  ): Promise<InboundAttribution | null>;
};
