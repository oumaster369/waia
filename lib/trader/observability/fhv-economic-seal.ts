import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/**
 * FHV economic seal (ADR-0025, OPTION_E).
 *
 * A terminal `OrderState` is NOT an economic-immutability frontier. `recordFillSqlite` and
 * `recordFillProgressSqlite` guard only on parent existence, never on terminality, so the
 * lifecycle permits appending fills and updating filled quantity / average fill price on an
 * order that already reached FILLED, CANCELLED, REJECTED, EXPIRED or FAILED.
 *
 * The authoritative cutover between the append-only economic ledger and bounded SQLite hot state
 * is therefore an explicit, durable, versioned seal issued only by the epoch-commit lifecycle
 * after economic completeness and clean reconciliation are proven. Pruning is never a decision
 * the pruner makes; it is a permission the seal grants.
 */

export const FHV_ECONOMIC_SEAL_SCHEMA = "fhv-economic-seal/v1" as const;
export const FHV_ECONOMIC_SEAL_DIRNAME = "economic-seal";
export const FHV_ECONOMIC_SEAL_LOG_FILENAME = "economic-seal-log.v1.ndjson";
export const FHV_ECONOMIC_SEAL_MANIFEST_FILENAME = "economic-seal-manifest.v1.json";

export type FhvEconomicSealV1 = Readonly<{
  schemaVersion: typeof FHV_ECONOMIC_SEAL_SCHEMA;
  organizationId: string;
  runId: string;
  sessionIdentity: string;
  orderId: string;
  executionMode: string;
  /** Recorded for audit. Never the seal criterion. */
  finalObservedOrderState: string;
  finalQuantity: string;
  finalFilledQuantity: string;
  finalAvgFillPrice: string | null;
  lastOrderEventSeq: number;
  /** Commitment over the complete fill identity set, so post-seal duplicates are resolvable. */
  fillIdentityCommitment: string;
  fillIds: readonly string[];
  exchangeTradeIds: readonly string[];
  accountingFrontierSequence: number;
  sourceFrontierGlobalEventSequence: number;
  owningEpochId: number;
  owningLastCycle: number;
  ledgerSegmentSeq: number;
  ledgerChainDigest: string;
  economicExportDigest: string;
  /** Deterministic replay time. Never wall clock. */
  sealedAtReplayMs: number;
  sealingReason: string;
  reconciliationProofIdentity: string;
  sealDigest: string;
}>;

export type FhvEconomicSealManifestV1 = Readonly<{
  schemaVersion: "fhv-economic-seal-manifest/v1";
  organizationId: string;
  runId: string;
  sessionIdentity: string;
  sealCount: number;
  chainDigest: string;
}>;

const GENESIS_DIGEST = "0".repeat(64);

export class EconomicSealBreachError extends Error {
  readonly classification = "FHV_ECONOMIC_SEAL_BREACH";
  constructor(
    readonly orderId: string,
    readonly exchangeTradeId: string,
    detail: string,
  ) {
    super(
      `FHV_ECONOMIC_SEAL_BREACH: order=${orderId} exchangeTradeId=${exchangeTradeId} ${detail}`,
    );
    this.name = "EconomicSealBreachError";
  }
}

export class SealedLedgerScopeViolationError extends Error {
  readonly classification = "FHV_SEALED_LEDGER_SCOPE_VIOLATION";
  constructor(detail: string) {
    super(`FHV_SEALED_LEDGER_SCOPE_VIOLATION: ${detail}`);
    this.name = "SealedLedgerScopeViolationError";
  }
}

export class SealedLedgerIdentityDriftError extends Error {
  readonly classification = "FHV_SEALED_LEDGER_IDENTITY_DRIFT";
  constructor(detail: string) {
    super(`FHV_SEALED_LEDGER_IDENTITY_DRIFT: ${detail}`);
    this.name = "SealedLedgerIdentityDriftError";
  }
}

export function resolveFhvEconomicSealDir(runDir: string): string {
  return join(runDir, FHV_ECONOMIC_SEAL_DIRNAME);
}

function resolveSealLogPath(runDir: string): string {
  return join(resolveFhvEconomicSealDir(runDir), FHV_ECONOMIC_SEAL_LOG_FILENAME);
}

function resolveSealManifestPath(runDir: string): string {
  return join(resolveFhvEconomicSealDir(runDir), FHV_ECONOMIC_SEAL_MANIFEST_FILENAME);
}

export function computeFhvFillIdentityCommitment(
  fillIds: readonly string[],
  exchangeTradeIds: readonly string[],
): string {
  const canonical = JSON.stringify({
    fillIds: [...fillIds].sort(),
    exchangeTradeIds: [...exchangeTradeIds].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function computeFhvEconomicSealDigest(seal: Omit<FhvEconomicSealV1, "sealDigest">): string {
  return createHash("sha256").update(JSON.stringify(seal)).digest("hex");
}

function appendLineFsync(path: string, line: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeFileAtomicFsync(path: string, contents: string): void {
  const tempPath = `${path}.tmp-${process.pid}`;
  const fd = openSync(tempPath, "w");
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, path);
}

export function readFhvEconomicSeals(runDir: string): FhvEconomicSealV1[] {
  const path = resolveSealLogPath(runDir);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FhvEconomicSealV1);
}

export function readFhvEconomicSealManifest(runDir: string): FhvEconomicSealManifestV1 | null {
  const path = resolveSealManifestPath(runDir);
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as FhvEconomicSealManifestV1)
    : null;
}

/**
 * Publish seals for one committed epoch.
 *
 * Callers must already have appended and verified the ledger segment and proven clean
 * reconciliation. Seals are appended before any pruning so a crash can never leave pruned rows
 * without a committed seal.
 */
export function publishFhvEconomicSeals(input: {
  runDir: string;
  organizationId: string;
  runId: string;
  sessionIdentity: string;
  seals: readonly Omit<FhvEconomicSealV1, "sealDigest">[];
}): FhvEconomicSealManifestV1 {
  const existing = readFhvEconomicSeals(input.runDir);
  let chainDigest =
    readFhvEconomicSealManifest(input.runDir)?.chainDigest ??
    (existing.length > 0 ? (existing.at(-1) as FhvEconomicSealV1).sealDigest : GENESIS_DIGEST);

  mkdirSync(resolveFhvEconomicSealDir(input.runDir), { recursive: true });
  const logPath = resolveSealLogPath(input.runDir);

  for (const body of input.seals) {
    if (body.organizationId !== input.organizationId || body.runId !== input.runId) {
      throw new SealedLedgerScopeViolationError(
        `seal org/run mismatch order=${body.orderId} org=${body.organizationId} run=${body.runId}`,
      );
    }
    const sealDigest = computeFhvEconomicSealDigest(body);
    const seal: FhvEconomicSealV1 = { ...body, sealDigest };
    appendLineFsync(logPath, `${JSON.stringify(seal)}\n`);
    chainDigest = createHash("sha256").update(`${chainDigest}:${sealDigest}`).digest("hex");
  }

  const manifest: FhvEconomicSealManifestV1 = {
    schemaVersion: "fhv-economic-seal-manifest/v1",
    organizationId: input.organizationId,
    runId: input.runId,
    sessionIdentity: input.sessionIdentity,
    sealCount: existing.length + input.seals.length,
    chainDigest,
  };
  writeFileAtomicFsync(
    resolveSealManifestPath(input.runDir),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export type FhvSealedFillIdentity = Readonly<{
  orderId: string;
  fillId: string;
  exchangeTradeId: string;
}>;

/**
 * Immutable registry resolving sealed order and fill identity after the hot-state rows are gone.
 *
 * This is what preserves fill idempotency across pruning: `recordFill` consults it before
 * concluding the parent order is missing.
 */
export type FhvSealedOrderRegistry = Readonly<{
  organizationId: string;
  runId: string;
  sessionIdentity: string;
  sealCount: number;
  chainDigest: string;
  isSealed(orderId: string): boolean;
  getSeal(orderId: string): FhvEconomicSealV1 | null;
  hasFillIdentity(orderId: string, exchangeTradeId: string): boolean;
  getSealForExchangeTrade(orderId: string, exchangeTradeId: string): FhvEconomicSealV1 | null;
  assertScope(organizationId: string, runId?: string): void;
}>;

/**
 * Build the registry once, verifying seal-chain integrity and identity binding up front.
 * Reads never re-verify or re-hash.
 */
export function openFhvSealedOrderRegistry(input: {
  runDir: string;
  organizationId: string;
  runId: string;
  sessionIdentity?: string;
}): FhvSealedOrderRegistry {
  const seals = readFhvEconomicSeals(input.runDir);
  const manifest = readFhvEconomicSealManifest(input.runDir);

  const byOrderId = new Map<string, FhvEconomicSealV1>();
  const fillKeys = new Set<string>();
  let chainDigest = GENESIS_DIGEST;

  for (const seal of seals) {
    if (seal.schemaVersion !== FHV_ECONOMIC_SEAL_SCHEMA) {
      throw new SealedLedgerIdentityDriftError(`unexpected seal schema ${seal.schemaVersion}`);
    }
    if (seal.organizationId !== input.organizationId || seal.runId !== input.runId) {
      throw new SealedLedgerScopeViolationError(
        `seal belongs to org=${seal.organizationId} run=${seal.runId}, expected org=${input.organizationId} run=${input.runId}`,
      );
    }
    const { sealDigest, ...body } = seal;
    if (computeFhvEconomicSealDigest(body) !== sealDigest) {
      throw new SealedLedgerIdentityDriftError(`seal digest mismatch for order ${seal.orderId}`);
    }
    if (
      computeFhvFillIdentityCommitment(seal.fillIds, seal.exchangeTradeIds) !==
      seal.fillIdentityCommitment
    ) {
      throw new SealedLedgerIdentityDriftError(
        `fill identity commitment mismatch for order ${seal.orderId}`,
      );
    }
    if (byOrderId.has(seal.orderId)) {
      throw new SealedLedgerIdentityDriftError(`duplicate seal for order ${seal.orderId}`);
    }
    byOrderId.set(seal.orderId, seal);
    for (const exchangeTradeId of seal.exchangeTradeIds) {
      fillKeys.add(`${seal.orderId}\u0000${exchangeTradeId}`);
    }
    chainDigest = createHash("sha256").update(`${chainDigest}:${sealDigest}`).digest("hex");
  }

  if (manifest && manifest.sealCount !== seals.length) {
    throw new SealedLedgerIdentityDriftError(
      `seal manifest count ${manifest.sealCount} does not match log length ${seals.length}`,
    );
  }
  if (manifest && manifest.chainDigest !== chainDigest) {
    throw new SealedLedgerIdentityDriftError("seal manifest chain digest mismatch");
  }

  return {
    organizationId: input.organizationId,
    runId: input.runId,
    sessionIdentity: input.sessionIdentity ?? manifest?.sessionIdentity ?? "",
    sealCount: seals.length,
    chainDigest,
    isSealed: (orderId) => byOrderId.has(orderId),
    getSeal: (orderId) => byOrderId.get(orderId) ?? null,
    hasFillIdentity: (orderId, exchangeTradeId) =>
      fillKeys.has(`${orderId}\u0000${exchangeTradeId}`),
    getSealForExchangeTrade: (orderId, exchangeTradeId) =>
      fillKeys.has(`${orderId}\u0000${exchangeTradeId}`) ? (byOrderId.get(orderId) ?? null) : null,
    assertScope: (organizationId, runId) => {
      if (organizationId !== input.organizationId) {
        throw new SealedLedgerScopeViolationError(
          `registry is scoped to org=${input.organizationId}, refused org=${organizationId}`,
        );
      }
      if (runId != null && runId !== input.runId) {
        throw new SealedLedgerScopeViolationError(
          `registry is scoped to run=${input.runId}, refused run=${runId}`,
        );
      }
    },
  };
}
