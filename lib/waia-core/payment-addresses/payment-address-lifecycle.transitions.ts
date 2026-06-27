import { IllegalAddressTransitionError } from "@/lib/waia-core/payment-addresses/payment-address.errors";
import type {
  PaymentAddressEventType,
  PaymentAddressStatus,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";

const GENESIS_KEY = "__GENESIS__" as const;

const ALLOWED_TRANSITIONS: Record<
  PaymentAddressStatus | typeof GENESIS_KEY,
  ReadonlySet<PaymentAddressEventType>
> = {
  [GENESIS_KEY]: new Set(["GENERATED"]),
  GENERATED: new Set(["RESERVED", "ASSIGNED"]),
  RESERVED: new Set(["ASSIGNED", "RELEASED"]),
  RELEASED: new Set(),
  ASSIGNED: new Set(["ACTIVATED"]),
  ACTIVATED: new Set(["ROTATED", "RETIRED", "RECOVERED"]),
  ROTATED: new Set(["RETIRED"]),
  RETIRED: new Set(["ARCHIVED"]),
  ARCHIVED: new Set(),
  RECOVERED: new Set(["ACTIVATED"]),
};

export function eventTypeToAddressStatus(eventType: PaymentAddressEventType): PaymentAddressStatus {
  return eventType;
}

export function assertAddressTransitionAllowed(
  addressId: string,
  currentStatus: PaymentAddressStatus | null,
  eventType: PaymentAddressEventType,
): void {
  const key = currentStatus ?? GENESIS_KEY;
  const allowed = ALLOWED_TRANSITIONS[key];
  if (!allowed.has(eventType)) {
    throw new IllegalAddressTransitionError(addressId, currentStatus, eventType);
  }
}

export function isTerminalAddressStatus(status: PaymentAddressStatus): boolean {
  return status === "RELEASED" || status === "ARCHIVED";
}

export function isAddressActiveForAttribution(status: PaymentAddressStatus): boolean {
  return status === "ACTIVATED" || status === "ROTATED";
}
