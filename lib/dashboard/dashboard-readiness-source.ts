import "server-only";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { DashboardReadinessPayload } from "@/lib/dashboard/dashboard-readiness-api.types";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import type { TwinDialogueMemoryRow } from "@/lib/twin-persistence/loader";
import type { DiaryMemoryRow } from "@/lib/twin-persistence/diary-memory";

/** Loads readiness payload using an already-resolved runtime handle (avoids duplicate `getWaiaRuntimeDb` per request). */
export async function loadDashboardReadinessPayloadFromRuntime(
  runtime: WaiaRuntimeDb,
  userId: string,
): Promise<DashboardReadinessPayload> {
  const p =
    runtime.kind === "sqlite"
      ? resolveTwinPersistence(runtime)
      : resolveTwinPersistence(runtime);
  return await p.loadDashboardReadinessPayloadFromDb(userId);
}

/**
 * HTTP contract: GET /api/dashboard/readiness — persisted readiness + twin signals (same semantic source as dashboard RSC).
 */
export async function getDashboardReadinessPayloadForUser(
  userId: string,
): Promise<DashboardReadinessPayload> {
  let runtime: WaiaRuntimeDb | undefined;
  try {
    runtime = await getWaiaRuntimeDb();
    return await loadDashboardReadinessPayloadFromRuntime(runtime, userId);
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}

/** Dashboard RSC: single runtime resolve for readiness + dialogue + diary reads (Postgres/SQLite policy aligned with twin APIs). */
export async function loadDashboardPageDataForUser(userId: string): Promise<{
  payload: DashboardReadinessPayload;
  dialogueTurns: TwinDialogueMemoryRow[];
  diaryEntries: DiaryMemoryRow[];
}> {
  let runtime: WaiaRuntimeDb | undefined;
  try {
    runtime = await getWaiaRuntimeDb();
    const p =
      runtime.kind === "sqlite"
        ? resolveTwinPersistence(runtime)
        : resolveTwinPersistence(runtime);
    const [payload, dialogueTurns, diaryEntries] = await Promise.all([
      p.loadDashboardReadinessPayloadFromDb(userId),
      p.listTwinDialogueTurnsForUser(userId),
      p.listDiaryEntriesForUser(userId),
    ]);
    return { payload, dialogueTurns, diaryEntries };
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
