import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  beginFhvAuthorizationRunning,
  buildFhvAuthorizationClaimIssued,
  claimFhvAuthorizationExclusive,
  readFhvAuthorizationClaim,
  writeFhvAuthorizationClaimAtomic,
} from "@/lib/trader/observability/fhv-authorization-claim";
import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import { prepareFhvOfficialLaunchExecution } from "@/lib/trader/observability/fhv-execution-checkpoint";
import { readFhvLaunchJournal } from "@/lib/trader/observability/fhv-launch-journal";
import { buildFhvConfigurationFreeze } from "@/lib/trader/observability/fhv-configuration-freeze";

const RUN_ID = "fhv-bootstrap-idempotent-run";
const RELEASE_SHA = "abc12345678901234567890123456789012345678";

const FREEZE = buildFhvConfigurationFreeze({
  releaseSha: RELEASE_SHA,
  runId: RUN_ID,
  organizationId: "00000000-0000-4000-8000-0000000439",
  operatorId: "operator@test",
  datasetDigest: "d".repeat(64),
  manifestDigest: "m".repeat(64),
  strategyVersions: ["mean_reversion_v0@0.1.0"],
  strategyDigests: ["s".repeat(64)],
  checkpointDigest: "c".repeat(64),
});

describe("FHV bootstrap fault injection (Phase 8)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_BOOTSTRAP_IDEMPOTENT_RESUME_PASS: second prepare reuses claim and journal without duplicate bootstrap", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-bootstrap-idem-"));

    const first = prepareFhvOfficialLaunchExecution({
      runDir: runRoot,
      runId: RUN_ID,
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      authorizationReceiptDigest: "r".repeat(64),
      releaseSha: RELEASE_SHA,
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      configurationFreeze: FREEZE,
      leaseOwner: "operator@test",
    });

    expect(existsSync(first.claimPath)).toBe(true);
    expect(existsSync(first.journalPath)).toBe(true);
    const journalAfterFirst = readFhvLaunchJournal(runRoot);

    const second = prepareFhvOfficialLaunchExecution({
      runDir: runRoot,
      runId: RUN_ID,
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      authorizationReceiptDigest: "r".repeat(64),
      releaseSha: RELEASE_SHA,
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      configurationFreeze: FREEZE,
      leaseOwner: "operator@test",
    });

    expect(second.resumeFromCycle).toBe(journalAfterFirst.lastCommittedCycle + 1);
    expect(readFhvLaunchJournal(runRoot).journalDigest).toBe(journalAfterFirst.journalDigest);
    expect(readFhvAuthorizationClaim(first.claimPath).fencingGeneration).toBe(
      readFhvAuthorizationClaim(second.claimPath).fencingGeneration,
    );
    expect(readFileSync(first.journalPath, "utf8")).toBe(readFileSync(second.journalPath, "utf8"));
  });

  it("FHV_BOOTSTRAP_CLAIM_IMMUTABLE_PASS: bootstrap does not rewrite issued claim on resume path", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-bootstrap-claim-"));
    const claimPath = join(runRoot, "control", "fhv-authorization-claim.v2.json");

    prepareFhvOfficialLaunchExecution({
      runDir: runRoot,
      runId: RUN_ID,
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      authorizationReceiptDigest: "r".repeat(64),
      releaseSha: RELEASE_SHA,
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      configurationFreeze: FREEZE,
      leaseOwner: "operator@test",
    });

    const claimBefore = readFileSync(claimPath, "utf8");

    prepareFhvOfficialLaunchExecution({
      runDir: runRoot,
      runId: RUN_ID,
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      authorizationReceiptDigest: "r".repeat(64),
      releaseSha: RELEASE_SHA,
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      configurationFreeze: FREEZE,
      leaseOwner: "operator@test",
    });

    expect(readFileSync(claimPath, "utf8")).toBe(claimBefore);
  });
});
