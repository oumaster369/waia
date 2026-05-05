import "server-only";

import { getDb } from "@/db/client";
import type { DashboardReadinessPayload } from "@/lib/dashboard/dashboard-readiness-api.types";
import { loadDashboardReadinessPayloadFromDb } from "@/lib/twin-persistence/loader";

/** HTTP contract: GET /api/dashboard/readiness and `/dashboard` RSC (single persisted source per userId). */
export async function getDashboardReadinessPayloadForUser(
  userId: string,
): Promise<DashboardReadinessPayload> {
  const db = getDb();
  return await loadDashboardReadinessPayloadFromDb(db, userId);
}
