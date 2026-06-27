import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

export type {
  PositionSnapshotDto,
  PositionSnapshotMetadata,
  PositionSnapshotRepository,
  PositionSnapshotRow,
  PositionSnapshotService,
  PositionSnapshotServiceDeps,
  PositionSnapshotsListResponse,
  PositionSyncSuccessResponse,
  InsertPositionSnapshotRowInput,
  ListPositionSnapshotsQuery,
  RecordPositionSnapshotInput,
} from "@/lib/trader/positions/types";
export {
  parsePositionsJson,
  toPositionSnapshotDto,
  toPositionSnapshotMetadata,
} from "@/lib/trader/positions/types";
export {
  DEFAULT_POSITION_SNAPSHOTS_LIST_LIMIT,
  HTX_POSITION_SYNC_ERROR_CODES,
  MAX_POSITION_SNAPSHOTS_LIST_LIMIT,
  type HtxPositionSyncErrorCode,
} from "@/lib/trader/positions/sync-api.types";
export {
  createPositionSnapshotService,
  createPostgresPositionSnapshotService,
  createSqlitePositionSnapshotService,
} from "@/lib/trader/positions/position-snapshot-service";
export {
  createPostgresPositionSnapshotRepository,
  createSqlitePositionSnapshotRepository,
} from "@/lib/trader/positions/repository-adapters";
export {
  insertPositionSnapshotRowPostgres,
  listPositionSnapshotRowsPostgres,
} from "@/lib/trader/positions/repository-postgres";
export {
  insertPositionSnapshotRowSqlite,
  listPositionSnapshotRowsSqlite,
} from "@/lib/trader/positions/repository-sqlite";
export {
  createProductionPositionSyncDeps,
  handlePositionSnapshotsGet,
  handlePositionSyncPost,
  type PositionSyncHandlerDeps,
  type PositionSyncHandlerResult,
} from "@/lib/trader/positions/sync-handler";
