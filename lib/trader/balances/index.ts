import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

export type {
  BalanceSnapshotDto,
  BalanceSnapshotMetadata,
  BalanceSnapshotRepository,
  BalanceSnapshotRow,
  BalanceSnapshotService,
  BalanceSnapshotServiceDeps,
  BalanceSnapshotsListResponse,
  BalanceSyncSuccessResponse,
  InsertBalanceSnapshotRowInput,
  ListBalanceSnapshotsQuery,
  RecordBalanceSnapshotInput,
} from "@/lib/trader/balances/types";
export {
  parseBalancesJson,
  toBalanceSnapshotDto,
  toBalanceSnapshotMetadata,
} from "@/lib/trader/balances/types";
export {
  DEFAULT_BALANCE_SNAPSHOTS_LIST_LIMIT,
  HTX_BALANCE_SYNC_ERROR_CODES,
  MAX_BALANCE_SNAPSHOTS_LIST_LIMIT,
  type HtxBalanceSyncErrorCode,
} from "@/lib/trader/balances/sync-api.types";
export {
  createBalanceSnapshotService,
  createPostgresBalanceSnapshotService,
  createSqliteBalanceSnapshotService,
} from "@/lib/trader/balances/balance-snapshot-service";
export {
  createPostgresBalanceSnapshotRepository,
  createSqliteBalanceSnapshotRepository,
} from "@/lib/trader/balances/repository-adapters";
export {
  insertBalanceSnapshotRowPostgres,
  listBalanceSnapshotRowsPostgres,
} from "@/lib/trader/balances/repository-postgres";
export {
  insertBalanceSnapshotRowSqlite,
  listBalanceSnapshotRowsSqlite,
} from "@/lib/trader/balances/repository-sqlite";
export {
  createProductionBalanceSyncDeps,
  handleBalanceSnapshotsGet,
  handleBalanceSyncPost,
  type BalanceSyncHandlerDeps,
  type BalanceSyncHandlerResult,
} from "@/lib/trader/balances/sync-handler";
