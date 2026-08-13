import { describe, expect, it } from "vitest";

import {
  classifyFhvArtifactLifecycle,
  FHV_ARTIFACT_LIFECYCLE_STATES,
} from "@/lib/trader/observability/fhv-artifact-lifecycle";
import {
  assertFhvDiskPreflightPass,
  evaluateFhvDiskPreflightGate,
} from "@/lib/trader/observability/fhv-disk-preflight-gate";
import {
  classifyFhvNativeCloneUnavailable,
  classifyFhvStorageIoError,
} from "@/lib/trader/observability/fhv-storage-retry-classifier";

describe("DEE-523 FHV storage retry classifier", () => {
  it("classifies ENOSPC as fail-closed with no retry", () => {
    const decision = classifyFhvStorageIoError(
      Object.assign(new Error("no space left on device"), { code: "ENOSPC" }),
    );
    expect(decision.classification).toBe("ENOSPC_FAIL_CLOSED");
    expect(decision.retryAllowed).toBe(false);
    expect(decision.failClosed).toBe(true);
  });

  it("classifies semantic integrity failures as no-retry", () => {
    const decision = classifyFhvStorageIoError(new Error("checkpoint digest mismatch"));
    expect(decision.classification).toBe("NO_RETRY_SEMANTIC");
    expect(decision.retryAllowed).toBe(false);
  });

  it("classifies transient errno as retryable", () => {
    const decision = classifyFhvStorageIoError(
      Object.assign(new Error("resource temporarily unavailable"), { code: "EAGAIN" }),
    );
    expect(decision.classification).toBe("RETRY_TRANSIENT");
    expect(decision.retryAllowed).toBe(true);
    expect(decision.failClosed).toBe(false);
  });

  it("classifies native clone unavailable without fail-closed", () => {
    const decision = classifyFhvNativeCloneUnavailable("ext4 cannot reflink");
    expect(decision.classification).toBe("NATIVE_CLONE_UNAVAILABLE");
    expect(decision.failClosed).toBe(false);
  });
});

describe("DEE-523 FHV disk preflight gate", () => {
  const terabyte = 1024 ** 4;

  it("passes when hot + checkpoint + reserve fit within host policy", () => {
    const decision = evaluateFhvDiskPreflightGate({
      totalCapacityBytes: terabyte,
      currentFreeBytes: terabyte * 0.5,
      hotStateBytes: 512 * 1024 ** 2,
      checkpointBytes: 1024 ** 3,
      safetyReserveBytes: 256 * 1024 ** 2,
    });
    expect(decision.pass).toBe(true);
    expect(decision.classification).toBe("FHV_DISK_PREFLIGHT_PASS");
    assertFhvDiskPreflightPass(decision);
  });

  it("fails closed with ENOSPC classification when free bytes are below required peak", () => {
    const decision = evaluateFhvDiskPreflightGate({
      totalCapacityBytes: terabyte,
      currentFreeBytes: 1024 ** 3,
      hotStateBytes: 512 * 1024 ** 2,
      checkpointBytes: 2 * 1024 ** 3,
      safetyReserveBytes: 512 * 1024 ** 2,
    });
    expect(decision.pass).toBe(false);
    expect(decision.classification).toBe("FHV_ENOSPC_FAIL_CLOSED");
  });
});

describe("DEE-523 FHV artifact lifecycle", () => {
  it("pins the four Gate-C lifecycle states", () => {
    expect(FHV_ARTIFACT_LIFECYCLE_STATES).toEqual([
      "CANONICAL_EVIDENCE",
      "ACTIVE_STATE",
      "PROVEN_ORPHAN",
      "TEMPORARY",
    ]);
    const record = classifyFhvArtifactLifecycle({
      artifactPath: "/data/run/checkpoint-0",
      lifecycleState: "ACTIVE_STATE",
    });
    expect(record.schemaVersion).toBe("fhv-artifact-lifecycle/v1");
    expect(record.lifecycleState).toBe("ACTIVE_STATE");
  });
});
