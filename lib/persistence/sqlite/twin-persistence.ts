import "server-only";

import type { WaiaDb } from "@/db/types";
import * as diaryMemory from "@/lib/twin-persistence/diary-memory";
import * as twinLoader from "@/lib/twin-persistence/loader";

type BoundSqliteTwinMethod<T extends (db: WaiaDb, ...args: never[]) => unknown> =
  T extends (db: WaiaDb, ...args: infer A) => infer R ? (...args: A) => R : never;

/**
 * SQLite-only AI-Twin / diary persistence boundary (DEE-64 D5a).
 * Callers pass an explicit {@link WaiaDb}; transaction policy remains in `db/waia-transaction.ts`.
 */
export type SqliteTwinPersistence = {
  readonly db: WaiaDb;
  ensureUserTwinSeed: BoundSqliteTwinMethod<typeof twinLoader.ensureUserTwinSeed>;
  appendTwinDialogueTurnResult: BoundSqliteTwinMethod<typeof twinLoader.appendTwinDialogueTurnResult>;
  persistUserTwinExchangeWithAssistantStub: BoundSqliteTwinMethod<
    typeof twinLoader.persistUserTwinExchangeWithAssistantStub
  >;
  appendTwinDialogueTurn: BoundSqliteTwinMethod<typeof twinLoader.appendTwinDialogueTurn>;
  countUserDialogueTurns: BoundSqliteTwinMethod<typeof twinLoader.countUserDialogueTurns>;
  listTwinDialogueTurnsChronological: BoundSqliteTwinMethod<
    typeof twinLoader.listTwinDialogueTurnsChronological
  >;
  listTwinDialogueTurnsForUser: BoundSqliteTwinMethod<typeof twinLoader.listTwinDialogueTurnsForUser>;
  loadDashboardReadinessPayloadFromDb: BoundSqliteTwinMethod<
    typeof twinLoader.loadDashboardReadinessPayloadFromDb
  >;
  appendDiaryEntryForUser: BoundSqliteTwinMethod<typeof diaryMemory.appendDiaryEntryForUser>;
  appendScenarioAnswerForUser: BoundSqliteTwinMethod<typeof diaryMemory.appendScenarioAnswerForUser>;
  listDiaryEntriesForUser: BoundSqliteTwinMethod<typeof diaryMemory.listDiaryEntriesForUser>;
  listScenarioAnswersForUser: BoundSqliteTwinMethod<typeof diaryMemory.listScenarioAnswersForUser>;
  stringifyScenarioPayloadForStorage: typeof diaryMemory.stringifyScenarioPayloadForStorage;
  applyReadinessDemoAdvanceForSubstantiveTurn: BoundSqliteTwinMethod<
    typeof twinLoader.applyReadinessDemoAdvanceForSubstantiveTurnSqlite
  >;
};

export function createSqliteTwinPersistence(db: WaiaDb): SqliteTwinPersistence {
  return {
    db,
    ensureUserTwinSeed: (userId) => twinLoader.ensureUserTwinSeed(db, userId),
    appendTwinDialogueTurnResult: (params) => twinLoader.appendTwinDialogueTurnResult(db, params),
    persistUserTwinExchangeWithAssistantStub: (params) =>
      twinLoader.persistUserTwinExchangeWithAssistantStub(db, params),
    appendTwinDialogueTurn: (params) => twinLoader.appendTwinDialogueTurn(db, params),
    countUserDialogueTurns: (twinProfileId) => twinLoader.countUserDialogueTurns(db, twinProfileId),
    listTwinDialogueTurnsChronological: (twinProfileId) =>
      twinLoader.listTwinDialogueTurnsChronological(db, twinProfileId),
    listTwinDialogueTurnsForUser: (userId) => twinLoader.listTwinDialogueTurnsForUser(db, userId),
    loadDashboardReadinessPayloadFromDb: (userId) =>
      twinLoader.loadDashboardReadinessPayloadFromDb(db, userId),
    appendDiaryEntryForUser: (params) => diaryMemory.appendDiaryEntryForUser(db, params),
    appendScenarioAnswerForUser: (params) =>
      diaryMemory.appendScenarioAnswerForUser(db, params),
    listDiaryEntriesForUser: (userId) => diaryMemory.listDiaryEntriesForUser(db, userId),
    listScenarioAnswersForUser: (userId) =>
      diaryMemory.listScenarioAnswersForUser(db, userId),
    stringifyScenarioPayloadForStorage: diaryMemory.stringifyScenarioPayloadForStorage,
    applyReadinessDemoAdvanceForSubstantiveTurn: (params) =>
      twinLoader.applyReadinessDemoAdvanceForSubstantiveTurnSqlite(db, params),
  };
}
