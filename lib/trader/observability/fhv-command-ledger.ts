import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import type { FhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";

export type FhvCommandLedgerEntry = Readonly<{
  recordedAtUtc: string;
  command: FhvOperatorCommandV1;
  source: "worker_tunnel" | "local_break_glass" | "test";
}>;

export type FhvCommandResultV1 = Readonly<{
  schemaVersion: "fhv-command-result/v1";
  commandId: string;
  idempotencyKey: string;
  status: "accepted" | "rejected" | "duplicate";
  message: string;
  completedAtUtc: string;
}>;

export function resolveFhvCommandLedgerPath(runRoot: string): string {
  return join(runRoot, "control", "command-ledger.jsonl");
}

export function resolveFhvCommandResultPath(runRoot: string, commandId: string): string {
  return join(runRoot, "control", "command-results", `${commandId}.json`);
}

export function appendFhvCommandLedger(runRoot: string, entry: FhvCommandLedgerEntry): void {
  const ledgerPath = resolveFhvCommandLedgerPath(runRoot);
  mkdirSync(join(runRoot, "control"), { recursive: true });
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function writeFhvCommandResult(runRoot: string, result: FhvCommandResultV1): void {
  const resultDir = join(runRoot, "control", "command-results");
  mkdirSync(resultDir, { recursive: true });
  writeFileAtomic(
    resolveFhvCommandResultPath(runRoot, result.commandId),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

export function readFhvCommandResult(
  runRoot: string,
  commandId: string,
): FhvCommandResultV1 | null {
  const path = resolveFhvCommandResultPath(runRoot, commandId);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvCommandResultV1;
}

export function loadFhvCommandLedgerNonces(runRoot: string): {
  nonces: Set<string>;
  idempotencyKeys: Set<string>;
} {
  const nonces = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const ledgerPath = resolveFhvCommandLedgerPath(runRoot);
  if (!existsSync(ledgerPath)) {
    return { nonces, idempotencyKeys };
  }
  for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as FhvCommandLedgerEntry;
    nonces.add(entry.command.nonce);
    idempotencyKeys.add(entry.command.idempotencyKey);
  }
  return { nonces, idempotencyKeys };
}

export function findFhvCommandResultByIdempotencyKey(
  runRoot: string,
  idempotencyKey: string,
): FhvCommandResultV1 | null {
  const ledgerPath = resolveFhvCommandLedgerPath(runRoot);
  if (!existsSync(ledgerPath)) {
    return null;
  }
  for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as FhvCommandLedgerEntry;
    if (entry.command.idempotencyKey === idempotencyKey) {
      return readFhvCommandResult(runRoot, entry.command.commandId);
    }
  }
  return null;
}
