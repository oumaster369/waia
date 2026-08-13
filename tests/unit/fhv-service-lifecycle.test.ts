import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  beginFhvAuthorizationRunning,
  buildFhvAuthorizationClaimIssued,
  claimFhvAuthorizationExclusive,
  FhvAuthorizationClaimError,
  readFhvAuthorizationClaim,
  writeFhvAuthorizationClaimAtomic,
} from "@/lib/trader/observability/fhv-authorization-claim";
import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import {
  assertFhvRunningClaimNotStale,
  evaluateFhvStaleRunningClaim,
  resolveFhvStaleRunningClaimAction,
} from "@/lib/trader/observability/fhv-service-lifecycle";

const RUN_ID = "fhv-stale-running-run";

describe("DEE-524 FHV stale RUNNING claim", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  function seedRunningClaim(leaseExpiresAtUtc: string) {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-stale-running-"));
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
      leaseExpiresAtUtc,
      cycleZeroCheckpointDigest: "z".repeat(64),
    });
    beginFhvAuthorizationRunning({ claimPath, leaseOwner: "operator-a" });
    return readFhvAuthorizationClaim(claimPath);
  }

  it("detects stale RUNNING when lease expired and heartbeat missing", () => {
    const claim = seedRunningClaim("2020-01-01T00:00:00.000Z");
    const decision = evaluateFhvStaleRunningClaim({
      claim,
      nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
      lastHeartbeatAtUtc: null,
    });
    expect(decision.stale).toBe(true);
    expect(decision.code).toBe("CLAIM_STALE");
    expect(decision.leaseExpired).toBe(true);
    expect(decision.heartbeatMissing).toBe(true);
    expect(resolveFhvStaleRunningClaimAction(decision)).toBe("TAKEOVER");
  });

  it("accepts RUNNING claim with valid lease and fresh heartbeat", () => {
    const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
    const claim = seedRunningClaim("2026-07-21T13:00:00.000Z");
    const decision = evaluateFhvStaleRunningClaim({
      claim,
      nowMs,
      lastHeartbeatAtUtc: "2026-07-21T11:59:30.000Z",
      heartbeatMaxAgeMs: 120_000,
    });
    expect(decision.stale).toBe(false);
    expect(() =>
      assertFhvRunningClaimNotStale({
        claim,
        nowMs,
        lastHeartbeatAtUtc: "2026-07-21T11:59:30.000Z",
      }),
    ).not.toThrow();
  });

  it("fail-closes resume when heartbeat is stale despite valid lease", () => {
    const nowMs = Date.parse("2026-07-21T12:05:00.000Z");
    const claim = seedRunningClaim("2026-07-21T13:00:00.000Z");
    expect(() =>
      assertFhvRunningClaimNotStale({
        claim,
        nowMs,
        lastHeartbeatAtUtc: "2026-07-21T11:00:00.000Z",
        heartbeatMaxAgeMs: 120_000,
      }),
    ).toThrow(FhvAuthorizationClaimError);
  });
});
