import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomicCompareAndReplace } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  beginFhvAuthorizationRunning,
  buildFhvAuthorizationClaimIssued,
  buildFhvTerminalResult,
  claimFhvAuthorizationExclusive,
  completeFhvAuthorizationClaim,
  FhvAuthorizationClaimError,
  FHV_TERMINAL_RESULT_FILENAME,
  readFhvAuthorizationClaim,
  reconcileFhvTerminalState,
  resolveFhvTerminalResultPath,
  takeoverFhvAuthorizationRunning,
  writeFhvAuthorizationClaimAtomic,
  writeFhvTerminalResultAtomic,
} from "@/lib/trader/observability/fhv-authorization-claim";
import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import {
  publishFhvExecutionCheckpointBundle,
  readFhvExecutionCheckpointBundle,
} from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

const RUN_ID = "fhv-terminal-reconcile-run";

function writeRunningClaim(claimPath: string): void {
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
    leaseOwner: "operator@test",
    leaseExpiresAtUtc: new Date(Date.now() + 86_400_000).toISOString(),
    cycleZeroCheckpointDigest: "z".repeat(64),
  });
  beginFhvAuthorizationRunning({ claimPath, leaseOwner: "operator@test" });
  const claim = readFhvAuthorizationClaim(claimPath);
  const { authorizationClaimDigest: _digest, ...body } = claim;
  const patched = {
    ...body,
    lastCommittedEpoch: 0,
    lastCommittedCycle: 9,
    checkpointDigest: "c".repeat(64),
    walCommitDigest: "w".repeat(64),
  };
  const next = {
    ...patched,
    authorizationClaimDigest: computeStableJsonDigest(patched),
  };
  writeFileAtomicCompareAndReplace({
    finalPath: claimPath,
    expectedContent: `${JSON.stringify(claim, null, 2)}\n`,
    nextContent: `${JSON.stringify(next, null, 2)}\n`,
  });
}

describe("FHV terminal reconcile (Phase 6)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_TERMINAL_CLAIM_COMPLETION_PASS: RUNNING + valid terminal completes claim", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-terminal-complete-"));
    const claimPath = join(runRoot, "control", "fhv-authorization-claim.v2.json");
    const terminalPath = resolveFhvTerminalResultPath(runRoot);
    writeRunningClaim(claimPath);

    const terminal = buildFhvTerminalResult({
      runId: RUN_ID,
      classification: "FULL_HISTORICAL_TECHNICAL_COMPLETION",
      semanticReproDigest: "s".repeat(64),
    });
    writeFhvTerminalResultAtomic(terminalPath, terminal);

    const result = reconcileFhvTerminalState({
      claimPath,
      terminalResultPath: terminalPath,
      runDir: runRoot,
    });
    expect(result.action).toBe("complete");
    if (result.action === "complete") {
      expect(result.claim.state).toBe("COMPLETED");
      expect(result.claim.terminalResultDigest).toBe(terminal.terminalResultDigest);
    }
  });

  it("FHV_TERMINAL_RECONCILE_RESUME_PASS: RUNNING without terminal resumes", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-terminal-resume-"));
    const claimPath = join(runRoot, "control", "fhv-authorization-claim.v2.json");
    writeRunningClaim(claimPath);

    const result = reconcileFhvTerminalState({
      claimPath,
      terminalResultPath: resolveFhvTerminalResultPath(runRoot),
      runDir: runRoot,
    });
    expect(result).toEqual({ action: "resume" });
  });

  it("FHV_TERMINAL_DOUBLE_COMPLETE_PASS: COMPLETED with matching terminal is idempotent", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-terminal-idempotent-"));
    const claimPath = join(runRoot, "control", "fhv-authorization-claim.v2.json");
    const terminalPath = resolveFhvTerminalResultPath(runRoot);
    writeRunningClaim(claimPath);

    const terminal = buildFhvTerminalResult({
      runId: RUN_ID,
      classification: "FULL_HISTORICAL_TECHNICAL_COMPLETION",
      semanticReproDigest: "s".repeat(64),
    });
    writeFhvTerminalResultAtomic(terminalPath, terminal);
    completeFhvAuthorizationClaim({
      claimPath,
      terminalResultDigest: terminal.terminalResultDigest,
    });

    const result = reconcileFhvTerminalState({
      claimPath,
      terminalResultPath: terminalPath,
      runDir: runRoot,
    });
    expect(result.action).toBe("already_complete");
  });

  it("FHV_TERMINAL_TAKEOVER_PASS: takeover increments fencing generation while RUNNING", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-terminal-takeover-"));
    const claimPath = join(runRoot, "control", "fhv-authorization-claim.v2.json");
    writeRunningClaim(claimPath);

    const taken = takeoverFhvAuthorizationRunning({
      claimPath,
      leaseOwner: "new-operator@test",
      leaseExpiresAtUtc: new Date(Date.now() + 172_800_000).toISOString(),
    });
    expect(taken.fencingGeneration).toBe(2);
    expect(taken.activeGeneration).toBe(2);
    expect(taken.leaseOwner).toBe("new-operator@test");
    expect(readFhvAuthorizationClaim(claimPath).fencingGeneration).toBe(2);
  });

  it("FHV_TERMINAL_RECONSTRUCT_PASS: COMPLETED without terminal reconstructs from checkpoint", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-terminal-reconstruct-"));
    const claimPath = join(runRoot, "control", "fhv-authorization-claim.v2.json");
    const terminalPath = resolveFhvTerminalResultPath(runRoot);
    writeRunningClaim(claimPath);

    const terminal = buildFhvTerminalResult({
      runId: RUN_ID,
      classification: "FULL_HISTORICAL_TECHNICAL_COMPLETION",
      semanticReproDigest: "s".repeat(64),
    });

    const checkpointDir = publishFhvExecutionCheckpointBundle({
      runDir: runRoot,
      runId: RUN_ID,
      epochId: 0,
      generation: 1,
      firstCycle: 0,
      lastCycle: 9,
      files: {
        [FHV_TERMINAL_RESULT_FILENAME]: `${JSON.stringify(terminal, null, 2)}\n`,
      },
      sourceCursorDigest: "1".repeat(64),
      executionStateDigest: "2".repeat(64),
      accountingFrontierDigest: "3".repeat(64),
      identityFrontierDigest: "4".repeat(64),
      evidenceFrontierDigest: "5".repeat(64),
      sessionDatabaseDigest: "6".repeat(64),
    }).checkpointDir;

    readFhvExecutionCheckpointBundle(checkpointDir);

    completeFhvAuthorizationClaim({
      claimPath,
      terminalResultDigest: terminal.terminalResultDigest,
    });

    const result = reconcileFhvTerminalState({
      claimPath,
      terminalResultPath: terminalPath,
      runDir: runRoot,
    });
    expect(result.action).toBe("reconstructed");
  });

  it("FHV_TERMINAL_INVALID_DIGEST_PASS: invalid terminal digest fails closed", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-terminal-invalid-"));
    const claimPath = join(runRoot, "control", "fhv-authorization-claim.v2.json");
    const terminalPath = resolveFhvTerminalResultPath(runRoot);
    writeRunningClaim(claimPath);

    writeFileSync(
      terminalPath,
      `${JSON.stringify({
        schemaVersion: "fhv-terminal-result/v1",
        runId: RUN_ID,
        classification: "FULL_HISTORICAL_TECHNICAL_COMPLETION",
        semanticReproDigest: "s".repeat(64),
        terminalResultDigest: "0".repeat(64),
      })}\n`,
      "utf8",
    );

    expect(() =>
      reconcileFhvTerminalState({
        claimPath,
        terminalResultPath: terminalPath,
        runDir: runRoot,
      }),
    ).toThrow(FhvAuthorizationClaimError);
  });
});
