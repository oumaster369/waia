import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

import {
  claimFileExclusiveLock,
  releaseFileExclusiveLock,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import type {
  ShadowCycleRecordV2,
  ShadowCycleStoreV2,
} from "@/lib/trader/runtime-v2/shadow-canonical-cycle-v2";

const JOURNAL_NAME = "shadow-cycle-journal-v2.jsonl";
export const SHADOW_JOURNAL_CHECKPOINT_ROOT_ENV = "WAIA_FHV_CHECKPOINT_ROOT";

function fsyncDirectory(directory: string): void {
  if (process.platform === "linux") {
    const dirFd = openSync(directory, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    return;
  }
  try {
    const dirFd = openSync(directory, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Non-Linux dev platforms may lack directory-fsync support.
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

function parseJournalText(text: string): ShadowCycleRecordV2[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new Error("SHADOW_JOURNAL_RECORD_INVALID");
      return parsed;
    });
}

function sealKeyInDirectoryOrAncestor(directory: string): boolean {
  let current = resolve(directory);
  const root = parse(current).root;
  while (true) {
    if (existsSync(join(current, ".seal-key"))) return true;
    if (current === root) return false;
    current = dirname(current);
  }
}

function isInsideEnvCheckpointRoot(directory: string): boolean {
  const checkpointRoot = process.env[SHADOW_JOURNAL_CHECKPOINT_ROOT_ENV];
  if (!checkpointRoot?.trim()) return false;
  const journal = resolve(directory);
  const checkpoint = resolve(checkpointRoot);
  const fromRoot = relative(checkpoint, journal);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

export function assertShadowJournalOutsideCheckpointTree(directory: string): void {
  if (sealKeyInDirectoryOrAncestor(directory)) {
    throw new Error("SHADOW_JOURNAL_SEAL_KEY_ANCESTOR");
  }
  if (isInsideEnvCheckpointRoot(directory)) {
    throw new Error("SHADOW_JOURNAL_INSIDE_CHECKPOINT_ROOT");
  }
}

export function createFileShadowCycleStore(directory: string): ShadowCycleStoreV2 {
  assertShadowJournalOutsideCheckpointTree(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const journalPath = join(directory, JOURNAL_NAME);
  const lockPath = join(directory, ".shadow-cycle-journal.lock");
  const index = new Map<string, ShadowCycleRecordV2>();
  let syncedBytes = 0;
  if (existsSync(journalPath)) {
    const text = readFileSync(journalPath, "utf8");
    syncedBytes = Buffer.byteLength(text);
    for (const record of parseJournalText(text)) index.set(record.barKey, record);
  }

  const absorbTail = (): void => {
    if (!existsSync(journalPath)) return;
    const size = statSync(journalPath).size;
    if (size <= syncedBytes) return;
    const length = size - syncedBytes;
    const buffer = Buffer.alloc(length);
    const fd = openSync(journalPath, "r");
    try {
      readSync(fd, buffer, 0, length, syncedBytes);
    } finally {
      closeSync(fd);
    }
    for (const record of parseJournalText(buffer.toString("utf8"))) {
      index.set(record.barKey, record);
    }
    syncedBytes = size;
  };

  return {
    async get(barKey) {
      return index.get(barKey) ?? null;
    },
    async putIfAbsent(record) {
      const lockFd = claimFileExclusiveLock(lockPath);
      try {
        absorbTail();
        const existing = index.get(record.barKey);
        if (existing) return existing;
        const frozen: ShadowCycleRecordV2 = Object.freeze({
          barKey: record.barKey,
          status: record.status,
          stage: record.stage,
          reasonCodes: Object.freeze([...record.reasonCodes]),
        });
        const line = `${JSON.stringify(frozen)}\n`;
        appendFileSync(journalPath, line, { mode: 0o600 });
        const fd = openSync(journalPath, "r+");
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        fsyncDirectory(directory);
        chmodSync(journalPath, 0o600);
        syncedBytes += Buffer.byteLength(line);
        index.set(record.barKey, frozen);
        return frozen;
      } finally {
        releaseFileExclusiveLock(lockPath, lockFd);
      }
    },
  };
}
