import { describe, expect, it } from "vitest";

import {
  canonicalExchangeTradeId,
  computeHistoricalFillIdentityDigest,
  DeterministicExecutionIdCollisionError,
  fillExecutionEconomicsRowId,
  historicalFillId,
} from "@/lib/trader/execution/deterministic-execution-id";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";

describe("HTR-WP17 deterministic execution identity", () => {
  const orgA = "00000000-0000-4000-8000-000000041701";
  const orgB = "00000000-0000-4000-8000-000000041702";
  const orderId = "00000000-0000-4000-8000-000000041703";

  it("separates WP10 numeric UUIDv4 scheme from WP17 content-addressed UUIDv8", () => {
    const wp10Id = createDeterministicReplayIdFactory(415_900)();
    const wp17Id = historicalFillId({
      organizationId: orgA,
      orderId,
      fillSequence: 1,
      sourceBarIndex: 5,
    });

    expect(wp10Id).toMatch(/^00000000-0000-4/);
    expect(wp17Id.split("-")[2]?.[0]).toBe("8");
    expect(wp10Id).not.toBe(wp17Id);
  });

  it("produces stable fill and economics row ids across replay", () => {
    const input = {
      organizationId: orgA,
      orderId,
      fillSequence: 2,
      sourceBarIndex: 7,
    };
    const first = historicalFillId(input);
    const second = historicalFillId(input);
    expect(first).toBe(second);
    expect(fillExecutionEconomicsRowId(first)).toBe(fillExecutionEconomicsRowId(first));
    expect(fillExecutionEconomicsRowId(first)).not.toBe(first);
  });

  it("isolates identities by organizationId", () => {
    const base = { orderId, fillSequence: 1, sourceBarIndex: 3 };
    const orgAFill = historicalFillId({ ...base, organizationId: orgA });
    const orgBFill = historicalFillId({ ...base, organizationId: orgB });
    expect(orgAFill).not.toBe(orgBFill);
    expect(computeHistoricalFillIdentityDigest({ ...base, organizationId: orgA })).not.toBe(
      computeHistoricalFillIdentityDigest({ ...base, organizationId: orgB }),
    );
  });

  it("canonicalExchangeTradeId keys slices by order and sequence", () => {
    const slice1 = canonicalExchangeTradeId(orderId, 1);
    const slice2 = canonicalExchangeTradeId(orderId, 2);
    expect(slice1).not.toBe(slice2);
    expect(canonicalExchangeTradeId(orderId, 1)).toBe(slice1);
  });

  it("stress-generates unique fill ids without intra-scheme collision", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = historicalFillId({
        organizationId: orgA,
        orderId: `order-${i}`,
        fillSequence: (i % 3) + 1,
        sourceBarIndex: i + 1,
      });
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it("binds fill identity to sourceBarIndex so same sequence on different bars diverges", () => {
    const base = { organizationId: orgA, orderId, fillSequence: 1 };
    const barN1 = historicalFillId({ ...base, sourceBarIndex: 4 });
    const barN2 = historicalFillId({ ...base, sourceBarIndex: 5 });
    expect(barN1).not.toBe(barN2);
  });

  it("exposes DeterministicExecutionIdCollisionError for repository fail-closed contract", () => {
    const error = new DeterministicExecutionIdCollisionError("content conflict");
    expect(error.name).toBe("DeterministicExecutionIdCollisionError");
  });
});
