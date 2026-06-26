import { IllegalAccountStatusTransitionError } from "@/lib/trader/settlement/settlement.errors";
import type {
  AccountStatus,
  AccountStatusEventType,
} from "@/lib/trader/settlement/settlement.types";

export function resolveStatusAfterReactivation(): AccountStatus {
  return "ACTIVE";
}

export function shouldAppendReactivationEvent(currentStatus: AccountStatus | null): boolean {
  return currentStatus === "SUSPENDED";
}

export function assertReactivationAllowed(
  currentStatus: AccountStatus | null,
  eventType: AccountStatusEventType,
): void {
  if (eventType !== "REACTIVATED") {
    throw new IllegalAccountStatusTransitionError(currentStatus ?? "NONE", eventType);
  }
  if (currentStatus !== null && currentStatus !== "SUSPENDED" && currentStatus !== "ACTIVE") {
    throw new IllegalAccountStatusTransitionError(currentStatus, eventType);
  }
}
