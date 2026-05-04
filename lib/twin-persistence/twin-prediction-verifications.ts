import "server-only";

import { desc, eq } from "drizzle-orm";

import { twinPredictionVerifications } from "@/db/schema";
import type {
  TwinPredictionVerificationItemDto,
  TwinPredictionVerificationKind,
} from "@/lib/dashboard/twin-prediction-verification-api.types";
import { TWIN_PREDICTION_VERIFICATION_KINDS } from "@/lib/dashboard/twin-prediction-verification-api.types";
import { ensureUserTwinSeed, type WaiaSqliteDb } from "@/lib/twin-persistence/loader";

export const DEFAULT_VERIFICATION_LIST_LIMIT = 50;
export const MAX_VERIFICATION_LIST_LIMIT = 100;

const KIND_SET = new Set<string>(TWIN_PREDICTION_VERIFICATION_KINDS);

export function isTwinPredictionVerificationKind(
  value: string,
): value is TwinPredictionVerificationKind {
  return KIND_SET.has(value);
}

export function clampVerificationListLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) {
    return DEFAULT_VERIFICATION_LIST_LIMIT;
  }
  const n = Math.floor(limit);
  return Math.min(Math.max(1, n), MAX_VERIFICATION_LIST_LIMIT);
}

function normalizeOptionalPredictionId(predictionId: string | null | undefined): string | null {
  if (predictionId == null) {
    return null;
  }
  if (typeof predictionId !== "string") {
    return null;
  }
  const t = predictionId.trim();
  return t.length > 0 ? t : null;
}

function normalizeCorrection(correction: string | null | undefined): string | null {
  if (correction == null) {
    return null;
  }
  if (typeof correction !== "string") {
    return null;
  }
  const t = correction.trim();
  return t.length > 0 ? t : null;
}

function rowToDto(row: {
  id: string;
  predictionId: string | null;
  scenario: string;
  verification: string;
  correction: string | null;
  createdAt: Date;
}): TwinPredictionVerificationItemDto {
  if (!isTwinPredictionVerificationKind(row.verification)) {
    throw new Error(`[waia] invalid verification kind in row: ${row.verification}`);
  }
  return {
    id: row.id,
    predictionId: row.predictionId,
    scenario: row.scenario,
    verification: row.verification,
    correction: row.correction,
    createdAt: row.createdAt.toISOString(),
  };
}

export type AppendTwinPredictionVerificationInput = {
  predictionId?: string | null;
  /** Trimmed scenario (caller enforces non-empty and length). */
  scenario: string;
  verification: TwinPredictionVerificationKind;
  correction?: string | null;
};

/** Inserts one verification row; user-scoped via userId + seeded twin profile. */
export function appendTwinPredictionVerificationForUser(
  db: WaiaSqliteDb,
  userId: string,
  input: AppendTwinPredictionVerificationInput,
): TwinPredictionVerificationItemDto {
  const twinProfileId = ensureUserTwinSeed(db, userId);
  const predictionId = normalizeOptionalPredictionId(input.predictionId);
  const correction = normalizeCorrection(input.correction);

  const id = crypto.randomUUID();

  db.insert(twinPredictionVerifications)
    .values({
      id,
      userId,
      twinProfileId,
      predictionId,
      scenario: input.scenario,
      verification: input.verification,
      correction,
    })
    .run();

  const row = db
    .select({
      id: twinPredictionVerifications.id,
      predictionId: twinPredictionVerifications.predictionId,
      scenario: twinPredictionVerifications.scenario,
      verification: twinPredictionVerifications.verification,
      correction: twinPredictionVerifications.correction,
      createdAt: twinPredictionVerifications.createdAt,
    })
    .from(twinPredictionVerifications)
    .where(eq(twinPredictionVerifications.id, id))
    .get();

  if (!row) {
    throw new Error("[waia] twin prediction verification insert missing after insert");
  }

  return rowToDto(row);
}

/** Latest verifications for user only, created_at descending. */
export function listTwinPredictionVerificationsForUser(
  db: WaiaSqliteDb,
  userId: string,
  limit?: number,
): TwinPredictionVerificationItemDto[] {
  const lim = clampVerificationListLimit(limit);

  const rows = db
    .select({
      id: twinPredictionVerifications.id,
      predictionId: twinPredictionVerifications.predictionId,
      scenario: twinPredictionVerifications.scenario,
      verification: twinPredictionVerifications.verification,
      correction: twinPredictionVerifications.correction,
      createdAt: twinPredictionVerifications.createdAt,
    })
    .from(twinPredictionVerifications)
    .where(eq(twinPredictionVerifications.userId, userId))
    .orderBy(desc(twinPredictionVerifications.createdAt))
    .limit(lim)
    .all();

  return rows.map((r) => rowToDto(r));
}
