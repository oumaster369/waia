import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  FHV_CHECKPOINT_READY_MARKER,
  FHV_PROVISIONAL_CHECKPOINTS_DIRNAME,
  isCanonicalFhvEpochCheckpointDirName,
  readFhvExecutionCheckpointBundle,
  resolveFhvEpochCheckpointDir,
} from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import { IDHPS_COMPOSITE_MIRROR_FILENAME } from "@/lib/trader/observability/idhps-composite-mirror-snapshot";
import { resolveFhvEpochEvidenceSegmentDir } from "@/lib/trader/observability/fhv-composite-evidence-sink";
import { readFhvLaunchJournal } from "@/lib/trader/observability/fhv-launch-journal";
import { truncateFhvExecutionWalToJournalAuthoritativeCommit } from "@/lib/trader/observability/fhv-execution-wal";

export class FhvTwoPhaseRecoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvTwoPhaseRecoveryError";
  }
}

function removeTree(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

/**
 * Fail-closed resume cleanup keyed only by validated journal authority.
 * Must run before opening a new evidence writer or replaying.
 */
export function cleanupFhvTwoPhaseResumeState(runDir: string): {
  lastCommittedEpoch: number;
  lastCommittedCycle: number;
  lastEpochCommitDigest: string;
} {
  const journal = readFhvLaunchJournal(runDir);
  const lastCommittedEpoch = journal.lastCommittedEpoch;
  const checkpointsParent = join(runDir, "checkpoints");
  const provisionalParent = join(checkpointsParent, FHV_PROVISIONAL_CHECKPOINTS_DIRNAME);
  removeTree(provisionalParent);

  if (existsSync(checkpointsParent)) {
    for (const entry of readdirSync(checkpointsParent, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isCanonicalFhvEpochCheckpointDirName(entry.name)) continue;
      const epochId = Number(entry.name.slice("epoch-".length));
      if (epochId > lastCommittedEpoch) {
        removeTree(join(checkpointsParent, entry.name));
      }
    }
  }

  if (lastCommittedEpoch >= 0) {
    const canonical = resolveFhvEpochCheckpointDir(runDir, lastCommittedEpoch);
    if (!existsSync(join(canonical, FHV_CHECKPOINT_READY_MARKER))) {
      throw new FhvTwoPhaseRecoveryError(
        "FHV_EVIDENCE_CLEANUP_REQUIRED_EPOCH_MISSING",
        `journal epoch ${lastCommittedEpoch} canonical checkpoint missing or not .ready`,
      );
    }
    const bundle = readFhvExecutionCheckpointBundle(canonical);
    const hasComposite = bundle.manifest.files.some(
      (file) => file.relativePath === IDHPS_COMPOSITE_MIRROR_FILENAME,
    );
    if (!hasComposite) {
      throw new FhvTwoPhaseRecoveryError(
        "FHV_IDHPS_COMPOSITE_REQUIRED_MISSING",
        `two-phase checkpoint epoch ${lastCommittedEpoch} is missing the required composite`,
      );
    }
  }

  const evidenceRoot = join(runDir, "evidence");
  if (existsSync(evidenceRoot)) {
    removeTree(join(evidenceRoot, ".speculative"));
    for (const entry of readdirSync(evidenceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^epoch-\d+$/.test(entry.name)) continue;
      const epochId = Number(entry.name.slice("epoch-".length));
      const epochPath = join(evidenceRoot, entry.name);
      if (epochId > lastCommittedEpoch) {
        removeTree(epochPath);
      }
    }
  }

  truncateFhvExecutionWalToJournalAuthoritativeCommit({
    walPath: join(runDir, "execution.wal.ndjson"),
    lastCommittedEpoch: journal.lastCommittedEpoch,
    lastCommittedCycle: journal.lastCommittedCycle,
    lastEpochCommitDigest: journal.lastEpochCommitDigest,
  });

  return {
    lastCommittedEpoch: journal.lastCommittedEpoch,
    lastCommittedCycle: journal.lastCommittedCycle,
    lastEpochCommitDigest: journal.lastEpochCommitDigest,
  };
}

export function cleanupFhvEpochEvidenceGenerations(input: {
  runDir: string;
  epochId: number;
  keepGeneration: number;
}): void {
  const epochPath = join(input.runDir, "evidence", `epoch-${input.epochId}`);
  if (!existsSync(epochPath) || !statSync(epochPath).isDirectory()) {
    throw new FhvTwoPhaseRecoveryError(
      "FHV_EVIDENCE_CLEANUP_REQUIRED_EPOCH_MISSING",
      `required canonical evidence missing for epoch ${input.epochId}`,
    );
  }
  const keepName = `generation-${input.keepGeneration}`;
  let kept = false;
  for (const child of readdirSync(epochPath, { withFileTypes: true })) {
    if (!child.isDirectory() || !child.name.startsWith("generation-")) continue;
    if (child.name === keepName) {
      kept = true;
      continue;
    }
    removeTree(join(epochPath, child.name));
  }
  const required = resolveFhvEpochEvidenceSegmentDir(
    input.runDir,
    input.epochId,
    input.keepGeneration,
  );
  if (!kept || !existsSync(required)) {
    throw new FhvTwoPhaseRecoveryError(
      "FHV_EVIDENCE_CLEANUP_REQUIRED_EPOCH_MISSING",
      `required canonical evidence missing: ${required}`,
    );
  }
}
