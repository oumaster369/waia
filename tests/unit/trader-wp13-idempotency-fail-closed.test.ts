import { describe, expect, it } from "vitest";
import { IntelligenceRecordsIdempotencyConflictError } from "@/lib/trader/intelligence/records/errors";

describe("trader wp13 idempotency fail closed", () => {
  it("uses HTR_WP13_IDEMPOTENCY_CONFLICT code", () => {
    const error = new IntelligenceRecordsIdempotencyConflictError("mismatch");
    expect(error.code).toBe("HTR_WP13_IDEMPOTENCY_CONFLICT");
  });
});
