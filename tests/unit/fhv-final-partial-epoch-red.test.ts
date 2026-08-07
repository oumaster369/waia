import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  beginFhvAuthorizationRunning,
  buildFhvAuthorizationClaimIssued,
  claimFhvAuthorizationExclusive,
  readFhvAuthorizationClaim,
  resolveFhvAuthorizationClaimPath,
  writeFhvAuthorizationClaimAtomic,
} from "@/lib/trader/observability/fhv-authorization-claim";
import {
  commitFhvExecutionEpoch,
  computeFhvCycleZeroCheckpointDigest,
  createFhvEpochBoundaryController,
} from "@/lib/trader/observability/fhv-execution-checkpoint";
import { FHV_CHECKPOINT_READY_MARKER } from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import { FhvExecutionWalWriter } from "@/lib/trader/observability/fhv-execution-wal";
import {
  buildFhvLaunchJournal,
  readFhvLaunchJournal,
  writeFhvLaunchJournalAtomic,
} from "@/lib/trader/observability/fhv-launch-journal";

const RUN_ID = "fhv-final-partial-epoch";

describe("FHV final partial epoch commit (Phase 6)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  function bootstrapExecution(input: { checkpointEveryCycles: number }) {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-final-partial-"));
    const claimPath = resolveFhvAuthorizationClaimPath(runRoot);
    const cycleZeroCheckpointDigest = computeFhvCycleZeroCheckpointDigest({
      configurationFreezeDigest: "f".repeat(64),
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      runId: RUN_ID,
    });
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
    let claim = claimFhvAuthorizationExclusive({
      claimPath,
      leaseOwner: "operator@test",
      leaseExpiresAtUtc: new Date(Date.now() + 86_400_000).toISOString(),
      cycleZeroCheckpointDigest,
    });
    claim = beginFhvAuthorizationRunning({ claimPath, leaseOwner: "operator@test" });
    const walWriter = new FhvExecutionWalWriter(
      runRoot,
      RUN_ID,
      FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      claim.fencingGeneration,
    );
    writeFhvLaunchJournalAtomic(
      runRoot,
      buildFhvLaunchJournal({ runId: RUN_ID, walPath: walWriter.getWalPath() }),
    );
    const controller = createFhvEpochBoundaryController({
      runDir: runRoot,
      runId: RUN_ID,
      claimPath,
      walWriter,
      authorizationClaim: claim,
      checkpointConfig: {
        checkpointEveryCycles: input.checkpointEveryCycles,
        maxCheckpointWalBytes: 67_108_864,
      },
      sourceCursorDigest: "s".repeat(64),
      skipSessionBackup: true,
    });
    controller.beginInitialEpoch();
    return { claimPath, walWriter, controller };
  }

  it("FHV_FINAL_PARTIAL_EPOCH_COMMIT_PASS: commitFinalPartialEpoch commits off-interval tail", async () => {
    const { controller } = bootstrapExecution({ checkpointEveryCycles: 10 });
    const partialLastCycle = 6;
    const result = await controller.commitFinalPartialEpoch(partialLastCycle);

    expect(result.lastCycle).toBe(partialLastCycle);
    expect(existsSync(join(result.checkpointDir, FHV_CHECKPOINT_READY_MARKER))).toBe(true);

    const journal = readFhvLaunchJournal(runRoot);
    expect(journal.lastCommittedEpoch).toBe(0);
    expect(journal.lastCommittedCycle).toBe(partialLastCycle);
  });

  it("FHV_FINAL_PARTIAL_EPOCH_HELPER_PASS: commitFhvExecutionEpoch supports direct partial commit", async () => {
    const { claimPath, walWriter } = bootstrapExecution({ checkpointEveryCycles: 10 });
    const claim = readFhvAuthorizationClaim(claimPath);

    const result = await commitFhvExecutionEpoch({
      runDir: runRoot,
      runId: RUN_ID,
      claimPath,
      walWriter,
      authorizationClaim: claim,
      epochId: 0,
      epochFirstCycle: 0,
      lastCycle: 3,
      walStartOffset: 0,
      previousEpochCommitDigest: "0".repeat(64),
      snapshotDigests: { sourceCursorDigest: "s".repeat(64) },
      skipSessionBackup: true,
      checkpointFiles: {
        "source-cursor.v2.json": '{"partial":true}',
      },
    });

    expect(result.epochId).toBe(0);
    expect(result.lastCycle).toBe(3);
    expect(result.checkpointRelativePath).toBe("checkpoints/epoch-0");
  });
});
