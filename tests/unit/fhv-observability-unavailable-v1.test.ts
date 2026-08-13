import { describe, expect, it } from "vitest";

import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import {
  fhvProducerUnavailable,
  fhvProducerValue,
  produceFhvEvidenceEventSequence,
  produceFhvEvidenceHealth,
} from "@/lib/trader/observability/fhv-operator-status-producers";

describe("DEE-525 observability producer|UNAVAILABLE", () => {
  it("missing evidence-event producer => UNAVAILABLE (not fabricated 0)", () => {
    const produced = produceFhvEvidenceEventSequence({ checkpoint: null });
    expect(produced).toEqual(fhvProducerUnavailable());
  });

  it("real producer returning 0 => VALUE(0)", () => {
    expect(produceFhvEvidenceEventSequence({ authoritativeEventSequence: 0 })).toEqual(
      fhvProducerValue(0),
    );
  });

  it("missing health producer => UNAVAILABLE; real ok preserved", () => {
    expect(produceFhvEvidenceHealth({})).toEqual(fhvProducerUnavailable());
    expect(produceFhvEvidenceHealth({ evidenceHealth: "ok" })).toEqual(fhvProducerValue("ok"));
    expect(produceFhvEvidenceHealth({ evidenceHealth: "failed" })).toEqual(
      fhvProducerValue("failed"),
    );
  });

  it("status builder does not default missing health to ok", () => {
    const status = buildFhvOperatorStatusV1({
      runId: "run",
      phase: "phase",
      codeSha: "a".repeat(40),
      artifactDigest: "b".repeat(64),
      datasetSeal: "seal",
      datasetDigest: "c".repeat(64),
      configurationDigest: "d".repeat(64),
    });
    expect(status.evidence.evidenceHealth).toBe("UNAVAILABLE");
    expect(status.evidence.eventSequence).toBeNull();
  });
});
