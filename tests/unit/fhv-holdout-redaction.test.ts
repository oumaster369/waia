import { describe, expect, it } from "vitest";

import {
  assertHoldoutGateClosedExposure,
  buildClosedHoldoutStatus,
  redactHoldoutPayload,
} from "@/lib/trader/observability/fhv-holdout-redaction";

describe("DEE-416 FHV holdout redaction", () => {
  it("builds closed-gate holdout status with digest", () => {
    const holdout = buildClosedHoldoutStatus({
      holdoutDatasetDigest: "holdout-digest-416",
      holdoutAccessAttempts: 2,
    });
    expect(holdout.holdoutGate).toBe("CLOSED");
    expect(holdout.holdoutDatasetDigest).toBe("holdout-digest-416");
    expect(holdout.holdoutAccessAttempts).toBe(2);
    expect(holdout.blindHoldoutStatus).toBe("SEALED_NOT_ACCESSED");
  });

  it("redacts prohibited holdout keys when gate is closed", () => {
    const payload = {
      runId: "run-416",
      holdoutPnl: "123.45",
      holdoutEquity: "999.99",
      holdout: {
        holdoutGate: "OPEN",
        holdoutDatasetDigest: "digest-416",
        holdoutPnl: "secret",
      },
    };
    const redacted = redactHoldoutPayload(payload, false);
    expect(redacted.runId).toBe("run-416");
    expect(redacted).not.toHaveProperty("holdoutPnl");
    expect(redacted).not.toHaveProperty("holdoutEquity");
    expect(redacted.holdout).toMatchObject({
      holdoutGate: "CLOSED",
      holdoutDatasetDigest: "digest-416",
      holdoutAccess: "PROHIBITED_UNTIL_OPERATOR_PROCEDURE",
    });
  });

  it("leaves payload unchanged when holdout gate is open", () => {
    const payload = {
      holdoutPnl: "123.45",
      holdoutEquity: "999.99",
    };
    const unchanged = redactHoldoutPayload(payload, true);
    expect(unchanged).toEqual(payload);
  });

  it("assertHoldoutGateClosedExposure rejects prohibited exposure", () => {
    expect(() =>
      assertHoldoutGateClosedExposure({
        runId: "run-416",
        holdoutTrades: [{ id: "trade-1" }],
      }),
    ).toThrow("FHV_HOLDOUT_REDACTION_VIOLATION:holdoutTrades");
  });

  it("assertHoldoutGateClosedExposure passes clean closed-gate payload", () => {
    expect(() =>
      assertHoldoutGateClosedExposure({
        runId: "run-416",
        holdout: buildClosedHoldoutStatus({ holdoutDatasetDigest: "digest-416" }),
      }),
    ).not.toThrow();
  });
});
