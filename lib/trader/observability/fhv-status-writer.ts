import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import { FHV_OPERATOR_STATUS_WRITE_INTERVAL_MS } from "@/lib/trader/observability/fhv-observability.constants";
import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";

export const FHV_OPERATOR_STATUS_FILENAME = "fhv-operator-status.v1.json";

export function resolveFhvOperatorStatusPath(runRoot: string): string {
  return join(runRoot, "status", FHV_OPERATOR_STATUS_FILENAME);
}

export function writeFhvOperatorStatusAtomic(runRoot: string, status: FhvOperatorStatusV1): void {
  const path = resolveFhvOperatorStatusPath(runRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(status, null, 2)}\n`);
}

export function readFhvOperatorStatusWithRetry(filePath: string): FhvOperatorStatusV1 | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as FhvOperatorStatusV1;
  } catch {
    return null;
  }
}

export function readFhvOperatorStatusTolerant(runRoot: string): FhvOperatorStatusV1 | null {
  const path = resolveFhvOperatorStatusPath(runRoot);
  const first = readFhvOperatorStatusWithRetry(path);
  if (first) {
    return first;
  }
  return null;
}

export function statFhvOperatorStatusMtime(runRoot: string): number | null {
  try {
    return statSync(resolveFhvOperatorStatusPath(runRoot)).mtimeMs;
  } catch {
    return null;
  }
}

export type FhvStatusWriterThrottle = {
  lastWriteMs: number;
  minIntervalMs: number;
};

export function createFhvStatusWriterThrottle(
  minIntervalMs = FHV_OPERATOR_STATUS_WRITE_INTERVAL_MS,
): {
  state: FhvStatusWriterThrottle;
  shouldWrite: (nowMs: number) => boolean;
  markWritten: (nowMs: number) => void;
} {
  const state: FhvStatusWriterThrottle = { lastWriteMs: 0, minIntervalMs };
  return {
    state,
    shouldWrite(nowMs: number) {
      return nowMs - state.lastWriteMs >= state.minIntervalMs;
    },
    markWritten(nowMs: number) {
      state.lastWriteMs = nowMs;
    },
  };
}

export function buildAndWriteFhvOperatorStatus(
  runRoot: string,
  input: Parameters<typeof buildFhvOperatorStatusV1>[0],
): FhvOperatorStatusV1 {
  const status = buildFhvOperatorStatusV1(input);
  writeFhvOperatorStatusAtomic(runRoot, status);
  return status;
}
