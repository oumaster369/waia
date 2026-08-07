import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  resolveFhvDatasetManifestV2Path,
  resolveFhvDatasetSealReceiptV2Path,
  type FhvDatasetManifestV2,
  type FhvDatasetSealReceiptV2,
} from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";

/**
 * Managed FHV temporary dataset roots (WP-0 lifecycle closure).
 *
 * FHV helpers previously materialized complete official-scale corpora under TMPDIR with
 * `mkdtempSync` and no teardown, no identity and no reuse. Every invocation rebuilt ~1.7 GB.
 * This registry owns the full lifecycle: disk preflight, identity-keyed reuse, per-run
 * ownership, bounded preserve-on-failure, stale recovery and identity-based sweeping.
 */

export const FHV_TEMP_DATASET_IDENTITY_SCHEMA = "fhv-dataset-temp-identity/v1" as const;
export const FHV_TEMP_ROOT_LOCK_SCHEMA = "fhv-temp-root-lock/v1" as const;

export const FHV_TEMP_DATASET_IDENTITY_FILENAME = ".fhv-dataset-identity.v1.json";
export const FHV_TEMP_ROOT_LOCK_FILENAME = ".fhv-temp-root-lock.v1.json";

/** Every helper prefix that materializes an official-scale corpus under TMPDIR. */
export const FHV_MANAGED_TEMP_PREFIXES = [
  "fhv-official-scale-dataset-",
  "fhv-source-frontier-v2-",
  "fhv-cursor-restore-v2-",
] as const;

/** Local free-space floor before any dataset materialization (plan §G). */
export const FHV_LOCAL_MIN_FREE_BYTES = 30_000_000_000;

/** Bounded preserve-on-failure: newest N failed roots only. */
export const FHV_PRESERVED_FAILURE_ROOT_LIMIT = 1;

/** Bounded evidence retention: total bytes across preserved failure roots. */
export const FHV_PRESERVED_FAILURE_TOTAL_BYTES_LIMIT = 8_000_000_000;

/** A root is only sweepable once older than this. */
export const FHV_STALE_TEMP_MIN_AGE_MS = 21_600_000;

/** A lock newer than this is treated as an active run even if the pid is unknown. */
export const FHV_TEMP_ROOT_LOCK_FRESH_MS = 900_000;

export type FhvTempDatasetIdentityV1 = Readonly<{
  schemaVersion: typeof FHV_TEMP_DATASET_IDENTITY_SCHEMA;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  sourceLogicalDatasetDigest: string;
  holdoutSealDigest: string;
  /** Event-specific (embeds `sealedAtUtc`) — never a stable identity on its own. */
  sealReceiptDigest: string;
  releaseSha: string;
  qualificationMode: string;
  totalBars: number;
  builtBy: string;
  builtAtUtc: string;
}>;

export type FhvTempRootOutcome = "ACTIVE" | "PRESERVED_FAILURE";

export type FhvTempRootLockV1 = Readonly<{
  schemaVersion: typeof FHV_TEMP_ROOT_LOCK_SCHEMA;
  pid: number;
  startedAtUtc: string;
  prefix: string;
  outcome: FhvTempRootOutcome;
  /** Set when the root transitions to PRESERVED_FAILURE; orders bounded retention. */
  preservedAtUtc?: string;
}>;

export type FhvManagedTempRoot = Readonly<{
  path: string;
  prefix: string;
  lock: FhvTempRootLockV1 | null;
  identity: FhvTempDatasetIdentityV1 | null;
  modifiedAtMs: number;
}>;

export type FhvTempRootSweepDisposition =
  | "RETAIN_ACTIVE"
  | "RETAIN_NEWEST_FOR_DIGEST"
  | "RETAIN_UNMATCHED"
  | "RETAIN_PRESERVED_FAILURE"
  | "RETAIN_TOO_RECENT"
  | "DELETE_DUPLICATE_IDENTITY";

export type FhvTempRootSweepEntry = Readonly<{
  path: string;
  prefix: string;
  disposition: FhvTempRootSweepDisposition;
  datasetContentDigest: string | null;
  reason: string;
}>;

export type FhvTempRootSweepPlan = Readonly<{
  entries: readonly FhvTempRootSweepEntry[];
  deletable: readonly string[];
}>;

export type FhvTempRootRegistryOptions = Readonly<{
  /** Override the scan/creation root. Defaults to `os.tmpdir()`. Used by tests. */
  tempRootDir?: string;
  /** Injectable clock for deterministic tests. */
  nowMs?: number;
  /** Injectable liveness probe for deterministic tests. */
  isPidAlive?: (pid: number) => boolean;
}>;

function resolveTempRootDir(options?: FhvTempRootRegistryOptions): string {
  return options?.tempRootDir ?? tmpdir();
}

function resolveNowMs(options?: FhvTempRootRegistryOptions): number {
  return options?.nowMs ?? Date.now();
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function resolveIsPidAlive(options?: FhvTempRootRegistryOptions): (pid: number) => boolean {
  return options?.isPidAlive ?? defaultIsPidAlive;
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Disk preflight and execution-surface guards                                 */
/* -------------------------------------------------------------------------- */

export function measureFhvAvailableBytes(path: string): number {
  const stats = statfsSync(path);
  return Number(stats.bavail ?? stats.bfree) * Number(stats.bsize);
}

/**
 * Fail-closed local disk preflight. Materializing an official-scale corpus costs ~1.7 GB and
 * historically ran with no capacity check at all.
 */
export function assertFhvLocalDatasetDiskPreflight(
  options?: FhvTempRootRegistryOptions & { minFreeBytes?: number },
): { availableBytes: number; minFreeBytes: number } {
  const tempRootDir = resolveTempRootDir(options);
  mkdirSync(tempRootDir, { recursive: true });
  const minFreeBytes = options?.minFreeBytes ?? FHV_LOCAL_MIN_FREE_BYTES;
  const availableBytes = measureFhvAvailableBytes(tempRootDir);
  if (availableBytes < minFreeBytes) {
    throw new Error(
      `BLOCKED_BY_FHV_LOCAL_DISK_CAPACITY: availableBytes=${availableBytes} required=${minFreeBytes} tempRoot=${tempRootDir}`,
    );
  }
  return { availableBytes, minFreeBytes };
}

/**
 * Official full-corpus qualification is an Execution Server stage (plan OPTION_C).
 * It must never run on the Human Architect workstation.
 */
export function assertFhvOfficialFullCorpusExecutionSurface(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { surface: "GITHUB_ACTIONS" | "EXECUTION_SERVER" } {
  if (env.GITHUB_ACTIONS === "true" || env.CI === "true") {
    return { surface: "GITHUB_ACTIONS" };
  }
  if (env.FHV_OFFICIAL_EXECUTION_SURFACE === "EXECUTION_SERVER") {
    return { surface: "EXECUTION_SERVER" };
  }
  throw new Error(
    "BLOCKED_BY_FHV_OFFICIAL_FULL_CORPUS_WORKSTATION_PROHIBITION: official full-corpus " +
      "qualification runs only on the canonical CI runner or the approved Execution Server " +
      "(set FHV_OFFICIAL_EXECUTION_SURFACE=EXECUTION_SERVER on the authorized host).",
  );
}

/* -------------------------------------------------------------------------- */
/* Identity sidecar                                                            */
/* -------------------------------------------------------------------------- */

export function resolveFhvTempDatasetIdentityPath(datasetRoot: string): string {
  return join(datasetRoot, FHV_TEMP_DATASET_IDENTITY_FILENAME);
}

export function readFhvTempDatasetIdentity(datasetRoot: string): FhvTempDatasetIdentityV1 | null {
  const identity = readJsonFile<FhvTempDatasetIdentityV1>(
    resolveFhvTempDatasetIdentityPath(datasetRoot),
  );
  if (!identity || identity.schemaVersion !== FHV_TEMP_DATASET_IDENTITY_SCHEMA) {
    return null;
  }
  return identity.datasetContentDigest ? identity : null;
}

export function writeFhvTempDatasetIdentity(
  datasetRoot: string,
  identity: FhvTempDatasetIdentityV1,
): void {
  writeFileSync(
    resolveFhvTempDatasetIdentityPath(datasetRoot),
    `${JSON.stringify(identity, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Derive the stable identity sidecar from a sealed v2 dataset.
 *
 * Identity is the agreement of manifest + seal digests. `sealReceiptDigest` is recorded but is
 * event-specific (it embeds `sealedAtUtc`), so it is never used alone to classify duplicates.
 */
export function buildFhvTempDatasetIdentityFromSealedDataset(
  datasetRoot: string,
  input: { builtBy: string; qualificationMode?: string; totalBars?: number; builtAtUtc?: string },
): FhvTempDatasetIdentityV1 {
  const manifest = readJsonFile<FhvDatasetManifestV2>(resolveFhvDatasetManifestV2Path(datasetRoot));
  const seal = readJsonFile<FhvDatasetSealReceiptV2>(
    resolveFhvDatasetSealReceiptV2Path(datasetRoot),
  );
  if (!manifest || !seal) {
    throw new Error(
      `BLOCKED_BY_FHV_TEMP_DATASET_IDENTITY_UNAVAILABLE: datasetRoot=${datasetRoot} manifest=${manifest ? "present" : "missing"} seal=${seal ? "present" : "missing"}`,
    );
  }
  if (manifest.datasetContentDigest !== seal.datasetContentDigest) {
    throw new Error(
      `BLOCKED_BY_FHV_TEMP_DATASET_IDENTITY_MISMATCH: manifest=${manifest.datasetContentDigest} seal=${seal.datasetContentDigest}`,
    );
  }
  return {
    schemaVersion: FHV_TEMP_DATASET_IDENTITY_SCHEMA,
    datasetContentDigest: manifest.datasetContentDigest,
    manifestSemanticDigest: manifest.manifestSemanticDigest,
    sourceLogicalDatasetDigest: manifest.sourceLogicalDatasetDigest,
    holdoutSealDigest: manifest.holdoutSealDigest,
    sealReceiptDigest: seal.sealReceiptDigest,
    releaseSha: manifest.releaseSha,
    qualificationMode: input.qualificationMode ?? "OFFICIAL_MULTI_YEAR",
    totalBars: input.totalBars ?? FHV_OFFICIAL_TOTAL_BARS,
    builtBy: input.builtBy,
    builtAtUtc: input.builtAtUtc ?? new Date().toISOString(),
  };
}

/** Verify a sidecar still matches the on-disk dataset before reuse. */
export function fhvTempDatasetIdentityMatchesDataset(
  datasetRoot: string,
  identity: FhvTempDatasetIdentityV1,
): boolean {
  const manifest = readJsonFile<FhvDatasetManifestV2>(resolveFhvDatasetManifestV2Path(datasetRoot));
  const seal = readJsonFile<FhvDatasetSealReceiptV2>(
    resolveFhvDatasetSealReceiptV2Path(datasetRoot),
  );
  if (!manifest || !seal) {
    return false;
  }
  return (
    manifest.datasetContentDigest === identity.datasetContentDigest &&
    manifest.manifestSemanticDigest === identity.manifestSemanticDigest &&
    manifest.sourceLogicalDatasetDigest === identity.sourceLogicalDatasetDigest &&
    manifest.holdoutSealDigest === identity.holdoutSealDigest &&
    manifest.releaseSha === identity.releaseSha &&
    seal.datasetContentDigest === identity.datasetContentDigest &&
    seal.sealReceiptDigest === identity.sealReceiptDigest
  );
}

/* -------------------------------------------------------------------------- */
/* Ownership lock                                                              */
/* -------------------------------------------------------------------------- */

export function resolveFhvTempRootLockPath(datasetRoot: string): string {
  return join(datasetRoot, FHV_TEMP_ROOT_LOCK_FILENAME);
}

export function readFhvTempRootLock(datasetRoot: string): FhvTempRootLockV1 | null {
  const lock = readJsonFile<FhvTempRootLockV1>(resolveFhvTempRootLockPath(datasetRoot));
  return lock && lock.schemaVersion === FHV_TEMP_ROOT_LOCK_SCHEMA ? lock : null;
}

export function writeFhvTempRootLock(datasetRoot: string, lock: FhvTempRootLockV1): void {
  writeFileSync(
    resolveFhvTempRootLockPath(datasetRoot),
    `${JSON.stringify(lock, null, 2)}\n`,
    "utf8",
  );
}

/** A root is active when its owning pid is alive, or its ACTIVE lock is still fresh. */
export function isFhvTempRootActive(
  datasetRoot: string,
  options?: FhvTempRootRegistryOptions,
): boolean {
  const lock = readFhvTempRootLock(datasetRoot);
  if (!lock || lock.outcome !== "ACTIVE") {
    return false;
  }
  if (resolveIsPidAlive(options)(lock.pid)) {
    return true;
  }
  const lockPath = resolveFhvTempRootLockPath(datasetRoot);
  try {
    const ageMs = resolveNowMs(options) - statSync(lockPath).mtimeMs;
    return ageMs < FHV_TEMP_ROOT_LOCK_FRESH_MS;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                   */
/* -------------------------------------------------------------------------- */

function matchManagedPrefix(name: string): string | null {
  return FHV_MANAGED_TEMP_PREFIXES.find((prefix) => name.startsWith(prefix)) ?? null;
}

export function listFhvManagedTempRoots(
  options?: FhvTempRootRegistryOptions,
): FhvManagedTempRoot[] {
  const tempRootDir = resolveTempRootDir(options);
  if (!existsSync(tempRootDir)) {
    return [];
  }
  const roots: FhvManagedTempRoot[] = [];
  for (const entry of readdirSync(tempRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const prefix = matchManagedPrefix(entry.name);
    if (!prefix) {
      continue;
    }
    const path = join(tempRootDir, entry.name);
    let modifiedAtMs = 0;
    try {
      modifiedAtMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    roots.push({
      path,
      prefix,
      lock: readFhvTempRootLock(path),
      identity: readFhvTempDatasetIdentity(path),
      modifiedAtMs,
    });
  }
  return roots.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
}

/**
 * Duplicate-materialization prevention: find a reusable dataset by content identity across
 * ALL managed prefixes, not only the requesting one.
 */
export function findReusableFhvDatasetRoot(
  input: { datasetContentDigest?: string; releaseSha?: string },
  options?: FhvTempRootRegistryOptions,
): FhvManagedTempRoot | null {
  for (const root of listFhvManagedTempRoots(options)) {
    if (!root.identity) {
      continue;
    }
    if (isFhvTempRootActive(root.path, options)) {
      continue;
    }
    // Preserved failure evidence is diagnosable state, never a reuse source.
    if (root.lock?.outcome === "PRESERVED_FAILURE") {
      continue;
    }
    if (
      input.datasetContentDigest &&
      root.identity.datasetContentDigest !== input.datasetContentDigest
    ) {
      continue;
    }
    if (input.releaseSha && root.identity.releaseSha !== input.releaseSha) {
      continue;
    }
    if (!fhvTempDatasetIdentityMatchesDataset(root.path, root.identity)) {
      continue;
    }
    return root;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Acquire / release                                                           */
/* -------------------------------------------------------------------------- */

const ownedRoots = new Set<string>();
let exitHooksInstalled = false;

function preservationOptIn(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.FHV_PRESERVE_TEMP_DATASETS === "1";
}

function directoryBytes(path: string): number {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      try {
        total += statSync(entryPath).size;
      } catch {
        // Ignore races with concurrent cleanup.
      }
    }
  }
  return total;
}

/** Enforce the bounded preserved-failure budget (count and total bytes). */
export function pruneFhvPreservedFailureRoots(options?: FhvTempRootRegistryOptions): string[] {
  const preserved = listFhvManagedTempRoots(options)
    .filter((root) => root.lock?.outcome === "PRESERVED_FAILURE")
    .sort((a, b) => {
      const aAt = Date.parse(a.lock?.preservedAtUtc ?? "") || a.modifiedAtMs;
      const bAt = Date.parse(b.lock?.preservedAtUtc ?? "") || b.modifiedAtMs;
      return bAt - aAt;
    });
  const removed: string[] = [];
  let retained = 0;
  let retainedBytes = 0;
  for (const root of preserved) {
    const bytes = directoryBytes(root.path);
    const withinCount = retained < FHV_PRESERVED_FAILURE_ROOT_LIMIT;
    const withinBytes = retainedBytes + bytes <= FHV_PRESERVED_FAILURE_TOTAL_BYTES_LIMIT;
    if (withinCount && withinBytes) {
      retained += 1;
      retainedBytes += bytes;
      continue;
    }
    rmSync(root.path, { recursive: true, force: true });
    removed.push(root.path);
  }
  return removed;
}

export type FhvTempRootReleaseResult =
  | "REMOVED"
  | "PRESERVED"
  | "SKIPPED_ACTIVE"
  | "SKIPPED_NOT_MANAGED";

/**
 * Release an owned root. Runs after PASS and after ordinary FAIL; preservation is bounded and
 * an active run is never deleted.
 */
export function releaseFhvManagedDatasetRoot(
  datasetRoot: string,
  outcome: "PASS" | "FAIL",
  options?: FhvTempRootRegistryOptions & {
    env?: Readonly<Record<string, string | undefined>>;
  },
): FhvTempRootReleaseResult {
  ownedRoots.delete(datasetRoot);
  if (!datasetRoot || !existsSync(datasetRoot)) {
    return "SKIPPED_NOT_MANAGED";
  }
  if (!matchManagedPrefix(basename(datasetRoot))) {
    return "SKIPPED_NOT_MANAGED";
  }

  const lock = readFhvTempRootLock(datasetRoot);
  if (lock && lock.pid !== process.pid && isFhvTempRootActive(datasetRoot, options)) {
    return "SKIPPED_ACTIVE";
  }
  const preservedAtUtc = new Date(resolveNowMs(options)).toISOString();

  if (preservationOptIn(options?.env ?? process.env)) {
    if (lock) {
      writeFhvTempRootLock(datasetRoot, {
        ...lock,
        outcome: "PRESERVED_FAILURE",
        preservedAtUtc,
      });
    }
    return "PRESERVED";
  }

  if (outcome === "FAIL" && lock) {
    writeFhvTempRootLock(datasetRoot, { ...lock, outcome: "PRESERVED_FAILURE", preservedAtUtc });
    pruneFhvPreservedFailureRoots(options);
    return existsSync(datasetRoot) ? "PRESERVED" : "REMOVED";
  }

  rmSync(datasetRoot, { recursive: true, force: true });
  return "REMOVED";
}

function installExitHooks(options?: FhvTempRootRegistryOptions): void {
  if (exitHooksInstalled) {
    return;
  }
  exitHooksInstalled = true;
  const drain = (): void => {
    const outcome: "PASS" | "FAIL" =
      typeof process.exitCode === "number" && process.exitCode !== 0 ? "FAIL" : "PASS";
    for (const root of [...ownedRoots]) {
      try {
        releaseFhvManagedDatasetRoot(root, outcome, options);
      } catch {
        // Never let teardown mask the primary result.
      }
    }
  };
  process.once("exit", drain);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      drain();
      process.exit(process.exitCode ?? 0);
    });
  }
}

export type FhvAcquireManagedDatasetRootInput = Readonly<{
  prefix: (typeof FHV_MANAGED_TEMP_PREFIXES)[number];
  /** Materialize the dataset into the supplied root. Must be idempotent per root. */
  build: (datasetRoot: string) => void;
  /** Derive the identity sidecar. Defaults to reading the sealed v2 manifest + seal receipt. */
  identityOf?: (datasetRoot: string) => FhvTempDatasetIdentityV1;
  /** When known, restricts reuse to an exact content identity. */
  expectedDatasetContentDigest?: string;
  releaseSha?: string;
  minFreeBytes?: number;
}>;

export type FhvAcquireManagedDatasetRootResult = Readonly<{
  datasetRoot: string;
  reused: boolean;
}>;

/**
 * Acquire a managed dataset root: disk preflight, identity-keyed reuse across all managed
 * prefixes, per-run ownership lock, `try/finally` build, and sidecar identity on success.
 */
export function acquireFhvManagedDatasetRoot(
  input: FhvAcquireManagedDatasetRootInput,
  options?: FhvTempRootRegistryOptions,
): FhvAcquireManagedDatasetRootResult {
  assertFhvLocalDatasetDiskPreflight({ ...options, minFreeBytes: input.minFreeBytes });

  const reusable = findReusableFhvDatasetRoot(
    {
      ...(input.expectedDatasetContentDigest
        ? { datasetContentDigest: input.expectedDatasetContentDigest }
        : {}),
      ...(input.releaseSha ? { releaseSha: input.releaseSha } : {}),
    },
    options,
  );
  if (reusable) {
    writeFhvTempRootLock(reusable.path, {
      schemaVersion: FHV_TEMP_ROOT_LOCK_SCHEMA,
      pid: process.pid,
      startedAtUtc: new Date(resolveNowMs(options)).toISOString(),
      prefix: reusable.prefix,
      outcome: "ACTIVE",
    });
    ownedRoots.add(reusable.path);
    installExitHooks(options);
    return { datasetRoot: reusable.path, reused: true };
  }

  const tempRootDir = resolveTempRootDir(options);
  mkdirSync(tempRootDir, { recursive: true });
  const datasetRoot = mkdtempSync(join(tempRootDir, input.prefix));
  writeFhvTempRootLock(datasetRoot, {
    schemaVersion: FHV_TEMP_ROOT_LOCK_SCHEMA,
    pid: process.pid,
    startedAtUtc: new Date(resolveNowMs(options)).toISOString(),
    prefix: input.prefix,
    outcome: "ACTIVE",
  });
  ownedRoots.add(datasetRoot);
  installExitHooks(options);

  let built = false;
  try {
    input.build(datasetRoot);
    built = true;
  } finally {
    if (!built) {
      // Partial materialization is never reusable evidence — remove it immediately.
      ownedRoots.delete(datasetRoot);
      rmSync(datasetRoot, { recursive: true, force: true });
    }
  }

  const identityOf =
    input.identityOf ??
    ((root: string) =>
      buildFhvTempDatasetIdentityFromSealedDataset(root, {
        builtBy: "buildFhvOfficialV2ScaleDataset",
      }));
  writeFhvTempDatasetIdentity(datasetRoot, identityOf(datasetRoot));
  return { datasetRoot, reused: false };
}

/** Roots currently owned by this process (test/diagnostic surface). */
export function listFhvOwnedTempRoots(): readonly string[] {
  return [...ownedRoots];
}

/* -------------------------------------------------------------------------- */
/* Stale sweep                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Classify managed roots for sweeping. Deletion requires ALL of:
 * inactive, older than `minAgeMs`, carrying a verified identity, and a newer retained root
 * with the same `datasetContentDigest`.
 */
export function classifyFhvTempRootsForSweep(
  options?: FhvTempRootRegistryOptions & { minAgeMs?: number },
): FhvTempRootSweepPlan {
  const nowMs = resolveNowMs(options);
  const minAgeMs = options?.minAgeMs ?? FHV_STALE_TEMP_MIN_AGE_MS;
  const roots = listFhvManagedTempRoots(options);
  const entries: FhvTempRootSweepEntry[] = [];
  const deletable: string[] = [];
  const retainedByDigest = new Set<string>();

  for (const root of roots) {
    const digest = root.identity?.datasetContentDigest ?? null;
    const base = { path: root.path, prefix: root.prefix, datasetContentDigest: digest };

    if (isFhvTempRootActive(root.path, options)) {
      entries.push({ ...base, disposition: "RETAIN_ACTIVE", reason: "owning run is alive" });
      if (digest) {
        retainedByDigest.add(digest);
      }
      continue;
    }
    if (root.lock?.outcome === "PRESERVED_FAILURE") {
      entries.push({
        ...base,
        disposition: "RETAIN_PRESERVED_FAILURE",
        reason: "bounded failure evidence",
      });
      if (digest) {
        retainedByDigest.add(digest);
      }
      continue;
    }
    if (!root.identity || !digest) {
      entries.push({
        ...base,
        disposition: "RETAIN_UNMATCHED",
        reason: "no verifiable identity sidecar — requires Human review",
      });
      continue;
    }
    if (!fhvTempDatasetIdentityMatchesDataset(root.path, root.identity)) {
      entries.push({
        ...base,
        disposition: "RETAIN_UNMATCHED",
        reason: "sidecar identity does not match on-disk dataset",
      });
      continue;
    }
    if (nowMs - root.modifiedAtMs < minAgeMs) {
      entries.push({ ...base, disposition: "RETAIN_TOO_RECENT", reason: "below minimum age" });
      retainedByDigest.add(digest);
      continue;
    }
    if (!retainedByDigest.has(digest)) {
      entries.push({
        ...base,
        disposition: "RETAIN_NEWEST_FOR_DIGEST",
        reason: "newest verified copy for this datasetContentDigest",
      });
      retainedByDigest.add(digest);
      continue;
    }
    entries.push({
      ...base,
      disposition: "DELETE_DUPLICATE_IDENTITY",
      reason: "older duplicate of a retained datasetContentDigest",
    });
    deletable.push(root.path);
  }

  return { entries, deletable };
}

export type FhvTempRootSweepResult = Readonly<{
  plan: FhvTempRootSweepPlan;
  dryRun: boolean;
  removed: readonly string[];
}>;

export function sweepStaleFhvTempRoots(
  options?: FhvTempRootRegistryOptions & { minAgeMs?: number; dryRun?: boolean },
): FhvTempRootSweepResult {
  const plan = classifyFhvTempRootsForSweep(options);
  const dryRun = options?.dryRun !== false;
  const removed: string[] = [];
  if (!dryRun) {
    for (const path of plan.deletable) {
      // Re-check liveness immediately before deletion.
      if (isFhvTempRootActive(path, options)) {
        continue;
      }
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    }
  }
  return { plan, dryRun, removed };
}
