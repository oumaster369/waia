import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

export type {
  TradeHistorySnapshotDto,
  TradeHistorySnapshotMetadata,
  TradeHistorySnapshotRepository,
  TradeHistorySnapshotRow,
  TradeHistorySnapshotService,
  TradeHistorySnapshotServiceDeps,
  TradeHistorySnapshotsListResponse,
  TradeHistorySyncSuccessResponse,
  InsertTradeHistorySnapshotRowInput,
  ListTradeHistorySnapshotsQuery,
  RecordTradeHistorySnapshotInput,
} from "@/lib/trader/trade-history/types";
export {
  parseTradesJson,
  toTradeHistorySnapshotDto,
  toTradeHistorySnapshotMetadata,
} from "@/lib/trader/trade-history/types";
export {
  DEFAULT_TRADE_HISTORY_SNAPSHOTS_LIST_LIMIT,
  HTX_TRADE_HISTORY_SYNC_ERROR_CODES,
  MAX_TRADE_HISTORY_SNAPSHOTS_LIST_LIMIT,
  type HtxTradeHistorySyncErrorCode,
  type TradeHistorySyncRequestBody,
} from "@/lib/trader/trade-history/sync-api.types";
export {
  createTradeHistorySnapshotService,
  createPostgresTradeHistorySnapshotService,
  createSqliteTradeHistorySnapshotService,
} from "@/lib/trader/trade-history/trade-history-snapshot-service";
export {
  createPostgresTradeHistorySnapshotRepository,
  createSqliteTradeHistorySnapshotRepository,
} from "@/lib/trader/trade-history/repository-adapters";
export {
  insertTradeHistorySnapshotRowPostgres,
  listTradeHistorySnapshotRowsPostgres,
} from "@/lib/trader/trade-history/repository-postgres";
export {
  insertTradeHistorySnapshotRowSqlite,
  listTradeHistorySnapshotRowsSqlite,
} from "@/lib/trader/trade-history/repository-sqlite";
export {
  createProductionTradeHistorySyncDeps,
  handleTradeHistorySnapshotsGet,
  handleTradeHistorySyncPost,
  type TradeHistorySyncHandlerDeps,
  type TradeHistorySyncHandlerResult,
} from "@/lib/trader/trade-history/sync-handler";
