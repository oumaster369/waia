import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type postgres from "postgres";

/** Stage markers for PHASE-01 measurement — diagnostics are stage-aware. */
export type A3Phase01Stage =
  | "BOOTSTRAP"
  | "INSERT_FIXED_PACKAGE"
  | "POPULATING_BUNDLES"
  | "VACUUM_ANALYZE"
  | "CHECKPOINT"
  | "MEASURING_B1"
  | "WRITING_RECEIPT";

export const A3_PHASE01_PROGRESS_SCHEMA_VERSION = "a3-phase01-progress/v1" as const;

const BUNDLE_INSERT_STALL_MS = 10 * 60 * 1000;
const BUNDLE_INSERT_POLL_MS = 60 * 1000;
const LOCK_DIAGNOSTIC_THRESHOLD_MS = 30_000;

type ActivityRow = {
  pid: string;
  state: string;
  wait_event_type: string | null;
  wait_event: string | null;
  duration_ms: string;
  query: string;
};

export type A3Phase01PgDiagnosticSnapshotV1 = {
  capturedAtUtc: string;
  activeBulkInsert: boolean;
  lockWaitRows: string[];
  ioWaitRows: string[];
  activeQueryAgeMsMax: number | null;
  note: string;
};

export type A3Phase01ProgressRecordV1 = {
  schemaVersion: typeof A3_PHASE01_PROGRESS_SCHEMA_VERSION;
  /** Explicitly non-authoritative — must never be treated as an A3 PASS receipt. */
  scientificEvidence: false;
  runId: string;
  shellPid: number | null;
  nodePid: number;
  parentPid: number | null;
  canonicalContractDigest: string;
  storageSurfaceDigest: string;
  phase01ImplementationDigest: string;
  stage: A3Phase01Stage | "TERMINAL";
  currentChunkIndex: number;
  targetChunkCount: number;
  committedBundleCount: number;
  lastChunkStartUtc: string | null;
  lastChunkCompleteUtc: string | null;
  lastMeaningfulProgressUtc: string;
  lastPgDiagnosticSnapshot: A3Phase01PgDiagnosticSnapshotV1 | null;
  terminationMarker: "RUNNING" | "NORMAL_COMPLETE" | "ABNORMAL_ABORT" | "FAILED";
};

export type A3Phase01DiagnosticContextV1 = {
  runId: string;
  canonicalContractDigest: string;
  storageSurfaceDigest: string;
  phase01ImplementationDigest: string;
  targetChunkCount: number;
  logPath?: string | null;
  progressDir?: string | null;
};

function formatActivityRow(row: ActivityRow): string {
  return `pid=${row.pid} state=${row.state} wait=${row.wait_event_type}/${row.wait_event} duration_ms=${row.duration_ms} query=${row.query}`;
}

function nowUtc(): string {
  return new Date().toISOString();
}

function resolveLogPath(explicit?: string | null): string | null {
  const fromEnv = process.env.A3_LOG_PATH?.trim();
  const path = explicit?.trim() || fromEnv || null;
  return path && path.length > 0 ? path : null;
}

/** Append-only diagnostic log — never part of storage semantic identity. */
export function appendA3DiagnosticLog(message: string, logPath?: string | null): void {
  const path = resolveLogPath(logPath);
  if (!path) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${nowUtc()} ${message}\n`, "utf8");
}

export function resolveA3Phase01ProgressPath(canonicalContractDigest: string): string {
  // Keep path layout aligned with a3EvidenceDirectory() without importing the contract
  // module (avoids circular digest/identity imports).
  return join("/tmp", "dee518-a3", canonicalContractDigest, "phase-01-progress.json");
}

/** Atomic replace of the non-authoritative progress JSON. */
export function writeA3Phase01ProgressRecordAtomic(
  record: A3Phase01ProgressRecordV1,
  progressPath?: string,
): string {
  const path = progressPath ?? resolveA3Phase01ProgressPath(record.canonicalContractDigest);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  return path;
}

export function createInitialA3Phase01ProgressRecord(
  ctx: A3Phase01DiagnosticContextV1,
): A3Phase01ProgressRecordV1 {
  const ts = nowUtc();
  return {
    schemaVersion: A3_PHASE01_PROGRESS_SCHEMA_VERSION,
    scientificEvidence: false,
    runId: ctx.runId,
    shellPid: process.ppid ?? null,
    nodePid: process.pid,
    parentPid: process.ppid ?? null,
    canonicalContractDigest: ctx.canonicalContractDigest,
    storageSurfaceDigest: ctx.storageSurfaceDigest,
    phase01ImplementationDigest: ctx.phase01ImplementationDigest,
    stage: "BOOTSTRAP",
    currentChunkIndex: 0,
    targetChunkCount: ctx.targetChunkCount,
    committedBundleCount: 0,
    lastChunkStartUtc: null,
    lastChunkCompleteUtc: null,
    lastMeaningfulProgressUtc: ts,
    lastPgDiagnosticSnapshot: null,
    terminationMarker: "RUNNING",
  };
}

/** Progress records are diagnostic-only and must never satisfy storage-scale PASS. */
export function assertProgressRecordIsNotScientificEvidence(
  record: A3Phase01ProgressRecordV1,
): void {
  if (record.scientificEvidence !== false) {
    throw new Error("[a3-phase01-progress] scientificEvidence must be false");
  }
  if (record.schemaVersion !== A3_PHASE01_PROGRESS_SCHEMA_VERSION) {
    throw new Error("[a3-phase01-progress] unexpected schemaVersion");
  }
}

export function advanceA3Phase01ChunkProgress(
  record: A3Phase01ProgressRecordV1,
  input: {
    chunkIndex: number;
    committedBundleCount: number;
    event: "START" | "COMMIT";
    pgSnapshot?: A3Phase01PgDiagnosticSnapshotV1 | null;
  },
): A3Phase01ProgressRecordV1 {
  const ts = nowUtc();
  if (input.event === "START") {
    return {
      ...record,
      stage: "POPULATING_BUNDLES",
      currentChunkIndex: input.chunkIndex,
      lastChunkStartUtc: ts,
      lastMeaningfulProgressUtc: ts,
      lastPgDiagnosticSnapshot: input.pgSnapshot ?? record.lastPgDiagnosticSnapshot,
      terminationMarker: "RUNNING",
    };
  }
  return {
    ...record,
    stage: "POPULATING_BUNDLES",
    currentChunkIndex: input.chunkIndex,
    committedBundleCount: input.committedBundleCount,
    lastChunkCompleteUtc: ts,
    lastMeaningfulProgressUtc: ts,
    lastPgDiagnosticSnapshot: input.pgSnapshot ?? record.lastPgDiagnosticSnapshot,
    terminationMarker: "RUNNING",
  };
}

/** Lock waits only — IO/DataFilePrefetch/DataFileRead are healthy during bulk INSERT. */
export async function collectPostgresBlockingLockDiagnostics(
  sql: postgres.Sql,
  thresholdMs: number,
): Promise<string[]> {
  const rows = await sql<ActivityRow[]>`
    SELECT
      pid::text,
      state,
      wait_event_type,
      wait_event,
      (EXTRACT(EPOCH FROM (now() - query_start)) * 1000)::text AS duration_ms,
      left(query, 200) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
      AND wait_event_type = 'Lock'
      AND (EXTRACT(EPOCH FROM (now() - query_start)) * 1000) >= ${thresholdMs}
  `;
  return rows.map(formatActivityRow);
}

async function collectIoWaitDiagnostics(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<ActivityRow[]>`
    SELECT
      pid::text,
      state,
      wait_event_type,
      wait_event,
      (EXTRACT(EPOCH FROM (now() - query_start)) * 1000)::text AS duration_ms,
      left(query, 200) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
      AND wait_event_type = 'IO'
      AND wait_event IN ('DataFileRead', 'DataFilePrefetch')
  `;
  return rows.map(formatActivityRow);
}

async function readBlockingLockDiagnostics(sql: postgres.Sql): Promise<string[]> {
  return collectPostgresBlockingLockDiagnostics(sql, LOCK_DIAGNOSTIC_THRESHOLD_MS);
}

async function hasActiveBulkBundleInsert(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND query ILIKE '%inserted_bundles%'
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function maxActiveQueryAgeMs(sql: postgres.Sql): Promise<number | null> {
  const rows = await sql<{ max_ms: string | null }[]>`
    SELECT max(EXTRACT(EPOCH FROM (now() - query_start)) * 1000)::text AS max_ms
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state = 'active'
      AND query ILIKE '%inserted_bundles%'
  `;
  const raw = rows[0]?.max_ms;
  if (raw == null) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function hasActiveVacuum(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND query ILIKE 'VACUUM%'
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function hasActiveCheckpoint(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND query ILIKE 'CHECKPOINT%'
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function captureA3Phase01PgDiagnosticSnapshot(
  sql: postgres.Sql,
): Promise<A3Phase01PgDiagnosticSnapshotV1> {
  const activeBulkInsert = await hasActiveBulkBundleInsert(sql);
  const lockWaitRows = await readBlockingLockDiagnostics(sql);
  const ioWaitRows = await collectIoWaitDiagnostics(sql);
  const activeQueryAgeMsMax = await maxActiveQueryAgeMs(sql);
  let note = "healthy_or_idle";
  if (lockWaitRows.length > 0) {
    note = "lock_wait_present";
  } else if (activeBulkInsert) {
    note =
      ioWaitRows.length > 0
        ? "active_insert_with_io_wait_diagnostic_only"
        : "active_insert_cpu_or_running";
  } else if (ioWaitRows.length > 0) {
    note = "io_wait_without_active_insert_diagnostic_only";
  } else {
    note = "no_active_bulk_insert";
  }
  return {
    capturedAtUtc: nowUtc(),
    activeBulkInsert,
    lockWaitRows,
    ioWaitRows,
    activeQueryAgeMsMax,
    note,
  };
}

export type WaitForBulkBundleInsertContext = {
  startIndex: number;
  chunkCount: number;
  chunkIndex: number;
  diagnostic?: A3Phase01DiagnosticContextV1 | null;
  onProgress?: (record: A3Phase01ProgressRecordV1) => void;
  progressRecord?: A3Phase01ProgressRecordV1 | null;
};

/**
 * Poll until bulk bundle INSERT completes. During POPULATING_BUNDLES only Lock waits
 * fail closed; long IO prefetch/read / long-running active INSERT is healthy.
 */
export async function waitForBulkBundleInsertWithProgress(
  sql: postgres.Sql,
  insertPromise: Promise<void>,
  context: WaitForBulkBundleInsertContext,
): Promise<void> {
  const started = Date.now();
  const logPath = context.diagnostic?.logPath;
  appendA3DiagnosticLog(
    `[POPULATING_BUNDLES] CHUNK_START index=${context.chunkIndex} offset=${context.startIndex} count=${context.chunkCount}`,
    logPath,
  );

  let progress = context.progressRecord ?? null;
  if (progress && context.diagnostic) {
    progress = advanceA3Phase01ChunkProgress(progress, {
      chunkIndex: context.chunkIndex,
      committedBundleCount: progress.committedBundleCount,
      event: "START",
    });
    writeA3Phase01ProgressRecordAtomic(progress);
    context.onProgress?.(progress);
  }

  while (true) {
    const settled = await Promise.race([
      insertPromise.then(() => "done" as const),
      new Promise<"poll">((resolve) => setTimeout(() => resolve("poll"), BUNDLE_INSERT_POLL_MS)),
    ]);
    if (settled === "done") {
      appendA3DiagnosticLog(
        `[POPULATING_BUNDLES] CHUNK_COMMIT index=${context.chunkIndex} offset=${context.startIndex} count=${context.chunkCount}`,
        logPath,
      );
      return;
    }

    const snapshot = await captureA3Phase01PgDiagnosticSnapshot(sql);
    if (progress && context.diagnostic) {
      progress = {
        ...progress,
        lastPgDiagnosticSnapshot: snapshot,
        lastMeaningfulProgressUtc: snapshot.activeBulkInsert
          ? nowUtc()
          : progress.lastMeaningfulProgressUtc,
      };
      writeA3Phase01ProgressRecordAtomic(progress);
      context.onProgress?.(progress);
    }

    if (snapshot.lockWaitRows.length > 0) {
      appendA3DiagnosticLog(
        `[POPULATING_BUNDLES] LOCK_WAIT blockers=${snapshot.lockWaitRows.join(" | ")}`,
        logPath,
      );
      throw new Error(
        `[forecast-v2/storage-scale] POPULATING_BUNDLES lock blocked: ${snapshot.lockWaitRows.join(" | ")}`,
      );
    }

    if (snapshot.activeBulkInsert) {
      // Healthy long-running INSERT — emit periodic diagnostics; do not fail on query age.
      appendA3DiagnosticLog(
        `[POPULATING_BUNDLES] ACTIVE_INSERT age_ms=${snapshot.activeQueryAgeMsMax ?? "n/a"} io=${snapshot.ioWaitRows.length} note=${snapshot.note}`,
        logPath,
      );
      continue;
    }

    appendA3DiagnosticLog(
      `[POPULATING_BUNDLES] NO_ACTIVE_INSERT elapsed_ms=${Date.now() - started} note=${snapshot.note}`,
      logPath,
    );

    if (Date.now() - started >= BUNDLE_INSERT_STALL_MS) {
      throw new Error(
        `[forecast-v2/storage-scale] POPULATING_BUNDLES stall: no active bulk insert for ${BUNDLE_INSERT_STALL_MS}ms at offset ${context.startIndex} count=${context.chunkCount}`,
      );
    }
  }
}

/** Stage-specific health checks outside POPULATING_BUNDLES. */
export async function assertA3Phase01StageHealthy(
  sql: postgres.Sql,
  stage: A3Phase01Stage,
): Promise<void> {
  const lockDiagnostics = await readBlockingLockDiagnostics(sql);
  if (lockDiagnostics.length > 0) {
    throw new Error(
      `[forecast-v2/storage-scale] ${stage} lock blocked: ${lockDiagnostics.join(" | ")}`,
    );
  }

  switch (stage) {
    case "VACUUM_ANALYZE":
      if (!(await hasActiveVacuum(sql))) {
        return;
      }
      return;
    case "CHECKPOINT":
      if (!(await hasActiveCheckpoint(sql))) {
        return;
      }
      return;
    case "BOOTSTRAP":
    case "INSERT_FIXED_PACKAGE":
    case "MEASURING_B1":
    case "WRITING_RECEIPT":
    case "POPULATING_BUNDLES":
      return;
    default: {
      const exhaustive: never = stage;
      throw new Error(`[forecast-v2/storage-scale] unknown stage ${exhaustive}`);
    }
  }
}

export function markA3Phase01ProgressTerminal(
  record: A3Phase01ProgressRecordV1,
  marker: "NORMAL_COMPLETE" | "ABNORMAL_ABORT" | "FAILED",
  stage: A3Phase01Stage | "TERMINAL" = "TERMINAL",
): A3Phase01ProgressRecordV1 {
  const ts = nowUtc();
  return {
    ...record,
    stage,
    lastMeaningfulProgressUtc: ts,
    terminationMarker: marker,
  };
}
