export { runWatcherCycle } from "@/lib/waia-core/payment-watcher/run-watcher-cycle";
export {
  loadWatcherConfig,
  CANONICAL_NETWORK,
  USDT_TRC20_CONTRACT,
} from "@/lib/waia-core/payment-watcher/watcher-config";
export type { WatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";
export type {
  WatcherDeps,
  CycleReport,
  ObservedTransfer,
} from "@/lib/waia-core/payment-watcher/watcher-cycle.types";
export type { ChainAdapter } from "@/lib/waia-core/payment-watcher/chain-adapter.port";
export { createTronAdapter } from "@/lib/waia-core/payment-watcher/tron-adapter";
export { normalizeSettlementNetwork } from "@/lib/waia-core/payment-watcher/normalize-network";
export { paymentIdempotencyKey } from "@/lib/waia-core/payment-watcher/idempotency";
export {
  computeScanRange,
  computeConfirmationDepth,
  shouldConfirm,
  shouldDetect,
} from "@/lib/waia-core/payment-watcher/confirmation";
export { createStdoutWatcherLogger } from "@/lib/waia-core/payment-watcher/watcher-logger";
export {
  createSqliteWatcherCheckpointRepositoryAdapter,
  createPostgresWatcherCheckpointRepositoryAdapter,
} from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";
export type { WatcherCheckpointRepository } from "@/lib/waia-core/payment-watcher/checkpoint-repository.types";
export { buildWatcherDepsFromEnv } from "@/lib/waia-core/payment-watcher/build-worker-deps";
