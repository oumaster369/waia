import { describe, expect, it } from "vitest";

import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import {
  assertHoldoutGateClosedExposure,
  redactHoldoutPayload,
} from "@/lib/trader/observability/fhv-holdout-redaction";

const BASE_INPUT = {
  runId: "dee-416-holdout-run",
  phase: "developmentCalibration",
  codeSha: "sha416",
  artifactDigest: "artifact-digest",
  datasetSeal: "dataset-seal",
  datasetDigest: "dataset-digest-sealed",
  configurationDigest: "config-digest",
} as const;

describe("DEE-416 FHV holdout no early access integration", () => {
  it("redacts admin status payload and forbids holdout economic fields", () => {
    const status = buildFhvOperatorStatusV1(BASE_INPUT);
    const contaminated = {
      ...(status as unknown as Record<string, unknown>),
      holdoutPnl: "12345.67",
      holdoutEquity: "99999.99",
      holdoutTrades: [{ id: "trade-1", pnl: "100" }],
      holdoutDecisions: [{ id: "decision-1" }],
      holdoutHypotheses: [{ id: "hyp-1" }],
      holdoutCandidateRankings: [{ candidateId: "cand-1", rank: 1 }],
      holdoutComparisonResults: [{ baseline: "a", variant: "b" }],
      blindHoldoutPnl: "555.00",
      blindHoldoutEquity: "888.00",
    };

    const redacted = redactHoldoutPayload(contaminated, false);
    assertHoldoutGateClosedExposure(redacted);

    expect(redacted.holdoutPnl).toBeUndefined();
    expect(redacted.holdoutEquity).toBeUndefined();
    expect(redacted.holdoutTrades).toBeUndefined();
    expect(redacted.blindHoldoutPnl).toBeUndefined();
    expect((redacted as Record<string, unknown>).holdout).toEqual({
      holdoutState: "SEALED_NOT_ACCESSED",
      holdoutGate: "CLOSED",
      holdoutDatasetDigest: BASE_INPUT.datasetDigest,
      holdoutAccessAttempts: 0,
      blindHoldoutStatus: "SEALED_NOT_ACCESSED",
      holdoutAccess: "PROHIBITED_UNTIL_OPERATOR_PROCEDURE",
    });
  });

  it("keeps built status holdout section gate-closed without economic leakage", () => {
    const status = buildFhvOperatorStatusV1(BASE_INPUT);
    const redacted = redactHoldoutPayload(status as unknown as Record<string, unknown>, false);
    assertHoldoutGateClosedExposure(redacted);
    expect((redacted as Record<string, unknown>).holdout).toMatchObject({
      holdoutState: "SEALED_NOT_ACCESSED",
      holdoutGate: "CLOSED",
      holdoutAccess: "PROHIBITED_UNTIL_OPERATOR_PROCEDURE",
    });
  });
});
