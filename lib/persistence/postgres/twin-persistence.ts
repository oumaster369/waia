import "server-only";

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import type { DashboardReadinessPayload } from "@/lib/dashboard/dashboard-readiness-api.types";
import type {
  TwinPredictionVerificationItemDto,
  TwinPredictionVerificationKind,
  TwinPredictionVerificationSubmitBody,
} from "@/lib/dashboard/twin-prediction-verification-api.types";
import { TWIN_PREDICTION_VERIFICATION_KINDS } from "@/lib/dashboard/twin-prediction-verification-api.types";
import type { TwinDialogueSignals } from "@/lib/dashboard/readiness-snapshot-default";
import { DEFAULT_READINESS_INPUT } from "@/lib/dashboard/readiness-snapshot-default";
import { NULL_HINTS_BY_INDICATOR } from "@/lib/dashboard/null-hints";
import {
  composeTwinDialogueTurnEmbedInput,
  composeScenarioEmbedInput,
  cosineSimilarity,
  embedTwinMemoryText,
  parseEmbeddingJson,
  serializeEmbeddingJson,
  TWIN_MEMORY_EMBEDDING_MODEL_ID,
} from "@/lib/embeddings/twin-memory-embeddings";
import { parseIndicatorVector } from "@/lib/readiness/readiness";
import type { ReadinessInput } from "@/lib/readiness/types";
import * as pgSchema from "@/db/schema.postgres";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import {
  ReadinessSerializationError,
  type AppendTwinDialogueTurnResult,
  type PersistUserTwinExchangeWithAssistantResult,
  type TwinDialogueMemoryRow,
  type TwinDialogueTurnDbRow,
} from "@/lib/twin-persistence/loader";
import {
  stringifyScenarioPayloadForStorage,
  MAX_DIARY_BODY_CHARS,
  MAX_SCENARIO_KEY_CHARS,
  MAX_SCENARIO_PAYLOAD_JSON_CHARS,
  type AppendDiaryEntryResult,
  type AppendScenarioAnswerResult,
  type DiaryMemoryRow,
  type ScenarioAnswerMemoryRow,
} from "@/lib/twin-persistence/diary-memory";

export type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

export {
  MAX_DIARY_BODY_CHARS,
  MAX_SCENARIO_KEY_CHARS,
  MAX_SCENARIO_PAYLOAD_JSON_CHARS,
};

type PgTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];

/**
 * Mirrors `TwinMemorySearchHit` in `lib/twin-persistence/twin-memory-retrieval.ts` (DEE-72.3 —
 * do not import that module here).
 */
export type TwinMemorySearchHit = {
  source: "dialogue" | "diary" | "scenario";
  id: string;
  /** Cosine similarity in approximately [-1, 1]; higher is closer. */
  score: number;
  previewText: string;
};

/** Mirrors `MAX_TOP_N` in `twin-memory-retrieval.ts` — keep in sync manually. */
const TWIN_MEMORY_SEARCH_MAX_TOP_N = 100;
/** Diary preview cap — mirrors SQLite `twin-memory-retrieval.ts`. */
const TWIN_MEMORY_DIARY_PREVIEW_MAX_CHARS = 200;
const TWIN_MEMORY_DIARY_PREVIEW_SLICE_END = 197;
/** Scenario payload preview cap — mirrors SQLite. */
const TWIN_MEMORY_SCENARIO_PAYLOAD_PREVIEW_MAX_CHARS = 160;
const TWIN_MEMORY_SCENARIO_PAYLOAD_PREVIEW_SLICE_END = 157;

function twinMemoryEmbeddingJsonToParseString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const t = value.trim();
    return t.length === 0 ? null : value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function scenarioPayloadJsonForMemoryPreview(payloadJson: unknown): string {
  if (typeof payloadJson === "string") {
    return payloadJson;
  }
  try {
    return JSON.stringify(payloadJson);
  } catch {
    return "";
  }
}

async function resolveExistingTwinProfileIdPg(
  db: WaiaPostgresDb,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: pgSchema.twinProfiles.id })
    .from(pgSchema.twinProfiles)
    .where(eq(pgSchema.twinProfiles.userId, userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Read-only; no seed, no transactions (DEE-72.3). Semantics mirror SQLite `searchTwinMemoriesByText`. */
async function searchTwinMemoriesByTextPg(
  db: WaiaPostgresDb,
  userId: string,
  queryText: string,
  topN?: number,
): Promise<TwinMemorySearchHit[]> {
  const queryVec = embedTwinMemoryText(queryText);
  if (queryVec === null) {
    return [];
  }

  const limit = Number.isFinite(topN)
    ? Math.min(Math.max(1, Math.floor(topN as number)), TWIN_MEMORY_SEARCH_MAX_TOP_N)
    : 10;

  const twinProfileId = await resolveExistingTwinProfileIdPg(db, userId);
  const candidates: TwinMemorySearchHit[] = [];

  if (twinProfileId !== null) {
    const turns = await db
      .select({
        id: pgSchema.twinDialogueTurns.id,
        role: pgSchema.twinDialogueTurns.role,
        content: pgSchema.twinDialogueTurns.content,
        embeddingJson: pgSchema.twinDialogueTurns.embeddingJson,
      })
      .from(pgSchema.twinDialogueTurns)
      .where(
        and(
          eq(pgSchema.twinDialogueTurns.twinProfileId, twinProfileId),
          isNotNull(pgSchema.twinDialogueTurns.embeddingJson),
        ),
      );

    for (const t of turns) {
      const raw = twinMemoryEmbeddingJsonToParseString(t.embeddingJson);
      const v = raw === null ? null : parseEmbeddingJson(raw);
      if (v === null) {
        continue;
      }
      const score = cosineSimilarity(queryVec, v);
      candidates.push({
        source: "dialogue",
        id: t.id,
        score,
        previewText: `${t.role}: ${t.content}`,
      });
    }
  }

  const diaries = await db
    .select({
      id: pgSchema.diaryEntries.id,
      body: pgSchema.diaryEntries.body,
      embeddingJson: pgSchema.diaryEntries.embeddingJson,
    })
    .from(pgSchema.diaryEntries)
    .where(
      and(eq(pgSchema.diaryEntries.userId, userId), isNotNull(pgSchema.diaryEntries.embeddingJson)),
    );

  for (const d of diaries) {
    const raw = twinMemoryEmbeddingJsonToParseString(d.embeddingJson);
    const v = raw === null ? null : parseEmbeddingJson(raw);
    if (v === null) {
      continue;
    }
    const score = cosineSimilarity(queryVec, v);
    const body = d.body ?? "";
    candidates.push({
      source: "diary",
      id: d.id,
      score,
      previewText:
        body.length > TWIN_MEMORY_DIARY_PREVIEW_MAX_CHARS
          ? `${body.slice(0, TWIN_MEMORY_DIARY_PREVIEW_SLICE_END)}…`
          : body,
    });
  }

  if (twinProfileId !== null) {
    const scenarios = await db
      .select({
        id: pgSchema.scenarioAnswers.id,
        scenarioKey: pgSchema.scenarioAnswers.scenarioKey,
        payloadJson: pgSchema.scenarioAnswers.payloadJson,
        embeddingJson: pgSchema.scenarioAnswers.embeddingJson,
      })
      .from(pgSchema.scenarioAnswers)
      .where(
        and(
          eq(pgSchema.scenarioAnswers.twinProfileId, twinProfileId),
          isNotNull(pgSchema.scenarioAnswers.embeddingJson),
        ),
      );

    for (const s of scenarios) {
      const raw = twinMemoryEmbeddingJsonToParseString(s.embeddingJson);
      const v = raw === null ? null : parseEmbeddingJson(raw);
      if (v === null) {
        continue;
      }
      const score = cosineSimilarity(queryVec, v);
      const pj = scenarioPayloadJsonForMemoryPreview(s.payloadJson);
      const truncated =
        pj.length > TWIN_MEMORY_SCENARIO_PAYLOAD_PREVIEW_MAX_CHARS
          ? `${pj.slice(0, TWIN_MEMORY_SCENARIO_PAYLOAD_PREVIEW_SLICE_END)}…`
          : pj;
      candidates.push({
        source: "scenario",
        id: s.id,
        score,
        previewText: `${s.scenarioKey}: ${truncated}`,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

/** Mirrors `lib/twin-persistence/twin-prediction-verifications.ts` (DEE-72.2 — avoid SQLite import). */
const DEFAULT_VERIFICATION_LIST_LIMIT = 50;
const MAX_VERIFICATION_LIST_LIMIT = 100;
const PREDICTION_VERIFICATION_KIND_SET = new Set<string>(TWIN_PREDICTION_VERIFICATION_KINDS);

function isTwinPredictionVerificationKindPg(value: string): value is TwinPredictionVerificationKind {
  return PREDICTION_VERIFICATION_KIND_SET.has(value);
}

function clampVerificationListLimitPg(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) {
    return DEFAULT_VERIFICATION_LIST_LIMIT;
  }
  const n = Math.floor(limit);
  return Math.min(Math.max(1, n), MAX_VERIFICATION_LIST_LIMIT);
}

function normalizeOptionalPredictionIdPg(predictionId: string | null | undefined): string | null {
  if (predictionId == null) {
    return null;
  }
  if (typeof predictionId !== "string") {
    return null;
  }
  const t = predictionId.trim();
  return t.length > 0 ? t : null;
}

function normalizeCorrectionPg(correction: string | null | undefined): string | null {
  if (correction == null) {
    return null;
  }
  if (typeof correction !== "string") {
    return null;
  }
  const t = correction.trim();
  return t.length > 0 ? t : null;
}

function predictionVerificationRowToDtoPg(row: {
  id: string;
  predictionId: string | null;
  scenario: string;
  verification: string;
  correction: string | null;
  createdAt: Date;
}): TwinPredictionVerificationItemDto {
  if (!isTwinPredictionVerificationKindPg(row.verification)) {
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

function normalizeIdempotencyKey(k: string | null | undefined): string | null {
  if (k == null || typeof k !== "string") {
    return null;
  }
  const trimmed = k.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function rowToReadinessInputFromDb(
  indicatorsJson: unknown,
  socializationCompleted: boolean,
  finalStateMessageShown: boolean,
): ReadinessInput {
  const parsed =
    typeof indicatorsJson === "string" ? (JSON.parse(indicatorsJson) as unknown) : indicatorsJson;
  if (!Array.isArray(parsed) || parsed.length !== 6) {
    throw new ReadinessSerializationError(
      `indicators_json must be a JSON array of length 6, got ${JSON.stringify(parsed)}.`,
    );
  }
  const indicators = parseIndicatorVector(parsed as Iterable<number>);
  return {
    indicators,
    socializationCompleted,
    finalStateMessageShown,
  };
}

/**
 * Idempotent twin profile + readiness inside a Postgres transaction (DEE-72.1).
 */
async function ensureUserTwinSeedInsideExecutorPg(tx: PgTx, userId: string): Promise<string> {
  const existingTwinRows = await tx
    .select({ id: pgSchema.twinProfiles.id })
    .from(pgSchema.twinProfiles)
    .where(eq(pgSchema.twinProfiles.userId, userId))
    .limit(1);

  const existingTwin = existingTwinRows[0];

  const twinId =
    existingTwin?.id ??
    (await (async () => {
      const id = crypto.randomUUID();
      await tx.insert(pgSchema.twinProfiles).values({ id, userId });
      return id;
    })());

  const stateRows = await tx
    .select({ twinProfileId: pgSchema.twinReadinessState.twinProfileId })
    .from(pgSchema.twinReadinessState)
    .where(eq(pgSchema.twinReadinessState.twinProfileId, twinId))
    .limit(1);

  if (!stateRows[0]) {
    await tx.insert(pgSchema.twinReadinessState).values({
      twinProfileId: twinId,
      indicatorsJson: DEFAULT_READINESS_INPUT.indicators,
      socializationCompleted: DEFAULT_READINESS_INPUT.socializationCompleted,
      finalStateMessageShown: DEFAULT_READINESS_INPUT.finalStateMessageShown,
    });
  }

  return twinId;
}

async function appendTwinDialogueTurnInsideExecutorPg(
  ex: PgTx,
  params: {
    twinProfileId: string;
    role: "user" | "assistant" | "system";
    content: string;
    idempotencyKey?: string | null;
  },
): Promise<AppendTwinDialogueTurnResult> {
  if (params.idempotencyKey != null && params.idempotencyKey !== "") {
    const existingRows = await ex
      .select({
        id: pgSchema.twinDialogueTurns.id,
        sequence: pgSchema.twinDialogueTurns.sequence,
        createdAt: pgSchema.twinDialogueTurns.createdAt,
        content: pgSchema.twinDialogueTurns.content,
      })
      .from(pgSchema.twinDialogueTurns)
      .where(
        and(
          eq(pgSchema.twinDialogueTurns.twinProfileId, params.twinProfileId),
          eq(pgSchema.twinDialogueTurns.idempotencyKey, params.idempotencyKey),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (existing) {
      return {
        id: existing.id,
        sequence: existing.sequence,
        createdAt: existing.createdAt,
        content: existing.content,
        replayed: true,
      };
    }
  }

  const id = crypto.randomUUID();

  const aggRows = await ex
    .select({
      maxSeq: sql<number>`coalesce(max(${pgSchema.twinDialogueTurns.sequence}), 0)`.mapWith(Number),
    })
    .from(pgSchema.twinDialogueTurns)
    .where(eq(pgSchema.twinDialogueTurns.twinProfileId, params.twinProfileId));

  const nextSeq = Number(aggRows[0]?.maxSeq ?? 0) + 1;

  const embedInput = composeTwinDialogueTurnEmbedInput(params.role, params.content);
  const embeddingVec = embedTwinMemoryText(embedInput);
  const embeddingJson = serializeEmbeddingJson(embeddingVec);
  const embeddingModel = embeddingVec ? TWIN_MEMORY_EMBEDDING_MODEL_ID : null;

  await ex.insert(pgSchema.twinDialogueTurns).values({
    id,
    twinProfileId: params.twinProfileId,
    sequence: nextSeq,
    role: params.role,
    content: params.content,
    idempotencyKey: params.idempotencyKey ?? null,
    embeddingJson,
    embeddingModel,
  });

  const rowRows = await ex
    .select({
      createdAt: pgSchema.twinDialogueTurns.createdAt,
    })
    .from(pgSchema.twinDialogueTurns)
    .where(eq(pgSchema.twinDialogueTurns.id, id))
    .limit(1);

  const row = rowRows[0];

  if (!row) {
    throw new Error("[waia] twin dialogue insert row missing immediately after insert");
  }

  return {
    id,
    sequence: nextSeq,
    createdAt: row.createdAt,
    content: params.content,
    replayed: false,
  };
}

async function appendTwinDialogueTurnResultPg(
  db: WaiaPostgresDb,
  params: {
    twinProfileId: string;
    role: "user" | "assistant" | "system";
    content: string;
    idempotencyKey?: string | null;
  },
): Promise<AppendTwinDialogueTurnResult> {
  return runWaiaPostgresTransaction(db, async (tx) =>
    appendTwinDialogueTurnInsideExecutorPg(tx, params),
  );
}

async function persistUserTwinExchangeWithAssistantStubPg(
  db: WaiaPostgresDb,
  params: {
    twinProfileId: string;
    userContent: string;
    userIdempotencyKey?: string | null;
    assistantContent: string;
  },
): Promise<PersistUserTwinExchangeWithAssistantResult> {
  return runWaiaPostgresTransaction(db, async (tx) => {
    const userTurn = await appendTwinDialogueTurnInsideExecutorPg(tx, {
      twinProfileId: params.twinProfileId,
      role: "user",
      content: params.userContent,
      idempotencyKey: params.userIdempotencyKey ?? null,
    });

    let assistantTurn: AppendTwinDialogueTurnResult | null = null;
    if (!userTurn.replayed) {
      assistantTurn = await appendTwinDialogueTurnInsideExecutorPg(tx, {
        twinProfileId: params.twinProfileId,
        role: "assistant",
        content: params.assistantContent,
        idempotencyKey: `${userTurn.id}:assistant`,
      });
    }

    return { userTurn, assistantTurn };
  });
}

async function appendTwinDialogueTurnPg(
  db: WaiaPostgresDb,
  params: {
    twinProfileId: string;
    role: "user" | "assistant" | "system";
    content: string;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  await appendTwinDialogueTurnResultPg(db, params);
}

async function countUserDialogueTurnsPg(db: WaiaPostgresDb, twinProfileId: string): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)`.mapWith(Number) })
    .from(pgSchema.twinDialogueTurns)
    .where(
      and(
        eq(pgSchema.twinDialogueTurns.twinProfileId, twinProfileId),
        eq(pgSchema.twinDialogueTurns.role, "user"),
      ),
    );
  return rows[0]?.c ?? 0;
}

async function listTwinDialogueTurnsChronologicalPg(
  db: WaiaPostgresDb,
  twinProfileId: string,
): Promise<TwinDialogueTurnDbRow[]> {
  return await db
    .select({
      id: pgSchema.twinDialogueTurns.id,
      sequence: pgSchema.twinDialogueTurns.sequence,
      role: pgSchema.twinDialogueTurns.role,
      content: pgSchema.twinDialogueTurns.content,
      idempotencyKey: pgSchema.twinDialogueTurns.idempotencyKey,
      createdAt: pgSchema.twinDialogueTurns.createdAt,
    })
    .from(pgSchema.twinDialogueTurns)
    .where(eq(pgSchema.twinDialogueTurns.twinProfileId, twinProfileId))
    .orderBy(pgSchema.twinDialogueTurns.sequence);
}

async function ensureUserTwinSeedPg(db: WaiaPostgresDb, userId: string): Promise<string> {
  return runWaiaPostgresTransaction(db, async (tx) => ensureUserTwinSeedInsideExecutorPg(tx, userId));
}

async function listTwinDialogueTurnsForUserPg(
  db: WaiaPostgresDb,
  userId: string,
): Promise<TwinDialogueMemoryRow[]> {
  const twinProfileId = await ensureUserTwinSeedPg(db, userId);
  const rows = await listTwinDialogueTurnsChronologicalPg(db, twinProfileId);
  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function loadDashboardReadinessPayloadFromDbPg(
  db: WaiaPostgresDb,
  userId: string,
): Promise<DashboardReadinessPayload> {
  await ensureUserTwinSeedPg(db, userId);

  const rows = await db
    .select({
      indicatorsJson: pgSchema.twinReadinessState.indicatorsJson,
      socializationCompleted: pgSchema.twinReadinessState.socializationCompleted,
      finalStateMessageShown: pgSchema.twinReadinessState.finalStateMessageShown,
      identityLabel: pgSchema.users.identityLabel,
      twinProfileId: pgSchema.twinProfiles.id,
    })
    .from(pgSchema.users)
    .innerJoin(pgSchema.twinProfiles, eq(pgSchema.twinProfiles.userId, pgSchema.users.id))
    .innerJoin(
      pgSchema.twinReadinessState,
      eq(pgSchema.twinReadinessState.twinProfileId, pgSchema.twinProfiles.id),
    )
    .where(eq(pgSchema.users.id, userId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    throw new Error(`[waia] twin readiness row missing for user ${userId} after seed`);
  }

  const readinessInput = rowToReadinessInputFromDb(
    row.indicatorsJson,
    row.socializationCompleted,
    row.finalStateMessageShown,
  );
  const userTurnCount = await countUserDialogueTurnsPg(db, row.twinProfileId);
  const twinSignals: TwinDialogueSignals = {
    hasMeaningfulExchange: userTurnCount > 0,
  };

  return {
    readinessInput,
    twinSignals,
    identityLabel: row.identityLabel,
    hintsByIndicator: NULL_HINTS_BY_INDICATOR,
  };
}

async function appendDiaryEntryForUserPg(
  db: WaiaPostgresDb,
  params: {
    userId: string;
    body: string;
    idempotencyKey?: string | null;
  },
): Promise<AppendDiaryEntryResult> {
  const body = params.body.trim();
  const idem = normalizeIdempotencyKey(params.idempotencyKey);
  const userId = params.userId;

  return runWaiaPostgresTransaction(db, async (tx) => {
    const twinProfileId = await ensureUserTwinSeedInsideExecutorPg(tx, userId);

    if (idem) {
      const existingRows = await tx
        .select({
          id: pgSchema.diaryEntries.id,
          body: pgSchema.diaryEntries.body,
          createdAt: pgSchema.diaryEntries.createdAt,
        })
        .from(pgSchema.diaryEntries)
        .where(and(eq(pgSchema.diaryEntries.userId, userId), eq(pgSchema.diaryEntries.idempotencyKey, idem)))
        .limit(1);
      const existing = existingRows[0];
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

    await tx.insert(pgSchema.diaryEntries).values({
      id,
      userId,
      twinProfileId,
      body,
      idempotencyKey: idem,
      embeddingJson,
      embeddingModel,
    });

    const rowRows = await tx
      .select({ createdAt: pgSchema.diaryEntries.createdAt })
      .from(pgSchema.diaryEntries)
      .where(eq(pgSchema.diaryEntries.id, id))
      .limit(1);

    const row = rowRows[0];

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

async function appendScenarioAnswerForUserPg(
  db: WaiaPostgresDb,
  params: {
    userId: string;
    scenarioKey: string;
    payloadJson: string;
    idempotencyKey?: string | null;
  },
): Promise<AppendScenarioAnswerResult> {
  const idem = normalizeIdempotencyKey(params.idempotencyKey);
  const scenarioKeyParam = params.scenarioKey;
  const payloadJsonParam = params.payloadJson;

  return runWaiaPostgresTransaction(db, async (tx) => {
    const twinProfileId = await ensureUserTwinSeedInsideExecutorPg(tx, params.userId);

    if (idem) {
      const existingRows = await tx
        .select({
          id: pgSchema.scenarioAnswers.id,
          scenarioKey: pgSchema.scenarioAnswers.scenarioKey,
          payloadJson: pgSchema.scenarioAnswers.payloadJson,
          createdAt: pgSchema.scenarioAnswers.createdAt,
        })
        .from(pgSchema.scenarioAnswers)
        .where(
          and(
            eq(pgSchema.scenarioAnswers.twinProfileId, twinProfileId),
            eq(pgSchema.scenarioAnswers.idempotencyKey, idem),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        return {
          id: existing.id,
          scenarioKey: existing.scenarioKey,
          payload:
            typeof existing.payloadJson === "string"
              ? (JSON.parse(existing.payloadJson) as unknown)
              : (existing.payloadJson as unknown),
          createdAt: existing.createdAt,
          replayed: true,
        };
      }
    }

    const id = crypto.randomUUID();
    const scenarioEmbedIn = composeScenarioEmbedInput(scenarioKeyParam, payloadJsonParam);
    const embeddingVec = embedTwinMemoryText(scenarioEmbedIn);
    const embeddingJson = serializeEmbeddingJson(embeddingVec);
    const embeddingModel = embeddingVec ? TWIN_MEMORY_EMBEDDING_MODEL_ID : null;

    await tx.insert(pgSchema.scenarioAnswers).values({
      id,
      twinProfileId,
      scenarioKey: scenarioKeyParam,
      payloadJson: payloadJsonParam,
      idempotencyKey: idem,
      embeddingJson,
      embeddingModel,
    });

    const rowRows = await tx
      .select({ createdAt: pgSchema.scenarioAnswers.createdAt })
      .from(pgSchema.scenarioAnswers)
      .where(eq(pgSchema.scenarioAnswers.id, id))
      .limit(1);

    const row = rowRows[0];

    if (!row) {
      throw new Error("[waia] scenario answer insert row missing after insert");
    }

    return {
      id,
      scenarioKey: scenarioKeyParam,
      payload: JSON.parse(payloadJsonParam) as unknown,
      createdAt: row.createdAt,
      replayed: false,
    };
  });
}

async function listDiaryEntriesForUserPg(
  db: WaiaPostgresDb,
  userId: string,
): Promise<DiaryMemoryRow[]> {
  await ensureUserTwinSeedPg(db, userId);
  const rows = await db
    .select({
      id: pgSchema.diaryEntries.id,
      body: pgSchema.diaryEntries.body,
      createdAt: pgSchema.diaryEntries.createdAt,
    })
    .from(pgSchema.diaryEntries)
    .where(eq(pgSchema.diaryEntries.userId, userId))
    .orderBy(asc(pgSchema.diaryEntries.createdAt));

  return rows.map((r) => ({
    id: r.id,
    body: r.body ?? "",
    createdAt: r.createdAt.toISOString(),
  }));
}

async function listScenarioAnswersForUserPg(
  db: WaiaPostgresDb,
  userId: string,
): Promise<ScenarioAnswerMemoryRow[]> {
  const twinProfileId = await ensureUserTwinSeedPg(db, userId);
  const rows = await db
    .select({
      id: pgSchema.scenarioAnswers.id,
      scenarioKey: pgSchema.scenarioAnswers.scenarioKey,
      payloadJson: pgSchema.scenarioAnswers.payloadJson,
      createdAt: pgSchema.scenarioAnswers.createdAt,
    })
    .from(pgSchema.scenarioAnswers)
    .where(eq(pgSchema.scenarioAnswers.twinProfileId, twinProfileId))
    .orderBy(asc(pgSchema.scenarioAnswers.createdAt));

  return rows.map((r) => ({
    id: r.id,
    scenarioKey: r.scenarioKey,
    payload:
      typeof r.payloadJson === "string"
        ? (JSON.parse(r.payloadJson) as unknown)
        : (r.payloadJson as unknown),
    createdAt: r.createdAt.toISOString(),
  }));
}

async function appendTwinPredictionVerificationForUserPg(
  db: WaiaPostgresDb,
  params: { userId: string } & TwinPredictionVerificationSubmitBody,
): Promise<TwinPredictionVerificationItemDto> {
  const userId = params.userId;
  const predictionId = normalizeOptionalPredictionIdPg(params.predictionId);
  const correction = normalizeCorrectionPg(params.correction);

  return runWaiaPostgresTransaction(db, async (tx) => {
    const twinProfileId = await ensureUserTwinSeedInsideExecutorPg(tx, userId);
    const id = crypto.randomUUID();

    await tx.insert(pgSchema.twinPredictionVerifications).values({
      id,
      userId,
      twinProfileId,
      predictionId,
      scenario: params.scenario,
      verification: params.verification,
      correction,
    });

    const rowRows = await tx
      .select({
        id: pgSchema.twinPredictionVerifications.id,
        predictionId: pgSchema.twinPredictionVerifications.predictionId,
        scenario: pgSchema.twinPredictionVerifications.scenario,
        verification: pgSchema.twinPredictionVerifications.verification,
        correction: pgSchema.twinPredictionVerifications.correction,
        createdAt: pgSchema.twinPredictionVerifications.createdAt,
      })
      .from(pgSchema.twinPredictionVerifications)
      .where(eq(pgSchema.twinPredictionVerifications.id, id))
      .limit(1);

    const row = rowRows[0];

    if (!row) {
      throw new Error("[waia] twin prediction verification insert missing after insert");
    }

    return predictionVerificationRowToDtoPg(row);
  });
}

async function listTwinPredictionVerificationsForUserPg(
  db: WaiaPostgresDb,
  userId: string,
  limit?: number,
): Promise<TwinPredictionVerificationItemDto[]> {
  const lim = clampVerificationListLimitPg(limit);

  const rows = await db
    .select({
      id: pgSchema.twinPredictionVerifications.id,
      predictionId: pgSchema.twinPredictionVerifications.predictionId,
      scenario: pgSchema.twinPredictionVerifications.scenario,
      verification: pgSchema.twinPredictionVerifications.verification,
      correction: pgSchema.twinPredictionVerifications.correction,
      createdAt: pgSchema.twinPredictionVerifications.createdAt,
    })
    .from(pgSchema.twinPredictionVerifications)
    .where(eq(pgSchema.twinPredictionVerifications.userId, userId))
    .orderBy(desc(pgSchema.twinPredictionVerifications.createdAt))
    .limit(lim);

  return rows.map((r) => predictionVerificationRowToDtoPg(r));
}

/**
 * Postgres AI-Twin / diary persistence boundary (DEE-72.1, DEE-72.2, DEE-72.3).
 * Async semantics; transactional writes use {@link runWaiaPostgresTransaction}.
 * Memory search is read-only and does not use that helper.
 */
export type PostgresTwinPersistence = {
  readonly db: WaiaPostgresDb;
  ensureUserTwinSeed: (userId: string) => Promise<string>;
  appendTwinDialogueTurnResult: (params: {
    twinProfileId: string;
    role: "user" | "assistant" | "system";
    content: string;
    idempotencyKey?: string | null;
  }) => Promise<AppendTwinDialogueTurnResult>;
  persistUserTwinExchangeWithAssistantStub: (params: {
    twinProfileId: string;
    userContent: string;
    userIdempotencyKey?: string | null;
    assistantContent: string;
  }) => Promise<PersistUserTwinExchangeWithAssistantResult>;
  appendTwinDialogueTurn: (params: {
    twinProfileId: string;
    role: "user" | "assistant" | "system";
    content: string;
    idempotencyKey?: string | null;
  }) => Promise<void>;
  countUserDialogueTurns: (twinProfileId: string) => Promise<number>;
  listTwinDialogueTurnsChronological: (twinProfileId: string) => Promise<TwinDialogueTurnDbRow[]>;
  listTwinDialogueTurnsForUser: (userId: string) => Promise<TwinDialogueMemoryRow[]>;
  loadDashboardReadinessPayloadFromDb: (userId: string) => Promise<DashboardReadinessPayload>;
  appendDiaryEntryForUser: (params: {
    userId: string;
    body: string;
    idempotencyKey?: string | null;
  }) => Promise<AppendDiaryEntryResult>;
  appendScenarioAnswerForUser: (params: {
    userId: string;
    scenarioKey: string;
    payloadJson: string;
    idempotencyKey?: string | null;
  }) => Promise<AppendScenarioAnswerResult>;
  listDiaryEntriesForUser: (userId: string) => Promise<DiaryMemoryRow[]>;
  listScenarioAnswersForUser: (userId: string) => Promise<ScenarioAnswerMemoryRow[]>;
  appendTwinPredictionVerificationForUser: (
    params: { userId: string } & TwinPredictionVerificationSubmitBody,
  ) => Promise<TwinPredictionVerificationItemDto>;
  listTwinPredictionVerificationsForUser: (
    userId: string,
    limit?: number,
  ) => Promise<TwinPredictionVerificationItemDto[]>;
  searchTwinMemoriesByText: (
    userId: string,
    queryText: string,
    topN?: number,
  ) => Promise<TwinMemorySearchHit[]>;
  stringifyScenarioPayloadForStorage: typeof stringifyScenarioPayloadForStorage;
};

export function createPostgresTwinPersistence(db: WaiaPostgresDb): PostgresTwinPersistence {
  return {
    db,
    ensureUserTwinSeed: (userId) => ensureUserTwinSeedPg(db, userId),
    appendTwinDialogueTurnResult: (params) => appendTwinDialogueTurnResultPg(db, params),
    persistUserTwinExchangeWithAssistantStub: (params) =>
      persistUserTwinExchangeWithAssistantStubPg(db, params),
    appendTwinDialogueTurn: (params) => appendTwinDialogueTurnPg(db, params),
    countUserDialogueTurns: (twinProfileId) => countUserDialogueTurnsPg(db, twinProfileId),
    listTwinDialogueTurnsChronological: (twinProfileId) =>
      listTwinDialogueTurnsChronologicalPg(db, twinProfileId),
    listTwinDialogueTurnsForUser: (userId) => listTwinDialogueTurnsForUserPg(db, userId),
    loadDashboardReadinessPayloadFromDb: (userId) =>
      loadDashboardReadinessPayloadFromDbPg(db, userId),
    appendDiaryEntryForUser: (params) => appendDiaryEntryForUserPg(db, params),
    appendScenarioAnswerForUser: (params) => appendScenarioAnswerForUserPg(db, params),
    listDiaryEntriesForUser: (userId) => listDiaryEntriesForUserPg(db, userId),
    listScenarioAnswersForUser: (userId) => listScenarioAnswersForUserPg(db, userId),
    appendTwinPredictionVerificationForUser: (params) =>
      appendTwinPredictionVerificationForUserPg(db, params),
    listTwinPredictionVerificationsForUser: (userId, limit) =>
      listTwinPredictionVerificationsForUserPg(db, userId, limit),
    searchTwinMemoriesByText: (userId, queryText, topN) =>
      searchTwinMemoriesByTextPg(db, userId, queryText, topN),
    stringifyScenarioPayloadForStorage,
  };
}
