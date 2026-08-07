import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertFhvStaleProcessRejected,
  beginFhvAuthorizationRunning,
  buildFhvAuthorizationClaimIssued,
  claimFhvAuthorizationExclusive,
  FhvAuthorizationClaimError,
  readFhvAuthorizationClaim,
  takeoverFhvAuthorizationRunning,
  writeFhvAuthorizationClaimAtomic,
} from "@/lib/trader/observability/fhv-authorization-claim";
import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import { FhvExecutionWalWriter } from "@/lib/trader/observability/fhv-execution-wal";

const RUN_ID = "fhv-stale-writer-run";

describe("FHV stale writer fencing (Phase 8)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_STALE_FENCING_REJECTED_PASS: stale process rejected after takeover bumps generation", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-stale-writer-"));
    const claimPath = join(runRoot, "control", "fhv-authorization-claim.v2.json");

    const issued = buildFhvAuthorizationClaimIssued({
      authorizationReceiptDigest: "r".repeat(64),
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      runId: RUN_ID,
      releaseSha: "abc123",
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      configurationFreezeDigest: "f".repeat(64),
    });
    writeFhvAuthorizationClaimAtomic(claimPath, issued);
    claimFhvAuthorizationExclusive({
      claimPath,
      leaseOwner: "operator-a",
      leaseExpiresAtUtc: new Date(Date.now() + 86_400_000).toISOString(),
      cycleZeroCheckpointDigest: "z".repeat(64),
    });
    beginFhvAuthorizationRunning({ claimPath, leaseOwner: "operator-a" });

    const staleWriter = new FhvExecutionWalWriter(
      runRoot,
      RUN_ID,
      FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      1,
    );
    staleWriter.appendRecord({
      epochId: 0,
      cycleIndex: 0,
      cycleCommitId: `${RUN_ID}:0:0:begin`,
      recordType: "EPOCH_BEGIN",
      payload: { epochId: 0, firstCycle: 0 },
    });

    takeoverFhvAuthorizationRunning({
      claimPath,
      leaseOwner: "operator-b",
    });
    const claim = readFhvAuthorizationClaim(claimPath);
    expect(claim.fencingGeneration).toBe(2);

    expect(() =>
      assertFhvStaleProcessRejected({
        claim,
        writerFencingGeneration: 1,
      }),
    ).toThrow(FhvAuthorizationClaimError);
  });
});
