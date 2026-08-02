import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readFhvConfigurationFreezeArtifact } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import {
  prepareFhvOfficialLaunchExecution,
  recoverFhvExecutionWalForResume,
} from "@/lib/trader/observability/fhv-execution-checkpoint";
import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import { recoverFhvExecutionWalTail } from "@/lib/trader/observability/fhv-execution-wal";
import { resolveFhvFullLaunchRunDirectory } from "@/lib/trader/observability/fhv-full-historical-launch";
import { runFullHistoricalBacktest } from "@/lib/trader/observability/fhv-full-historical-engine";
import {
  readFhvAuthorizationClaim,
  resolveFhvAuthorizationClaimPath,
} from "@/lib/trader/observability/fhv-authorization-claim";
import { readFhvLaunchJournal } from "@/lib/trader/observability/fhv-launch-journal";
import {
  buildFhvOfficialV2ScaleDataset,
  FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
  setupFhvOfficialV2MultiYearLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const RUN_ID = "fhv-wal-checkpoint-resume-scale";
const CHECKPOINT_EVERY_CYCLES = 5;

describe("FHV WAL checkpoint resume (Phase 7)", () => {
  it("FHV_WAL_CHECKPOINT_RESUME_PASS: forced crash tail recovery and resume at epoch boundary", async () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), "fhv-wal-resume-artifacts-"));
    const datasetRoot = mkdtempSync(join(tmpdir(), "fhv-wal-resume-dataset-"));
    try {
      const sealed = buildFhvOfficialV2ScaleDataset(datasetRoot);
      const prep = setupFhvOfficialV2MultiYearLaunchArtifacts({
        artifactRoot,
        runId: RUN_ID,
        datasetRoot: sealed.datasetRoot,
        manifestPath: sealed.manifestPath,
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: FHV_TEST_OPERATOR_ID,
      });
      const freezeArtifact = readFhvConfigurationFreezeArtifact(prep.configurationFreezePath);
      const configurationFreeze = {
        ...freezeArtifact.configurationFreeze,
        checkpointEveryCycles: CHECKPOINT_EVERY_CYCLES,
      };
      const runDir = resolveFhvFullLaunchRunDirectory(artifactRoot, RUN_ID);

      const launchExecution = prepareFhvOfficialLaunchExecution({
        runDir,
        runId: RUN_ID,
        executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
        authorizationReceiptDigest: prep.authorizationReceiptDigest,
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        datasetContentDigest: configurationFreeze.datasetDigest,
        manifestSemanticDigest: configurationFreeze.manifestDigest,
        configurationFreeze,
        leaseOwner: `${FHV_TEST_OPERATOR_ID}@${FHV_TEST_ORG_ID}`,
      });

      const phaseOne = await runFullHistoricalBacktest({
        runDir,
        runId: RUN_ID,
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: FHV_TEST_OPERATOR_ID,
        configurationFreeze,
        datasetRoot: sealed.datasetRoot,
        qualificationMode: "OFFICIAL_MULTI_YEAR",
        boundedFixture: false,
        includeHoldout: false,
        maxCycles: CHECKPOINT_EVERY_CYCLES,
        walWriter: launchExecution.walWriter,
        authorizationClaim: launchExecution.authorizationClaim,
        claimPath: launchExecution.claimPath,
        checkpointConfig: launchExecution.checkpointConfig,
        resumeFromCycle: launchExecution.resumeFromCycle,
      });
      expect(phaseOne.cycleCount).toBe(CHECKPOINT_EVERY_CYCLES);

      const journalAfterPhaseOne = readFhvLaunchJournal(runDir);
      expect(journalAfterPhaseOne.lastCommittedEpoch).toBe(0);
      expect(journalAfterPhaseOne.lastCommittedCycle).toBe(CHECKPOINT_EVERY_CYCLES - 1);

      const claimAfterPhaseOne = readFhvAuthorizationClaim(
        resolveFhvAuthorizationClaimPath(runDir),
      );
      expect(claimAfterPhaseOne.state).toBe("RUNNING");
      expect(claimAfterPhaseOne.lastCommittedCycle).toBe(CHECKPOINT_EVERY_CYCLES - 1);

      const walPath = join(runDir, "execution.wal.ndjson");
      appendFileSync(walPath, "{invalid-wal-tail\n", "utf8");
      const recovery = recoverFhvExecutionWalForResume(runDir);
      expect(recovery.truncatedTailBytes).toBeGreaterThan(0);
      expect(recovery.validRecords.length).toBeGreaterThan(0);
      expect(
        recovery.validRecords.some(
          (record) =>
            record.recordType === "EPOCH_COMMIT" || record.recordType === "EXECUTION_CHECKPOINT",
        ),
      ).toBe(true);

      const { validRecords, truncatedTailBytes } = recoverFhvExecutionWalTail(walPath);
      expect(truncatedTailBytes).toBeGreaterThan(0);
      expect(validRecords.length).toBeGreaterThan(0);

      const resumeExecution = prepareFhvOfficialLaunchExecution({
        runDir,
        runId: RUN_ID,
        executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
        authorizationReceiptDigest: prep.authorizationReceiptDigest,
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        datasetContentDigest: configurationFreeze.datasetDigest,
        manifestSemanticDigest: configurationFreeze.manifestDigest,
        configurationFreeze,
        leaseOwner: `${FHV_TEST_OPERATOR_ID}@${FHV_TEST_ORG_ID}`,
      });
      expect(resumeExecution.resumeFromCycle).toBe(CHECKPOINT_EVERY_CYCLES);
      expect(resumeExecution.authorizationClaim.state).toBe("RUNNING");
      expect(resumeExecution.walWriter.totalRecords).toBe(recovery.validRecords.length);

      resumeExecution.walWriter.appendRecord({
        epochId: 1,
        cycleIndex: CHECKPOINT_EVERY_CYCLES,
        cycleCommitId: `${RUN_ID}:1:${CHECKPOINT_EVERY_CYCLES}:resume-begin`,
        recordType: "EPOCH_BEGIN",
        payload: {
          epochId: 1,
          firstCycle: CHECKPOINT_EVERY_CYCLES,
          resumed: true,
        },
      });

      const afterResume = recoverFhvExecutionWalTail(walPath);
      expect(afterResume.truncatedTailBytes).toBe(0);
      expect(afterResume.validRecords.length).toBe(recovery.validRecords.length + 1);
      expect(afterResume.validRecords.at(-1)?.recordType).toBe("EPOCH_BEGIN");
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(datasetRoot, { recursive: true, force: true });
    }
  }, 300_000);
});
