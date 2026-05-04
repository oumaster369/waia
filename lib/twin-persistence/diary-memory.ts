import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { diaryEntries, scenarioAnswers } from "@/db/schema";
import {
  composeScenarioEmbedInput,
  embedTwinMemoryText,
  serializeEmbeddingJson,
  TWIN_MEMORY_EMBEDDING_MODEL_ID,
} from "@/lib/embeddings/twin-memory-embeddings";
import { ensureUserTwinSeed, type WaiaSqliteDb } from "@/lib/twin-persistence/loader";

/** Mirrors Twin dialogue POST body limit (characters). */
export const MAX_DIARY_BODY_CHARS = 16_384;
export const MAX_SCENARIO_KEY_CHARS = 256;
/** Max serialized JSON length for scenario `payload`. */
export const MAX_SCENARIO_PAYLOAD_JSON_CHARS = 16_384;

export type AppendDiaryEntryResult = {
  id: string;
  body: string;
  createdAt: Date;
  replayed: boolean;
};

export type AppendScenarioAnswerResult = {
  id: string;
  scenarioKey: string;
  payload: unknown;
  createdAt: Date;
  replayed: boolean;
};

export type DiaryMemoryRow = {
  id: string;
  body: string;
  /** ISO 8601 */
  createdAt: string;
};

export type ScenarioAnswerMemoryRow = {
  id: string;
  scenarioKey: string;
  payload: unknown;
  /** ISO 8601 */
  createdAt: string;
};

function normalizeIdempotencyKey(k: string | null | undefined): string | null {
  if (k == null || typeof k !== "string") {
    return null;
  }
  const trimmed = k.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * JSON.stringify for scenario storage; enforces max length.
 * Returns null when not serializable or too large.
 */
export function stringifyScenarioPayloadForStorage(payload: unknown): string | null {
  try {
    const json = JSON.stringify(payload);
    if (json.length > MAX_SCENARIO_PAYLOAD_JSON_CHARS) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

export function appendDiaryEntryForUser(
  db: WaiaSqliteDb,
  params: {
    userId: string;
    body: string;
    idempotencyKey?: string | null;
  },
): AppendDiaryEntryResult {
  const twinProfileId = ensureUserTwinSeed(db, params.userId);
  const body = params.body.trim();
  const idem = normalizeIdempotencyKey(params.idempotencyKey);

  return db.transaction((tx) => {
    const sqlite = tx as WaiaSqliteDb;
    if (idem) {
      const existing = sqlite
        .select({
          id: diaryEntries.id,
          body: diaryEntries.body,
          createdAt: diaryEntries.createdAt,
        })
        .from(diaryEntries)
        .where(and(eq(diaryEntries.userId, params.userId), eq(diaryEntries.idempotencyKey, idem)))
        .get();
      if (existing) {
        return {
          id: existing.id,
          body: existing.body ?? "",
          createdAt: existing.createdAt,
          replayed: true,
        };
      }
    }

    const id = crypto.randomUUID();
    const embeddingVec = embedTwinMemoryText(body);
    const embeddingJson = serializeEmbeddingJson(embeddingVec);
    const embeddingModel = embeddingVec ? TWIN_MEMORY_EMBEDDING_MODEL_ID : null;
    sqlite
      .insert(diaryEntries)
      .values({
        id,
        userId: params.userId,
        twinProfileId,
        body,
        idempotencyKey: idem,
        embeddingJson,
        embeddingModel,
      })
      .run();

    const row = sqlite
      .select({ createdAt: diaryEntries.createdAt })
      .from(diaryEntries)
      .where(eq(diaryEntries.id, id))
      .get();

    if (!row) {
      throw new Error("[waia] diary entry insert row missing after insert");
    }

    return {
      id,
      body,
      createdAt: row.createdAt,
      replayed: false,
    };
  });
}

export function appendScenarioAnswerForUser(
  db: WaiaSqliteDb,
  params: {
    userId: string;
    scenarioKey: string;
    payloadJson: string;
    idempotencyKey?: string | null;
  },
): AppendScenarioAnswerResult {
  const twinProfileId = ensureUserTwinSeed(db, params.userId);
  const idem = normalizeIdempotencyKey(params.idempotencyKey);

  return db.transaction((tx) => {
    const sqlite = tx as WaiaSqliteDb;
    if (idem) {
      const existing = sqlite
        .select({
          id: scenarioAnswers.id,
          scenarioKey: scenarioAnswers.scenarioKey,
          payloadJson: scenarioAnswers.payloadJson,
          createdAt: scenarioAnswers.createdAt,
        })
        .from(scenarioAnswers)
        .where(
          and(
            eq(scenarioAnswers.twinProfileId, twinProfileId),
            eq(scenarioAnswers.idempotencyKey, idem),
          ),
        )
        .get();
      if (existing) {
        return {
          id: existing.id,
          scenarioKey: existing.scenarioKey,
          payload: JSON.parse(existing.payloadJson) as unknown,
          createdAt: existing.createdAt,
          replayed: true,
        };
      }
    }

    const id = crypto.randomUUID();
    const scenarioEmbedIn = composeScenarioEmbedInput(params.scenarioKey, params.payloadJson);
    const embeddingVec = embedTwinMemoryText(scenarioEmbedIn);
    const embeddingJson = serializeEmbeddingJson(embeddingVec);
    const embeddingModel = embeddingVec ? TWIN_MEMORY_EMBEDDING_MODEL_ID : null;
    sqlite
      .insert(scenarioAnswers)
      .values({
        id,
        twinProfileId,
        scenarioKey: params.scenarioKey,
        payloadJson: params.payloadJson,
        idempotencyKey: idem,
        embeddingJson,
        embeddingModel,
      })
      .run();

    const row = sqlite
      .select({ createdAt: scenarioAnswers.createdAt })
      .from(scenarioAnswers)
      .where(eq(scenarioAnswers.id, id))
      .get();

    if (!row) {
      throw new Error("[waia] scenario answer insert row missing after insert");
    }

    return {
      id,
      scenarioKey: params.scenarioKey,
      payload: JSON.parse(params.payloadJson) as unknown,
      createdAt: row.createdAt,
      replayed: false,
    };
  });
}

export function listDiaryEntriesForUser(db: WaiaSqliteDb, userId: string): DiaryMemoryRow[] {
  ensureUserTwinSeed(db, userId);
  const rows = db
    .select({
      id: diaryEntries.id,
      body: diaryEntries.body,
      createdAt: diaryEntries.createdAt,
    })
    .from(diaryEntries)
    .where(eq(diaryEntries.userId, userId))
    .orderBy(asc(diaryEntries.createdAt))
    .all();

  return rows.map((r) => ({
    id: r.id,
    body: r.body ?? "",
    createdAt: r.createdAt.toISOString(),
  }));
}

export function listScenarioAnswersForUser(db: WaiaSqliteDb, userId: string): ScenarioAnswerMemoryRow[] {
  const twinProfileId = ensureUserTwinSeed(db, userId);
  const rows = db
    .select({
      id: scenarioAnswers.id,
      scenarioKey: scenarioAnswers.scenarioKey,
      payloadJson: scenarioAnswers.payloadJson,
      createdAt: scenarioAnswers.createdAt,
    })
    .from(scenarioAnswers)
    .where(eq(scenarioAnswers.twinProfileId, twinProfileId))
    .orderBy(asc(scenarioAnswers.createdAt))
    .all();

  return rows.map((r) => ({
    id: r.id,
    scenarioKey: r.scenarioKey,
    payload: JSON.parse(r.payloadJson) as unknown,
    createdAt: r.createdAt.toISOString(),
  }));
}
