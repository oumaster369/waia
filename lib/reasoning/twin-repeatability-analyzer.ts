import "server-only";

import { and, count, eq, max } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { TwinRepeatabilityApiResponse } from "@/lib/dashboard/twin-repeatability-api.types";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
import { twinRepeatabilityRecords } from "@/db/schema";
import { hashTwinScenarioRepeatabilityHex } from "@/lib/twin-persistence/twin-repeatability";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";

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

/** DEE-72.5: Postgres read path; mirrors {@link analyzeRepeatability} aggregation semantics. */
export async function analyzeRepeatabilityForUserAsync(
  db: WaiaPostgresDb,
  userId: string,
  options?: AnalyzeRepeatabilityOptions,
): Promise<TwinRepeatabilityApiResponse> {
  const scenarioTrim = options?.scenarioText?.trim() ?? "";
  const scenarioFilter =
    scenarioTrim.length > 0
      ? eq(
          pgSchema.twinRepeatabilityRecords.scenarioHash,
          hashTwinScenarioRepeatabilityHex(scenarioTrim).scenarioHashHex,
        )
      : undefined;

  const whereClause =
    scenarioFilter != null
      ? and(eq(pgSchema.twinRepeatabilityRecords.userId, userId), scenarioFilter)
      : eq(pgSchema.twinRepeatabilityRecords.userId, userId);

  const rows = await db
    .select({
      patternType: pgSchema.twinRepeatabilityRecords.patternType,
      occurrences: count(pgSchema.twinRepeatabilityRecords.id),
      lastSeenAt: max(pgSchema.twinRepeatabilityRecords.createdAt),
    })
    .from(pgSchema.twinRepeatabilityRecords)
    .where(whereClause)
    .groupBy(pgSchema.twinRepeatabilityRecords.patternType);

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
