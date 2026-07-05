import { describe, expect, it } from "vitest";

import { classifyEventDeterministic } from "@/lib/trader/events/event-classifier";
import { eventClassificationKinds } from "@/lib/trader/events/event-classification-kinds";
import type { NormalizedEventRecord } from "@/lib/trader/events/event-attribution.types";

const baseEvent: NormalizedEventRecord = {
  eventKey: "evt-1",
  sourceRef: "fixture:test",
  eventTime: "2026-01-01T12:00:00.000Z",
  symbolScope: "BTC/USDT",
  payloadJson: JSON.stringify({ metadata: {} }),
  contentDigest: "digest-1",
};

describe("event classifier (M7)", () => {
  it("classifies from metadata kindHint deterministically", () => {
    const event: NormalizedEventRecord = {
      ...baseEvent,
      payloadJson: JSON.stringify({ metadata: { kindHint: "volatility_spike" } }),
    };
    const a = classifyEventDeterministic({ event });
    const b = classifyEventDeterministic({ event });
    expect(a).toEqual(b);
    expect(a.classificationKind).toBe(eventClassificationKinds.volatilitySpike);
  });

  it("falls back to unknown_external", () => {
    const result = classifyEventDeterministic({ event: baseEvent });
    expect(result.classificationKind).toBe(eventClassificationKinds.unknownExternal);
  });

  it("classifies listing metadata", () => {
    const event: NormalizedEventRecord = {
      ...baseEvent,
      payloadJson: JSON.stringify({ metadata: { listingAction: "list" } }),
    };
    expect(classifyEventDeterministic({ event }).classificationKind).toBe(
      eventClassificationKinds.listing,
    );
  });
});
