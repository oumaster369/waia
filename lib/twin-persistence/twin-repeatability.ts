import "server-only";

import { createHash } from "node:crypto";

import { and, count, desc, eq, gte } from "drizzle-orm";

import { twinRepeatabilityRecords } from "@/db/schema";
import type { TwinPredictionVerificationKind } from "@/lib/dashboard/twin-prediction-verification-api.types";
import { ensureUserTwinSeed, type WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import { normalizeTwinPredictionScenario, runTwinPredictionForUser } from "@/lib/reasoning/twin-prediction";

/** Dedup guard: skip insert when the same tuple was recorded within this window. */
export const TWIN_REPEATABILITY_DEDUP_WINDOW_MS = 60_000;

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

/** Ordered rules: first scenario keyword match wins. */
const PATTERN_RULES: { patternType: string; includes: string[] }[] = [
  { patternType: "avoidance", includes: ["avoid", "evade", "withdraw", "skip"] },
  {
    patternType: "delay",
    includes: ["delay", "deadline", "procrastin", "postpone", "later", "overdue", "sprint", "timeline"],
  },
  {
    patternType: "conflict_loop",
    includes: ["conflict", "fight", "argument", "tension", "dispute"],
  },
];

export type TwinRepeatabilityRecordDto = {
  id: string;
  userId: string;
  twinProfileId: string;
  scenarioHash: string;
  patternType: string;
  predictionOutcome: string;
  verificationResult: TwinPredictionVerificationKind;
  createdAt: string;
};

export type AppendRepeatabilityRecordInput = {
  scenarioTrimmed: string;
  verificationResult: TwinPredictionVerificationKind;
  /**
   * When set, skips running forward prediction (tests / callers that already have outcome text).
   * Otherwise `runTwinPredictionForUser` supplies the outcome string.
   */
  predictionOutcomeOverride?: string;
};

export type AppendRepeatabilityRecordResult =
  | { status: "inserted"; id: string }
  | { status: "deduped" };

export function hashTwinScenarioRepeatabilityHex(scenarioTrimmed: string): {
  normalized: string;
  scenarioHashHex: string;
} {
  const normalized = normalizeTwinPredictionScenario(scenarioTrimmed);
  const scenarioHashHex = createHash("sha256").update(normalized, "utf8").digest("hex");
  return { normalized, scenarioHashHex };
}

export function inferRepeatabilityPatternType(normalizedScenario: string): string {
  for (const rule of PATTERN_RULES) {
    for (const kw of rule.includes) {
      if (normalizedScenario.includes(kw)) {
        return rule.patternType;
      }
    }
  }
  return "general_pattern";
}

function clampListLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) {
    return DEFAULT_LIST_LIMIT;
  }
  const n = Math.floor(limit);
  return Math.min(Math.max(1, n), MAX_LIST_LIMIT);
}

function hasRecentDedupDuplicate(
  db: WaiaSqliteDb,
  userId: string,
  scenarioHash: string,
  patternType: string,
  verificationResult: TwinPredictionVerificationKind,
): boolean {
  const cutoff = new Date(Date.now() - TWIN_REPEATABILITY_DEDUP_WINDOW_MS);
  const row = db
    .select({ id: twinRepeatabilityRecords.id })
    .from(twinRepeatabilityRecords)
    .where(
      and(
        eq(twinRepeatabilityRecords.userId, userId),
        eq(twinRepeatabilityRecords.scenarioHash, scenarioHash),
        eq(twinRepeatabilityRecords.patternType, patternType),
        eq(twinRepeatabilityRecords.verificationResult, verificationResult),
        gte(twinRepeatabilityRecords.createdAt, cutoff),
      ),
    )
    .limit(1)
    .get();
  return row != null;
}

/** Inserts one repeatability row unless deduped in the recent window. */
export function appendRepeatabilityRecordForUser(
  db: WaiaSqliteDb,
  userId: string,
  input: AppendRepeatabilityRecordInput,
): AppendRepeatabilityRecordResult {
  const twinProfileId = ensureUserTwinSeed(db, userId);
  const { normalized, scenarioHashHex } = hashTwinScenarioRepeatabilityHex(input.scenarioTrimmed);
  const patternType = inferRepeatabilityPatternType(normalized);

  if (
    hasRecentDedupDuplicate(db, userId, scenarioHashHex, patternType, input.verificationResult)
  ) {
    return { status: "deduped" };
  }

  const predictionOutcome =
    input.predictionOutcomeOverride ?? runTwinPredictionForUser(db, userId, input.scenarioTrimmed).outcome;

  const id = crypto.randomUUID();
  db.insert(twinRepeatabilityRecords)
    .values({
      id,
      userId,
      twinProfileId,
      scenarioHash: scenarioHashHex,
      patternType,
      predictionOutcome,
      verificationResult: input.verificationResult,
      createdAt: new Date(),
    })
    .run();
  return { status: "inserted", id };
}

export type ListRepeatabilityRecordsOpts = {
  limit?: number;
};

export function listRepeatabilityRecordsForUser(
  db: WaiaSqliteDb,
  userId: string,
  opts?: ListRepeatabilityRecordsOpts,
): TwinRepeatabilityRecordDto[] {
  const lim = clampListLimit(opts?.limit);
  const rows = db
    .select()
    .from(twinRepeatabilityRecords)
    .where(eq(twinRepeatabilityRecords.userId, userId))
    .orderBy(desc(twinRepeatabilityRecords.createdAt))
    .limit(lim)
    .all();

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    twinProfileId: r.twinProfileId,
    scenarioHash: r.scenarioHash,
    patternType: r.patternType,
    predictionOutcome: r.predictionOutcome,
    verificationResult: r.verificationResult as TwinPredictionVerificationKind,
    createdAt: r.createdAt.toISOString(),
  }));
}

export function countRepeatabilityForPattern(
  db: WaiaSqliteDb,
  userId: string,
  patternType: string,
  scenarioHash: string,
): number {
  const row = db
    .select({ n: count() })
    .from(twinRepeatabilityRecords)
    .where(
      and(
        eq(twinRepeatabilityRecords.userId, userId),
        eq(twinRepeatabilityRecords.patternType, patternType),
        eq(twinRepeatabilityRecords.scenarioHash, scenarioHash),
      ),
    )
    .get();
  return row?.n ?? 0;
}

/**
 * Best-effort recording after a persisted verification. Swallows errors so the verification API
 * stays responsive if prediction or insert fails.
 */
export function recordRepeatabilityAfterVerification(
  db: WaiaSqliteDb,
  userId: string,
  input: { scenarioTrimmed: string; verification: TwinPredictionVerificationKind },
): void {
  try {
    appendRepeatabilityRecordForUser(db, userId, {
      scenarioTrimmed: input.scenarioTrimmed,
      verificationResult: input.verification,
    });
  } catch {
    /* best-effort: verification row already committed */
  }
}
