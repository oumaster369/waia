import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  findActivePatternByStructuralSignaturePostgres,
  findPatternByDigestPostgres,
  getLatestLifecycleEventPostgres,
  getLatestPatternPostgres,
  insertLifecycleEventPostgres,
  insertPatternVersionPostgres,
  listLifecycleEventsPostgres,
  listPatternHistoryPostgres,
  listPatternsPostgres,
} from "@/lib/trader/mi/pattern-repository-postgres";
import {
  findActivePatternByStructuralSignatureSqlite,
  findPatternByDigestSqlite,
  getLatestLifecycleEventSqlite,
  getLatestPatternSqlite,
  insertLifecycleEventSqlite,
  insertPatternVersionSqlite,
  listLifecycleEventsSqlite,
  listPatternHistorySqlite,
  listPatternsSqlite,
} from "@/lib/trader/mi/pattern-repository-sqlite";
import type { MiPatternRepository } from "@/lib/trader/mi/types";

type PgMiPatternExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteMiPatternRepository(db: WaiaDb): MiPatternRepository {
  return {
    getLatestPattern: (context, patternKey) => getLatestPatternSqlite(db, context, patternKey),
    listPatternHistory: (context, patternKey) => listPatternHistorySqlite(db, context, patternKey),
    listPatterns: (context, patternKind) => listPatternsSqlite(db, context, patternKind),
    findPatternByDigest: (context, definitionDigest) =>
      findPatternByDigestSqlite(db, context, definitionDigest),
    findActivePatternByStructuralSignature: (context, structuralSignature) =>
      findActivePatternByStructuralSignatureSqlite(db, context, structuralSignature),
    insertPatternVersion: (context, row) => insertPatternVersionSqlite(db, context, row),
    getLatestLifecycleEvent: (context, patternKey) =>
      getLatestLifecycleEventSqlite(db, context, patternKey),
    listLifecycleEvents: (context, patternKey) =>
      listLifecycleEventsSqlite(db, context, patternKey),
    insertLifecycleEvent: (context, row) => insertLifecycleEventSqlite(db, context, row),
  };
}

export function createPostgresMiPatternRepository(ex: PgMiPatternExecutor): MiPatternRepository {
  return {
    getLatestPattern: (context, patternKey) => getLatestPatternPostgres(ex, context, patternKey),
    listPatternHistory: (context, patternKey) =>
      listPatternHistoryPostgres(ex, context, patternKey),
    listPatterns: (context, patternKind) => listPatternsPostgres(ex, context, patternKind),
    findPatternByDigest: (context, definitionDigest) =>
      findPatternByDigestPostgres(ex, context, definitionDigest),
    findActivePatternByStructuralSignature: (context, structuralSignature) =>
      findActivePatternByStructuralSignaturePostgres(ex, context, structuralSignature),
    insertPatternVersion: (context, row) => insertPatternVersionPostgres(ex, context, row),
    getLatestLifecycleEvent: (context, patternKey) =>
      getLatestLifecycleEventPostgres(ex, context, patternKey),
    listLifecycleEvents: (context, patternKey) =>
      listLifecycleEventsPostgres(ex, context, patternKey),
    insertLifecycleEvent: (context, row) => insertLifecycleEventPostgres(ex, context, row),
  };
}
