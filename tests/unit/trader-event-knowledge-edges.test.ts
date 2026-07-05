import { describe, expect, it } from "vitest";

import {
  buildEventKnowledgeFromRef,
  buildPriceWindowKnowledgeToRef,
  eventKnowledgeRelationKinds,
} from "@/lib/trader/knowledge/event-knowledge-relation-kinds";

describe("event knowledge edges (M7)", () => {
  it("uses observational relation kinds only", () => {
    expect(eventKnowledgeRelationKinds.eventAttributedToPriceMove).toBe(
      "event_attributed_to_price_move",
    );
    expect(eventKnowledgeRelationKinds.eventAssociatedWithPattern).toBe(
      "event_associated_with_pattern",
    );
    expect(eventKnowledgeRelationKinds.eventAssociatedWithClose).toBe(
      "event_associated_with_close",
    );
    expect(eventKnowledgeRelationKinds.eventAssociatedWithRejection).toBe(
      "event_associated_with_rejection",
    );
  });

  it("builds stable edge refs", () => {
    expect(buildEventKnowledgeFromRef({ eventKey: "evt-1", eventDigest: "abc123" })).toBe(
      "event:evt-1@abc123",
    );
    expect(
      buildPriceWindowKnowledgeToRef({
        symbol: "BTC/USDT",
        windowStartMs: 1000,
        windowEndMs: 2000,
      }),
    ).toBe("price_window:BTC/USDT:1000:2000");
  });
});
