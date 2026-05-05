import "server-only";

import { and, count, eq, max } from "drizzle-orm";

import { twinRepeatabilityRecords } from "@/db/schema";
import type { TwinRepeatabilityApiResponse } from "@/lib/dashboard/twin-repeatability-api.types";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import { hashTwinScenarioRepeatabilityHex } from "@/lib/twin-persistence/twin-repeatability";

export type AnalyzeRepeatabilityOptions = {
  scenarioText?: string;
};

export function analyzeRepeatability(
  db: WaiaSqliteDb,
  userId: string,
  options?: AnalyzeRepeatabilityOptions,
): TwinRepeatabilityApiResponse {
  const scenarioTrim = options?.scenarioText?.trim() ?? "";
  const scenarioFilter =
    scenarioTrim.length > 0
      ? eq(
          twinRepeatabilityRecords.scenarioHash,
          hashTwinScenarioRepeatabilityHex(scenarioTrim).scenarioHashHex,
        )
      : undefined;

  const whereClause = scenarioFilter != null ? and(eq(twinRepeatabilityRecords.userId, userId), scenarioFilter) : eq(twinRepeatabilityRecords.userId, userId);

  const rows = db
    .select({
      patternType: twinRepeatabilityRecords.patternType,
      occurrences: count(twinRepeatabilityRecords.id),
      lastSeenAt: max(twinRepeatabilityRecords.createdAt),
    })
    .from(twinRepeatabilityRecords)
    .where(whereClause)
    .groupBy(twinRepeatabilityRecords.patternType)
    .all();

  const repeatedPatterns = [...rows]
    .sort((a, b) => a.patternType.localeCompare(b.patternType))
    .map((r) => ({
      patternType: r.patternType,
      occurrences: r.occurrences,
      lastSeenAt: (r.lastSeenAt as Date).toISOString(),
    }));

  return {
    schemaVersion: TWIN_REPEATABILITY_SCHEMA_VERSION,
    repeatedPatterns,
  };
}
