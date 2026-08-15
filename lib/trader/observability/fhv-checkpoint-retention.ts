import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FHV_CHECKPOINT_MANIFEST_FILENAME } from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import { isCanonicalFhvEpochCheckpointDirName } from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import { readFhvLaunchJournal } from "@/lib/trader/observability/fhv-launch-journal";

/**
 * Retain the two newest journal-authoritative checkpoint bundles.
 * Provisional and orphan canonical dirs (epoch > journal) never count.
 */
export function pruneFhvCheckpointBundlesToTwoNewest(runDir: string): {
  retainedEpochIds: number[];
  summarizedEpochIds: number[];
} {
  const journal = existsSync(join(runDir, "fhv-launch-journal.v1.json"))
    ? readFhvLaunchJournal(runDir)
    : null;
  const lastCommittedEpoch = journal?.lastCommittedEpoch ?? -1;
  const checkpointsParent = join(runDir, "checkpoints");
  if (!existsSync(checkpointsParent) || lastCommittedEpoch < 0) {
    return { retainedEpochIds: [], summarizedEpochIds: [] };
  }
  const epochDirs = readdirSync(checkpointsParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isCanonicalFhvEpochCheckpointDirName(entry.name))
    .map((entry) => ({
      name: entry.name,
      epochId: Number(entry.name.slice("epoch-".length)),
    }))
    .filter((entry) => Number.isFinite(entry.epochId) && entry.epochId <= lastCommittedEpoch)
    .sort((a, b) => b.epochId - a.epochId);

  const retained = epochDirs.slice(0, 2);
  const toSummarize = epochDirs.slice(2);
  const summariesDir = join(checkpointsParent, "summaries");
  if (toSummarize.length > 0) {
    mkdirSync(summariesDir, { recursive: true });
  }

  const summarizedEpochIds: number[] = [];
  for (const entry of toSummarize) {
    const dir = join(checkpointsParent, entry.name);
    const manifestPath = join(dir, FHV_CHECKPOINT_MANIFEST_FILENAME);
    if (existsSync(manifestPath)) {
      const summaryPath = join(summariesDir, `${entry.name}.manifest.json`);
      writeFileSync(summaryPath, readFileSync(manifestPath));
    }
    rmSync(dir, { recursive: true, force: true });
    summarizedEpochIds.push(entry.epochId);
  }

  return {
    retainedEpochIds: retained.map((entry) => entry.epochId),
    summarizedEpochIds,
  };
}
