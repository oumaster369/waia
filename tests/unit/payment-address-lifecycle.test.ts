import { describe, expect, it } from "vitest";

import {
  assertAddressTransitionAllowed,
  eventTypeToAddressStatus,
  IllegalAddressTransitionError,
  isAddressActiveForAttribution,
  isTerminalAddressStatus,
  paymentAddressEventTypes,
  paymentAddressStatuses,
  type PaymentAddressEventType,
  type PaymentAddressStatus,
} from "@/lib/waia-core/payment-addresses";

const ADDRESS_ID = "00000000-0000-4000-8000-0000000314a1";

const ALLOWED_TRANSITIONS: Array<{
  from: PaymentAddressStatus | null;
  event: PaymentAddressEventType;
}> = [
  { from: null, event: "GENERATED" },
  { from: "GENERATED", event: "RESERVED" },
  { from: "GENERATED", event: "ASSIGNED" },
  { from: "RESERVED", event: "ASSIGNED" },
  { from: "RESERVED", event: "RELEASED" },
  { from: "ASSIGNED", event: "ACTIVATED" },
  { from: "ACTIVATED", event: "ROTATED" },
  { from: "ACTIVATED", event: "RETIRED" },
  { from: "ACTIVATED", event: "RECOVERED" },
  { from: "ROTATED", event: "RETIRED" },
  { from: "RETIRED", event: "ARCHIVED" },
  { from: "RECOVERED", event: "ACTIVATED" },
];

const FORBIDDEN_TRANSITIONS: Array<{
  from: PaymentAddressStatus | null;
  event: PaymentAddressEventType;
}> = [
  { from: "GENERATED", event: "GENERATED" },
  { from: "ASSIGNED", event: "RESERVED" },
  { from: "ACTIVATED", event: "ASSIGNED" },
  { from: "RELEASED", event: "ASSIGNED" },
  { from: "ARCHIVED", event: "ACTIVATED" },
  { from: "RECOVERED", event: "ROTATED" },
  { from: "RETIRED", event: "ACTIVATED" },
];

describe("payment address lifecycle FSM (DEE-314 S2-B)", () => {
  it.each(ALLOWED_TRANSITIONS)("allows transition from $from via $event", ({ from, event }) => {
    expect(() => assertAddressTransitionAllowed(ADDRESS_ID, from, event)).not.toThrow();
  });

  it.each(FORBIDDEN_TRANSITIONS)("forbids transition from $from via $event", ({ from, event }) => {
    expect(() => assertAddressTransitionAllowed(ADDRESS_ID, from, event)).toThrow(
      IllegalAddressTransitionError,
    );
  });

  it("forbids any event from terminal states", () => {
    for (const status of ["RELEASED", "ARCHIVED"] as const) {
      for (const event of paymentAddressEventTypes) {
        expect(() => assertAddressTransitionAllowed(ADDRESS_ID, status, event)).toThrow(
          IllegalAddressTransitionError,
        );
      }
    }
  });

  it("identifies terminal states as RELEASED and ARCHIVED only", () => {
    expect(isTerminalAddressStatus("RELEASED")).toBe(true);
    expect(isTerminalAddressStatus("ARCHIVED")).toBe(true);

    const nonTerminal: PaymentAddressStatus[] = [
      "GENERATED",
      "RESERVED",
      "ASSIGNED",
      "ACTIVATED",
      "ROTATED",
      "RETIRED",
      "RECOVERED",
    ];
    for (const status of nonTerminal) {
      expect(isTerminalAddressStatus(status)).toBe(false);
    }
  });

  it("identifies ACTIVATED and ROTATED as attribution-eligible only", () => {
    expect(isAddressActiveForAttribution("ACTIVATED")).toBe(true);
    expect(isAddressActiveForAttribution("ROTATED")).toBe(true);

    const ineligible: PaymentAddressStatus[] = [
      "GENERATED",
      "RESERVED",
      "RELEASED",
      "ASSIGNED",
      "RETIRED",
      "ARCHIVED",
      "RECOVERED",
    ];
    for (const status of ineligible) {
      expect(isAddressActiveForAttribution(status)).toBe(false);
    }
  });

  it("maps each event type to the same-named address status", () => {
    for (const eventType of paymentAddressEventTypes) {
      expect(eventTypeToAddressStatus(eventType)).toBe(eventType);
    }
  });

  it("allows RECOVERED round-trip through ACTIVATED", () => {
    expect(() =>
      assertAddressTransitionAllowed(ADDRESS_ID, "ACTIVATED", "RECOVERED"),
    ).not.toThrow();
    expect(() =>
      assertAddressTransitionAllowed(ADDRESS_ID, "RECOVERED", "ACTIVATED"),
    ).not.toThrow();
  });

  it("uses ACTIVATED (not ACTIVE) in paymentAddressStatuses", () => {
    expect(paymentAddressStatuses).toContain("ACTIVATED");
    expect(paymentAddressStatuses).not.toContain("ACTIVE");
  });
});
