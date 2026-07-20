import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createSqliteWatcherCheckpointRepository } from "@/lib/waia-core/payment-watcher/checkpoint-repository-sqlite";
import { createPostgresWatcherCheckpointRepository } from "@/lib/waia-core/payment-watcher/checkpoint-repository-postgres";
import type { WatcherCheckpointRepository } from "@/lib/waia-core/payment-watcher/checkpoint-repository.types";

type PgCheckpointExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createSqliteWatcherCheckpointRepositoryAdapter(
  db: WaiaDb,
): WatcherCheckpointRepository {
  return createSqliteWatcherCheckpointRepository(db);
}

export function createPostgresWatcherCheckpointRepositoryAdapter(
  ex: PgCheckpointExecutor,
): WatcherCheckpointRepository {
  return createPostgresWatcherCheckpointRepository(ex);
}
