import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { existsSync, statSync } from "node:fs";

export class FhvWalTruncateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvWalTruncateError";
  }
}

export type FhvWalCheckpointTruncateRow = Readonly<{
  busy: number;
  log: number;
  checkpointed: number;
}>;

function fail(code: string, message: string): never {
  throw new FhvWalTruncateError(code, message);
}

function asNonNegativeInt(value: unknown, field: string, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(code, `wal_checkpoint(TRUNCATE) ${field} is not a non-negative integer: ${String(value)}`);
  }
  return value;
}

/**
 * Parse the better-sqlite3 `pragma("wal_checkpoint(TRUNCATE)")` result.
 * Production requires exactly one row `{ busy, log, checkpointed }`.
 */
export function parseWalCheckpointTruncateResult(result: unknown): FhvWalCheckpointTruncateRow {
  const rows = Array.isArray(result) ? result : result == null ? [] : [result];
  if (rows.length !== 1) {
    fail(
      "FHV_WAL_TRUNCATE_RESULT_MISSING",
      `wal_checkpoint(TRUNCATE) returned ${rows.length} rows; expected exactly 1`,
    );
  }
  const row = rows[0] as Record<string, unknown> | null;
  if (row == null || typeof row !== "object") {
    fail("FHV_WAL_TRUNCATE_RESULT_MISSING", "wal_checkpoint(TRUNCATE) row is missing");
  }
  if (!("busy" in row) || !("log" in row) || !("checkpointed" in row)) {
    fail("FHV_WAL_TRUNCATE_NOT_WAL", "wal_checkpoint(TRUNCATE) result is not a WAL checkpoint row");
  }
  const busy = asNonNegativeInt(row.busy, "busy", "FHV_WAL_TRUNCATE_NOT_WAL");
  const log = asNonNegativeInt(row.log, "log", "FHV_WAL_TRUNCATE_NOT_WAL");
  const checkpointed = asNonNegativeInt(
    row.checkpointed,
    "checkpointed",
    "FHV_WAL_TRUNCATE_NOT_WAL",
  );
  return { busy, log, checkpointed };
}

export function assertWalCheckpointTruncateSucceeded(
  row: FhvWalCheckpointTruncateRow,
  sqliteName: string,
): void {
  if (row.busy !== 0) {
    fail("FHV_WAL_TRUNCATE_BUSY", `wal_checkpoint(TRUNCATE) busy=${row.busy}`);
  }
  if (row.checkpointed !== row.log) {
    fail(
      "FHV_WAL_TRUNCATE_INCOMPLETE",
      `wal_checkpoint(TRUNCATE) incomplete: checkpointed=${row.checkpointed} log=${row.log}`,
    );
  }
  const walPath = `${sqliteName}-wal`;
  if (existsSync(walPath)) {
    const size = statSync(walPath).size;
    if (size !== 0) {
      fail(
        "FHV_WAL_TRUNCATE_WAL_NOT_EMPTY",
        `WAL file still has ${size} bytes after TRUNCATE: ${walPath}`,
      );
    }
  }
}

/**
 * Fail-closed SQLite WAL TRUNCATE barrier. Must run before any clone or provisional snapshot.
 * Does not catch or downgrade failures.
 */
export function assertSqliteWalTruncated(input: {
  sqliteName: string;
  pragmaResult: unknown;
}): FhvWalCheckpointTruncateRow {
  const row = parseWalCheckpointTruncateResult(input.pragmaResult);
  assertWalCheckpointTruncateSucceeded(row, input.sqliteName);
  return row;
}
