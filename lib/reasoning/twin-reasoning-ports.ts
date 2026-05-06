import "server-only";

import type { TwinPredictionVerificationItemDto } from "@/lib/dashboard/twin-prediction-verification-api.types";
import type { PostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";
import { searchTwinMemoriesByText } from "@/lib/twin-persistence/twin-memory-retrieval";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import { listTwinPredictionVerificationsForUser } from "@/lib/twin-persistence/twin-prediction-verifications";

/**
 * Narrow async seam for Postgres-capable reasoning (DEE-72.4).
 * Backend-specific adapters only — not a neutral repository layer.
 */
export type TwinMemorySearchPort = {
  searchByText: (
    userId: string,
    queryText: string,
    topN: number,
  ) => Promise<TwinMemorySearchHit[]>;
};

export type TwinVerificationListPort = {
  listPredictionVerifications: (
    userId: string,
    limit: number,
  ) => Promise<TwinPredictionVerificationItemDto[]>;
};

export function createTwinMemorySearchPortSqlite(db: WaiaSqliteDb): TwinMemorySearchPort {
  return {
    searchByText: (userId, queryText, topN) =>
      Promise.resolve(searchTwinMemoriesByText(db, userId, queryText, topN)),
  };
}

export function createTwinMemorySearchPortPostgres(p: PostgresTwinPersistence): TwinMemorySearchPort {
  return {
    searchByText: (userId, queryText, topN) => p.searchTwinMemoriesByText(userId, queryText, topN),
  };
}

export function createTwinVerificationListPortSqlite(db: WaiaSqliteDb): TwinVerificationListPort {
  return {
    listPredictionVerifications: (userId, limit) =>
      Promise.resolve(listTwinPredictionVerificationsForUser(db, userId, limit)),
  };
}

export function createTwinVerificationListPortPostgres(p: PostgresTwinPersistence): TwinVerificationListPort {
  return {
    listPredictionVerifications: (userId, limit) =>
      p.listTwinPredictionVerificationsForUser(userId, limit),
  };
}
