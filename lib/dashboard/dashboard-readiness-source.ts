import "server-only";

import { getDb } from "@/db/client";
import type { DashboardReadinessPayload } from "@/lib/dashboard/dashboard-readiness-api.types";
import { NULL_HINTS_BY_INDICATOR } from "@/lib/dashboard/null-hints";
import {
  DEFAULT_DASHBOARD_IDENTITY_LABEL,
  DEFAULT_READINESS_INPUT,
  DEFAULT_TWIN_DIALOGUE_SIGNALS,
} from "@/lib/dashboard/readiness-snapshot-default";
import { loadDashboardReadinessPayloadFromDb } from "@/lib/twin-persistence/loader";

export { NULL_HINTS_BY_INDICATOR } from "@/lib/dashboard/null-hints";

/** HTTP contract: see `GET /api/dashboard/readiness`; same snapshot hydrates `/dashboard`. */
async function persistenceDefaults(): Promise<DashboardReadinessPayload> {
  return {
    readinessInput: DEFAULT_READINESS_INPUT,
    twinSignals: DEFAULT_TWIN_DIALOGUE_SIGNALS,
    identityLabel: DEFAULT_DASHBOARD_IDENTITY_LABEL,
    hintsByIndicator: NULL_HINTS_BY_INDICATOR,
  };
}

/**
 * Hydrates readiness from SQLite (see DEE-25). On failures (fresh clone without migrate), falls back
 * to static defaults — log in development only so CI with migrated DB catches regressions.
 */
export async function getDashboardReadinessPayload(): Promise<DashboardReadinessPayload> {
  try {
    const db = getDb();
    return loadDashboardReadinessPayloadFromDb(db);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[waia] getDashboardReadinessPayload: DB unavailable, using defaults.", error);
    }
    return persistenceDefaults();
  }
}
