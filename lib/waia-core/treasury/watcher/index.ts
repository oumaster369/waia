import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

export {
  loadTreasuryWatcherConfig,
  TREASURY_WATCHER_CHECKPOINT_KEY,
  TREASURY_WATCHER_INGESTION_SOURCE,
} from "@/lib/waia-core/treasury/watcher/config";
export { runTreasuryWatcherCycle } from "@/lib/waia-core/treasury/watcher/cycle";
export type {
  TreasuryWatcherCycleDeps,
  TreasuryWatcherCycleReport,
} from "@/lib/waia-core/treasury/watcher/cycle";
export { createMemoryTreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/memory-repository";
export { createPostgresTreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/postgres-repository";
export { createTreasuryTronAdapter } from "@/lib/waia-core/treasury/watcher/tron-adapter";
export { createSilentTreasuryWatcherLogger } from "@/lib/waia-core/treasury/watcher/logger";
export {
  computeConfirmationDepth,
  computeTreasuryScanRange,
  seedLastScannedBlock,
} from "@/lib/waia-core/treasury/watcher/block-height";
export { treasuryObservationIdempotencyKey } from "@/lib/waia-core/treasury/watcher/idempotency";
export { computeTreasuryRawEventDigest } from "@/lib/waia-core/treasury/watcher/digest";
export {
  matchWatchedAddresses,
  assignObservationRoles,
} from "@/lib/waia-core/treasury/watcher/matching";
export {
  TREASURY_RECON_TOLERANCE_MICROS,
  accountingCashBalanceAt,
  classifyReconciliation,
  pendingExplanationMicros,
} from "@/lib/waia-core/treasury/watcher/reconciliation";
