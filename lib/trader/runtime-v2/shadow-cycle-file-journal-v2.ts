import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  claimFileExclusiveLock,
  releaseFileExclusiveLock,
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import type {
  ShadowCycleRecordV2,
  ShadowCycleStoreV2,
} from "@/lib/trader/runtime-v2/shadow-canonical-cycle-v2";

const JOURNAL_NAME = "shadow-cycle-journal-v2.jsonl";

export function assertShadowJournalOutsideCheckpointTree(directory: string): void {
  const segments = directory.split(/[/\\]+/);
  if (segments.some((segment) => segment === "checkpoint" || segment === "checkpoints")) {
    throw new Error("SHADOW_JOURNAL_INSIDE_CHECKPOINT_TREE");
  }
}

function isRecord(value: unknown): value is ShadowCycleRecordV2 {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ShadowCycleRecordV2>;
  return (
    typeof record.barKey === "string" &&
    (record.status === "NO_TRADE" || record.status === "EXECUTION_BOUND") &&
    (record.stage === null ||
      record.stage === "EPISTEMIC" ||
      record.stage === "ADMISSION" ||
      record.stage === "FORECAST" ||
      record.stage === "DECISION" ||
      record.stage === "RISK") &&
    Array.isArray(record.reasonCodes) &&
    record.reasonCodes.every((code) => typeof code === "string")
  );
}

function readJournal(journalPath: string): { text: string; records: ShadowCycleRecordV2[] } {
  if (!existsSync(journalPath)) return { text: "", records: [] };
  const text = readFileSync(journalPath, "utf8");
  const records = text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new Error("SHADOW_JOURNAL_RECORD_INVALID");
      return parsed;
    });
  return { text, records };
}

export function createFileShadowCycleStore(directory: string): ShadowCycleStoreV2 {
  assertShadowJournalOutsideCheckpointTree(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const journalPath = join(directory, JOURNAL_NAME);
  const lockPath = join(directory, ".shadow-cycle-journal.lock");

  const withLock = async <T>(body: () => T): Promise<T> => {
    const fd = claimFileExclusiveLock(lockPath);
    try {
      return body();
    } finally {
      releaseFileExclusiveLock(lockPath, fd);
    }
  };

  return {
    async get(barKey) {
      return withLock(
        () => readJournal(journalPath).records.find((record) => record.barKey === barKey) ?? null,
      );
    },
    async putIfAbsent(record) {
      return withLock(() => {
        const current = readJournal(journalPath);
        const existing = current.records.find((saved) => saved.barKey === record.barKey);
        if (existing) return existing;
        const frozen: ShadowCycleRecordV2 = Object.freeze({
          barKey: record.barKey,
          status: record.status,
          stage: record.stage,
          reasonCodes: Object.freeze([...record.reasonCodes]),
        });
        const line = `${JSON.stringify(frozen)}\n`;
        if (!existsSync(journalPath)) {
          writeFileAtomicExclusive(journalPath, line);
        } else {
          writeFileAtomicCompareAndReplace({
            finalPath: journalPath,
            expectedContent: current.text,
            nextContent: `${current.text}${line}`,
          });
        }
        chmodSync(journalPath, 0o600);
        return frozen;
      });
    },
  };
}
