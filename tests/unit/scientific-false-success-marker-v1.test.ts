import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scientificContainerObservationV1 as observe } from "../../scripts/trader/scientific-container-observation-v1";
import {
  RECORDED_90DE233A_FALSE_SUCCESS_FORENSICS_V1 as recorded,
  appendScientificProcessSupersessionV1 as append,
  classifyScientificExitMarkerV1 as classify,
} from "../../scripts/trader/scientific-false-success-marker-v1";

function identity() {
  return {
    organizationId: "3c50b4e9-1138-43a5-a29f-e65088124cfc",
    runId: "fhv-v2-90de233a-rehearsal-20260908-01",
    releaseSha: "90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67",
    attemptId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    containerId: "b".repeat(64),
    containerStartedAt: "2026-09-08T19:51:27.675Z",
  };
}

function container(exitCode: 0 | 1, status: "exited" | "running" = "exited") {
  const raw = {
    containerId: "b".repeat(64),
    startedAt: "2026-09-08T19:51:27.675955822Z",
    finishedAt: status === "running" ? "0001-01-01T00:00:00Z" : "2026-09-12T04:43:00.377755027Z",
    status,
    exitCode: status === "running" ? 0 : exitCode,
    oomKilled: false,
    restartCount: 0,
  };
  return observe(raw, {
    identity: identity(),
    exactDockerStartedAt: raw.startedAt,
    observedAt: "2026-09-12T05:00:00.000Z",
  });
}

describe("false-success marker forensics", () => {
  it("binds the recorded 90de marker bytes and log metadata without rewriting them", () => {
    const bytes = Buffer.from(recorded.markerBytes);
    expect(bytes.equals(Buffer.from("0\n"))).toBe(true);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(recorded.markerSha256Hex);
    expect(classify(bytes)).toBe("ZERO_MARKER");
    expect(recorded.logByteLength).toBe(935405);
    expect(recorded.containerExitCode).toBe(1);
  });

  it("never promotes wrapper/attach zero while the container exited 1", () => {
    const record = append({
      identity: identity(),
      recordedAt: "2026-09-12T05:00:00.000Z",
      markerBytes: Buffer.from(recorded.markerBytes),
      logByteLength: recorded.logByteLength,
      logSha256Hex: recorded.logSha256Hex,
      launchStartedPresent: true,
      attemptNewStart: false,
      attachExitCode: 0,
      container: container(1),
      evidenceVerified: false,
      proposalContentDigestHex: null,
    });
    expect(record).toMatchObject({
      verdict: "FAILED",
      authoritativeProcess: "FAILED",
      attachExitCode: 0,
      containerExitCode: 1,
      markerClassification: "ZERO_MARKER",
      overwritesMarker: false,
      authorityGranted: false,
      duplicateStartRefused: false,
    });
    expect(record.markerSha256Hex).toBe(recorded.markerSha256Hex);
  });

  it("never promotes attach zero while the container is still running", () => {
    const record = append({
      identity: identity(),
      recordedAt: "2026-09-12T05:00:00.000Z",
      markerBytes: Buffer.from(recorded.markerBytes),
      logByteLength: recorded.logByteLength,
      logSha256Hex: recorded.logSha256Hex,
      launchStartedPresent: true,
      attemptNewStart: false,
      attachExitCode: 0,
      container: container(0, "running"),
      evidenceVerified: true,
      proposalContentDigestHex: "c".repeat(64),
    });
    expect(record.verdict).toBe("IN_PROGRESS");
    expect(record.authoritativeProcess).toBe("RUNNING");
    expect(record.authorityGranted).toBe(false);
  });

  it("refuses SUCCESS when the receipt is missing even if both exits are zero", () => {
    const record = append({
      identity: identity(),
      recordedAt: "2026-09-12T05:00:00.000Z",
      markerBytes: Buffer.from("0\n"),
      logByteLength: 8,
      logSha256Hex: "d".repeat(64),
      launchStartedPresent: false,
      attemptNewStart: true,
      attachExitCode: 0,
      container: container(0),
      evidenceVerified: false,
      proposalContentDigestHex: null,
    });
    expect(record.verdict).toBe("UNKNOWN");
    expect(record.authoritativeProcess).toBe("EXITED_ZERO");
    expect(record.issues).toContain("EVIDENCE_ABSENT");
  });

  it("refuses a second start while launch.started is present", () => {
    const first = append({
      identity: identity(),
      recordedAt: "2026-09-12T05:00:00.000Z",
      markerBytes: Buffer.from("0\n"),
      logByteLength: recorded.logByteLength,
      logSha256Hex: recorded.logSha256Hex,
      launchStartedPresent: true,
      attemptNewStart: false,
      attachExitCode: 0,
      container: container(1),
      evidenceVerified: false,
      proposalContentDigestHex: null,
    });
    const second = append(
      {
        identity: identity(),
        recordedAt: "2026-09-12T05:00:01.000Z",
        markerBytes: Buffer.from("0\n"),
        logByteLength: recorded.logByteLength,
        logSha256Hex: recorded.logSha256Hex,
        launchStartedPresent: true,
        attemptNewStart: true,
        attachExitCode: 0,
        container: container(1),
        evidenceVerified: false,
        proposalContentDigestHex: null,
      },
      [first],
    );
    expect(second.duplicateStartRefused).toBe(true);
    expect(second.overwritesMarker).toBe(false);
    expect(second.verdict).not.toBe("TECHNICAL_RESULT_OBSERVED");
  });

  it("treats disconnect/cancel (missing attach code, missing container) as unknown, not PASS", () => {
    const record = append({
      identity: identity(),
      recordedAt: "2026-09-12T05:00:00.000Z",
      markerBytes: Buffer.from("0\n"),
      logByteLength: recorded.logByteLength,
      logSha256Hex: recorded.logSha256Hex,
      launchStartedPresent: true,
      attemptNewStart: false,
      attachExitCode: null,
      container: null,
      evidenceVerified: false,
      proposalContentDigestHex: null,
    });
    expect(record.verdict).toBe("UNKNOWN");
    expect(record.authorityGranted).toBe(false);
  });

  it("is append-only: prior records remain byte-identical after a later append", () => {
    const first = append({
      identity: identity(),
      recordedAt: "2026-09-12T05:00:00.000Z",
      markerBytes: Buffer.from("0\n"),
      logByteLength: recorded.logByteLength,
      logSha256Hex: recorded.logSha256Hex,
      launchStartedPresent: true,
      attemptNewStart: false,
      attachExitCode: 0,
      container: container(1),
      evidenceVerified: false,
      proposalContentDigestHex: null,
    });
    const frozen = JSON.stringify(first);
    append(
      {
        identity: identity(),
        recordedAt: "2026-09-12T05:01:00.000Z",
        markerBytes: Buffer.from("0\n"),
        logByteLength: recorded.logByteLength,
        logSha256Hex: recorded.logSha256Hex,
        launchStartedPresent: true,
        attemptNewStart: false,
        attachExitCode: 1,
        container: container(1),
        evidenceVerified: false,
        proposalContentDigestHex: null,
      },
      [first],
    );
    expect(JSON.stringify(first)).toBe(frozen);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
