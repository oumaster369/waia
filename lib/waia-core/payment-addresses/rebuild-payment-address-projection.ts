import {
  assertAddressTransitionAllowed,
  eventTypeToAddressStatus,
} from "@/lib/waia-core/payment-addresses/payment-address-lifecycle.transitions";
import type { PaymentAddressEventRecordView } from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import type { PaymentAddressProjectionView } from "@/lib/waia-core/payment-addresses/payment-address-projection.types";
import { verifyPaymentAddressEventChain } from "@/lib/waia-core/payment-addresses/serialize-payment-address-events";

export function foldPaymentAddressEventsToProjection(
  events: PaymentAddressEventRecordView[],
): PaymentAddressProjectionView | null {
  if (events.length === 0) {
    return null;
  }

  verifyPaymentAddressEventChain(events);

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const genesis = ordered[0]!;
  const head = ordered[ordered.length - 1]!;

  let currentStatus: PaymentAddressProjectionView["status"] | null = null;
  for (const event of ordered) {
    assertAddressTransitionAllowed(event.addressId, currentStatus, event.eventType);
    currentStatus = eventTypeToAddressStatus(event.eventType);
  }

  if (
    genesis.eventType !== "GENERATED" ||
    genesis.address === null ||
    genesis.network.length === 0
  ) {
    if (genesis.address === null) {
      throw new Error(
        "[waia-core] payment address projection fold failed: genesis address missing",
      );
    }
    throw new Error("[waia-core] payment address projection fold failed");
  }

  return {
    addressId: genesis.addressId,
    organizationId: genesis.organizationId,
    walletId: genesis.walletId,
    network: genesis.network,
    address: genesis.address,
    status: eventTypeToAddressStatus(head.eventType),
    subjectModule: head.subjectModule,
    subjectRef: head.subjectRef,
    bindingRef: head.bindingRef,
    lastEventSeq: head.seq,
    lastEventDigest: head.recordContentDigest,
    createdAt: genesis.createdAt,
    updatedAt: head.createdAt,
  };
}
