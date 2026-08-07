import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const FHV_LAUNCH_JOURNAL_SCHEMA_VERSION = "fhv-launch-journal/v1" as const;

export type FhvLaunchJournalV1 = Readonly<{
  schemaVersion: typeof FHV_LAUNCH_JOURNAL_SCHEMA_VERSION;
  runId: string;
  lastCommittedEpoch: number;
  lastCommittedCycle: number;
  lastEpochCommitDigest: string;
  walPath: string;
  journalDigest: string;
}>;

export class FhvLaunchJournalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvLaunchJournalError";
  }
}

function computeJournalDigest(journal: Omit<FhvLaunchJournalV1, "journalDigest">): string {
  return computeStableJsonDigest(journal);
}

export function buildFhvLaunchJournal(input: {
  runId: string;
  walPath: string;
}): FhvLaunchJournalV1 {
  const body: Omit<FhvLaunchJournalV1, "journalDigest"> = {
    schemaVersion: FHV_LAUNCH_JOURNAL_SCHEMA_VERSION,
    runId: input.runId,
    lastCommittedEpoch: -1,
    lastCommittedCycle: -1,
    lastEpochCommitDigest: "0".repeat(64),
    walPath: input.walPath,
  };
  return { ...body, journalDigest: computeJournalDigest(body) };
}

export function writeFhvLaunchJournalAtomic(runRoot: string, journal: FhvLaunchJournalV1): string {
  mkdirSync(runRoot, { recursive: true });
  const path = join(runRoot, "fhv-launch-journal.v1.json");
  if (existsSync(path)) {
    throw new FhvLaunchJournalError("JOURNAL_EXISTS", "launch journal already exists");
  }
  writeFileAtomicExclusive(path, `${JSON.stringify(journal, null, 2)}\n`);
  return path;
}

export function readFhvLaunchJournal(runRoot: string): FhvLaunchJournalV1 {
  const path = join(runRoot, "fhv-launch-journal.v1.json");
  if (!existsSync(path)) {
    throw new FhvLaunchJournalError("JOURNAL_MISSING", "launch journal missing");
  }
  const journal = JSON.parse(readFileSync(path, "utf8")) as FhvLaunchJournalV1;
  const { journalDigest, ...body } = journal;
  if (computeJournalDigest(body) !== journalDigest) {
    throw new FhvLaunchJournalError("JOURNAL_DIGEST_MISMATCH", "launch journal digest mismatch");
  }
  return journal;
}

export function advanceFhvLaunchJournalAtomic(input: {
  runRoot: string;
  lastCommittedEpoch: number;
  lastCommittedCycle: number;
  lastEpochCommitDigest: string;
}): FhvLaunchJournalV1 {
  const path = join(input.runRoot, "fhv-launch-journal.v1.json");
  const expectedContent = readFileSync(path, "utf8");
  const existing = JSON.parse(expectedContent) as FhvLaunchJournalV1;
  const { journalDigest: _previousDigest, ...existingBody } = existing;
  const nextBody: Omit<FhvLaunchJournalV1, "journalDigest"> = {
    ...existingBody,
    lastCommittedEpoch: input.lastCommittedEpoch,
    lastCommittedCycle: input.lastCommittedCycle,
    lastEpochCommitDigest: input.lastEpochCommitDigest,
  };
  const next: FhvLaunchJournalV1 = {
    ...nextBody,
    journalDigest: computeJournalDigest(nextBody),
  };
  const nextContent = `${JSON.stringify(next, null, 2)}\n`;
  writeFileAtomicCompareAndReplace({
    finalPath: path,
    expectedContent,
    nextContent,
  });
  return next;
}

export function advanceFhvLaunchJournal(input: {
  runRoot: string;
  lastCommittedEpoch: number;
  lastCommittedCycle: number;
  lastEpochCommitDigest: string;
}): FhvLaunchJournalV1 {
  return advanceFhvLaunchJournalAtomic(input);
}

export function rebuildFhvLaunchJournalFromEpochCommit(input: {
  runRoot: string;
  epochCommit: {
    lastCycle: number;
    epochCommitDigest: string;
  };
  epochId: number;
}): FhvLaunchJournalV1 {
  return advanceFhvLaunchJournal({
    runRoot: input.runRoot,
    lastCommittedEpoch: input.epochId,
    lastCommittedCycle: input.epochCommit.lastCycle,
    lastEpochCommitDigest: input.epochCommit.epochCommitDigest,
  });
}
