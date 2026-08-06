import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type Database from "better-sqlite3";

import {
  createIdhpsPreparedStatements,
  type IdhpsPreparedStatements,
} from "@/lib/trader/execution/idhps-prepared-statements";
import {
  clearIdhpsHotPathBans,
  enableIdhpsProductionBans,
  isIdhpsHotPathEnabled,
  resetIdhpsHotPathCounters,
  setIdhpsHotPathEnabled,
} from "@/lib/trader/execution/idhps-hot-path-counters";
import {
  createEmptyIdhpsInventoryMirror,
  evictTerminalFilledQuantityAfterEpochCommit,
  restoreIdhpsInventoryMirror,
  type IdhpsInventoryMirrorV1,
} from "@/lib/trader/paper/idhps-inventory-mirror";
import {
  createEmptyIdhpsAccountRiskMirror,
  restoreIdhpsAccountRiskMirror,
  type IdhpsAccountRiskMirrorV1,
} from "@/lib/trader/paper/idhps-account-risk-mirror";
import {
  captureIdhpsAccountingBridgeMirror,
  clearIdhpsEpochArraysAfterDurableCommit,
} from "@/lib/trader/accounting/idhps-accounting-bridge-mirror";
import type { HtrAccountingCycleBridge } from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import {
  createEmptyIdhpsSemanticDigestFrontier,
  restoreIdhpsSemanticDigestFrontier,
  type IdhpsSemanticDigestFrontierV1,
} from "@/lib/trader/backtest/streaming-evidence/idhps-semantic-digest-frontier";
import { resetIdhpsDecimalNormalizeCache } from "@/lib/trader/paper/idhps-decimal-normalize-cache";
import {
  buildIdhpsCompositeMirrorSnapshot,
  createEmptyIdhpsAccountingBridgeMirrorShell,
  readIdhpsCompositeMirrorSnapshot,
  writeIdhpsCompositeMirrorSnapshotAtomic,
} from "@/lib/trader/observability/idhps-composite-mirror-snapshot";
import type { FhvSealedLedgerIndex } from "@/lib/trader/observability/fhv-economic-ledger";
import type { FhvSealedOrderRegistry } from "@/lib/trader/observability/fhv-economic-seal";

export type IdhpsSessionRuntime = {
  prepared: IdhpsPreparedStatements;
  inventory: IdhpsInventoryMirrorV1;
  accountRisk: IdhpsAccountRiskMirrorV1;
  semanticDigestFrontier: IdhpsSemanticDigestFrontierV1;
  accountingBridge: HtrAccountingCycleBridge | null;
  checkpointBackupDurationMs: number | null;
  walBytes: number | null;
  /** Bytes of the session database snapshotted by the last checkpoint (WP-1 cost telemetry). */
  checkpointSessionBytes: number | null;
  /**
   * Whether the last session snapshot used a copy-on-write reflink.
   * APFS/XFS support it and make the copy near-free; ext4 does not and pays a full byte copy.
   * Recorded so filesystem divergence is observable instead of swallowed by a bare catch.
   */
  checkpointFicloneSucceeded: boolean | null;
  /** Cached fill-walk portfolio sizing snapshot; invalidated on fill/order mutation. */
  portfolioSizingCache: unknown | null;
  portfolioSizingCacheValid: boolean;
  /** Set when composite mirror restored from a post-step-10 durable checkpoint. */
  resumedAfterDurableEpochCommit: boolean;
  /**
   * Run-scoped sealed-order authority (ADR-0025 AD-11/AD-13), present only in bounded-hot-state
   * mode. Rebuilt once per seal publication, never per write, and discarded with the session —
   * it is not a process-global registry.
   */
  sealedOrderRegistry: FhvSealedOrderRegistry | null;
  sealedLedgerSnapshot: FhvSealedLedgerIndex | null;
};

let session: IdhpsSessionRuntime | null = null;

export function getIdhpsSession(): IdhpsSessionRuntime | null {
  return session;
}

export function requireIdhpsSession(): IdhpsSessionRuntime {
  if (!session) {
    throw new Error("BLOCKED_BY_H_ARCH_1_IDHPS_SESSION_NOT_OPEN");
  }
  return session;
}

export function openIdhpsSession(
  sqlite: Database.Database,
  options?: { enableBans?: boolean },
): void {
  closeIdhpsSession();
  resetIdhpsHotPathCounters();
  resetIdhpsDecimalNormalizeCache();
  setIdhpsHotPathEnabled(true);
  if (options?.enableBans !== false) {
    enableIdhpsProductionBans();
  }
  session = {
    prepared: createIdhpsPreparedStatements(sqlite),
    inventory: createEmptyIdhpsInventoryMirror(),
    accountRisk: createEmptyIdhpsAccountRiskMirror(),
    semanticDigestFrontier: createEmptyIdhpsSemanticDigestFrontier(),
    accountingBridge: null,
    checkpointBackupDurationMs: null,
    walBytes: null,
    checkpointSessionBytes: null,
    checkpointFicloneSucceeded: null,
    portfolioSizingCache: null,
    portfolioSizingCacheValid: false,
    resumedAfterDurableEpochCommit: false,
    sealedOrderRegistry: null,
    sealedLedgerSnapshot: null,
  };
}

/** Publish the verified sealed authority for this run. Verification happens at build time. */
export function setIdhpsSealedAuthority(input: {
  registry: FhvSealedOrderRegistry;
  snapshot: FhvSealedLedgerIndex;
}): void {
  const runtime = getIdhpsSession();
  if (!runtime) return;
  runtime.sealedOrderRegistry = input.registry;
  runtime.sealedLedgerSnapshot = input.snapshot;
}

export function invalidateIdhpsPortfolioSizingCache(): void {
  if (!session) return;
  session.portfolioSizingCache = null;
  session.portfolioSizingCacheValid = false;
}

export function bindIdhpsAccountingBridge(bridge: HtrAccountingCycleBridge): void {
  const runtime = requireIdhpsSession();
  runtime.accountingBridge = bridge;
}

export function recordIdhpsCheckpointMetrics(input: {
  checkpointBackupDurationMs: number;
  walBytes: number | null;
}): void {
  const runtime = getIdhpsSession();
  if (!runtime) return;
  runtime.checkpointBackupDurationMs = input.checkpointBackupDurationMs;
  runtime.walBytes = input.walBytes;
}

/** WP-1: record the size and copy mechanism of the last session snapshot. */
export function recordIdhpsCheckpointSnapshotCost(input: {
  checkpointSessionBytes: number | null;
  ficloneSucceeded: boolean | null;
}): void {
  const runtime = getIdhpsSession();
  if (!runtime) return;
  runtime.checkpointSessionBytes = input.checkpointSessionBytes;
  runtime.checkpointFicloneSucceeded = input.ficloneSucceeded;
}

/** Durable authority step 10: clear epoch-scoped mirrors after EPOCH_COMMIT + claim. */
export function applyIdhpsDurableEpochStep10(): void {
  const runtime = getIdhpsSession();
  if (!runtime) return;
  evictTerminalFilledQuantityAfterEpochCommit(runtime.inventory);
  if (runtime.accountingBridge) {
    clearIdhpsEpochArraysAfterDurableCommit(runtime.accountingBridge);
  }
}

/** Persist post-step-10 IDHPS mirrors beside the durable checkpoint bundle. */
export function writeIdhpsCompositeMirrorForCheckpoint(
  checkpointDir: string,
  epochId: number,
): void {
  const runtime = getIdhpsSession();
  if (!runtime) return;
  const snapshot = buildIdhpsCompositeMirrorSnapshot({
    epochId,
    inventory: runtime.inventory,
    accountRisk: runtime.accountRisk,
    accountingBridge: runtime.accountingBridge
      ? captureIdhpsAccountingBridgeMirror(runtime.accountingBridge)
      : createEmptyIdhpsAccountingBridgeMirrorShell(),
    semanticDigestFrontier: runtime.semanticDigestFrontier,
  });
  writeIdhpsCompositeMirrorSnapshotAtomic(checkpointDir, snapshot);
}

/** Restore inventory / account-risk / digest frontiers after session open on resume. */
export function restoreIdhpsCompositeMirrorFromCheckpoint(checkpointDir: string): void {
  const runtime = getIdhpsSession();
  if (!runtime) {
    return;
  }
  const snapshot = readIdhpsCompositeMirrorSnapshot(checkpointDir);
  if (!snapshot) {
    // Legacy checkpoints may omit the composite; FHV IDHPS epochs always write it.
    return;
  }
  runtime.inventory = restoreIdhpsInventoryMirror(snapshot.inventory);
  runtime.accountRisk = restoreIdhpsAccountRiskMirror(snapshot.accountRisk);
  runtime.semanticDigestFrontier = restoreIdhpsSemanticDigestFrontier(
    snapshot.semanticDigestFrontier,
  );
  runtime.portfolioSizingCache = null;
  runtime.portfolioSizingCacheValid = false;
  runtime.resumedAfterDurableEpochCommit = true;
}

export function closeIdhpsSession(): void {
  if (session) {
    session.prepared.finalize();
    session = null;
  }
  setIdhpsHotPathEnabled(false);
  // Prevent ban leakage across Vitest files in the same worker.
  clearIdhpsHotPathBans();
}

export function isIdhpsSessionOpen(): boolean {
  return session != null && isIdhpsHotPathEnabled();
}
