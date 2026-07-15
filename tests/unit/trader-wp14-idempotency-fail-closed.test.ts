import { describe, expect, it } from "vitest";
import { ForecastDecisionIdempotencyConflictError } from "@/lib/trader/intelligence/forecast-decision/errors";

describe("trader wp14 idempotency fail closed", () => {
  it("uses HTR_WP14_IDEMPOTENCY_CONFLICT code", () => {
    const error = new ForecastDecisionIdempotencyConflictError("mismatch");
    expect(error.code).toBe("HTR_WP14_IDEMPOTENCY_CONFLICT");
  });
});
