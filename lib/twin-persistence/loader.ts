import "server-only";

import {
  twinDialogueTurns,
  twinProfiles,
  twinReadinessState,
  users,
} from "@/db/schema";
import type { DashboardReadinessPayload } from "@/lib/dashboard/dashboard-readiness-api.types";
import {
  type TwinDialogueSignals,
} from "@/lib/dashboard/readiness-snapshot-default";
import { NULL_HINTS_BY_INDICATOR } from "@/lib/dashboard/null-hints";
import { parseIndicatorVector } from "@/lib/readiness/readiness";
import type { ReadinessInput } from "@/lib/readiness/types";
import {
  composeTwinDialogueTurnEmbedInput,
  embedTwinMemoryText,
  serializeEmbeddingJson,
  TWIN_MEMORY_EMBEDDING_MODEL_ID,
} from "@/lib/embeddings/twin-memory-embeddings";
import { and, eq, sql } from "drizzle-orm";
import type { WaiaDb } from "@/db/types";
import { ensureUserTwinSeed } from "./user-twin-seed";

export type { WaiaDb, WaiaSqliteDb } from "@/db/types";

export { ensureUserTwinSeed };

function rowToReadinessInput(
  indicatorsJson: string,
  socializationCompleted: boolean,
  finalStateMessageShown: boolean,
): ReadinessInput {
  const parsed = JSON.parse(indicatorsJson) as unknown;
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

export class ReadinessSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessSerializationError";
  }
}

export type AppendTwinDialogueTurnResult = {
  id: string;
  sequence: number;
  createdAt: Date;
  content: string;
  /** True when an existing row was returned via idempotency key match. */
  replayed: boolean;
};

/** Raw row from SQLite (Twin dialogue memory v1 — DEE-26). */
export type TwinDialogueTurnDbRow = {
  id: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  content: string;
  idempotencyKey: string | null;
  createdAt: Date;
};

function appendTwinDialogueTurnInsideExecutor(
  ex: WaiaDb,
  params: {
    twinProfileId: string;
    role: "user" | "assistant" | "system";
    content: string;
    idempotencyKey?: string | null;
  },
): AppendTwinDialogueTurnResult {
  if (params.idempotencyKey != null && params.idempotencyKey !== "") {
    const existing = ex
      .select({
        id: twinDialogueTurns.id,
        sequence: twinDialogueTurns.sequence,
        createdAt: twinDialogueTurns.createdAt,
        content: twinDialogueTurns.content,
      })
      .from(twinDialogueTurns)
      .where(
        and(
          eq(twinDialogueTurns.twinProfileId, params.twinProfileId),
          eq(twinDialogueTurns.idempotencyKey, params.idempotencyKey),
        ),
      )
      .get();
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

  const [agg] = ex
    .select({
      maxSeq: sql<number>`coalesce(max(${twinDialogueTurns.sequence}), 0)`.mapWith(Number),
    })
    .from(twinDialogueTurns)
    .where(eq(twinDialogueTurns.twinProfileId, params.twinProfileId))
    .all();
  const nextSeq = Number(agg?.maxSeq ?? 0) + 1;

  const embedInput = composeTwinDialogueTurnEmbedInput(params.role, params.content);
  const embeddingVec = embedTwinMemoryText(embedInput);
  const embeddingJson = serializeEmbeddingJson(embeddingVec);
  const embeddingModel = embeddingVec ? TWIN_MEMORY_EMBEDDING_MODEL_ID : null;

  ex.insert(twinDialogueTurns).values({
    id,
    twinProfileId: params.twinProfileId,
    sequence: nextSeq,
    role: params.role,
    content: params.content,
    idempotencyKey: params.idempotencyKey ?? null,
    embeddingJson,
    embeddingModel,
  }).run();

  const row = ex
    .select({
      createdAt: twinDialogueTurns.createdAt,
    })
    .from(twinDialogueTurns)
    .where(eq(twinDialogueTurns.id, id))
    .get();

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

/** Append one dialogue row; deterministic sequence via max(sequence)+1 (sync transaction). */
export function appendTwinDialogueTurnResult(
  db: WaiaDb,
  params: {
    twinProfileId: string;
    role: "user" | "assistant" | "system";
    content: string;
    idempotencyKey?: string | null;
  },
): AppendTwinDialogueTurnResult {
  return db.transaction((tx) =>
    appendTwinDialogueTurnInsideExecutor(tx as WaiaDb, params),
  );
}

export type PersistUserTwinExchangeWithAssistantResult = {
  userTurn: AppendTwinDialogueTurnResult;
  assistantTurn: AppendTwinDialogueTurnResult | null;
};

/**
 * Atomically persists a user turn and a paired assistant stub when the user turn is freshly inserted (DEE-26).
 * Readiness/countUserDialogueTurns still counts user rows only.
 */
export function persistUserTwinExchangeWithAssistantStub(
  db: WaiaDb,
  params: {
    twinProfileId: string;
    userContent: string;
    userIdempotencyKey?: string | null;
    assistantContent: string;
  },
): PersistUserTwinExchangeWithAssistantResult {
  return db.transaction((tx) => {
    const executor = tx as WaiaDb;
    const userTurn = appendTwinDialogueTurnInsideExecutor(executor, {
      twinProfileId: params.twinProfileId,
      role: "user",
      content: params.userContent,
      idempotencyKey: params.userIdempotencyKey ?? null,
    });

    let assistantTurn: AppendTwinDialogueTurnResult | null = null;
    if (!userTurn.replayed) {
      assistantTurn = appendTwinDialogueTurnInsideExecutor(executor, {
        twinProfileId: params.twinProfileId,
        role: "assistant",
        content: params.assistantContent,
        idempotencyKey: `${userTurn.id}:assistant`,
      });
    }

    return { userTurn, assistantTurn };
  });
}

export function appendTwinDialogueTurn(
  db: WaiaDb,
  params: {
    twinProfileId: string;
    role: "user" | "assistant" | "system";
    content: string;
    idempotencyKey?: string | null;
  },
): void {
  appendTwinDialogueTurnResult(db, params);
}

export function countUserDialogueTurns(db: WaiaDb, twinProfileId: string): number {
  const [row] = db
    .select({ c: sql<number>`count(*)`.mapWith(Number) })
    .from(twinDialogueTurns)
    .where(
      and(eq(twinDialogueTurns.twinProfileId, twinProfileId), eq(twinDialogueTurns.role, "user")),
    )
    .all();
  return row?.c ?? 0;
}

/** Twin dialogue memory v1 rows for APIs and RSC hydrate (ISO `createdAt`). */
export type TwinDialogueMemoryRow = {
  id: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export function listTwinDialogueTurnsChronological(
  db: WaiaDb,
  twinProfileId: string,
): TwinDialogueTurnDbRow[] {
  return db
    .select({
      id: twinDialogueTurns.id,
      sequence: twinDialogueTurns.sequence,
      role: twinDialogueTurns.role,
      content: twinDialogueTurns.content,
      idempotencyKey: twinDialogueTurns.idempotencyKey,
      createdAt: twinDialogueTurns.createdAt,
    })
    .from(twinDialogueTurns)
    .where(eq(twinDialogueTurns.twinProfileId, twinProfileId))
    .orderBy(twinDialogueTurns.sequence)
    .all();
}

/** Twin dialogue memory for this user — read-only after ensureUserTwinSeed. */
export function listTwinDialogueTurnsForUser(db: WaiaDb, userId: string): TwinDialogueMemoryRow[] {
  const twinProfileId = ensureUserTwinSeed(db, userId);
  const rows = listTwinDialogueTurnsChronological(db, twinProfileId);
  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
}

export function loadDashboardReadinessPayloadFromDb(
  db: WaiaDb,
  userId: string,
): DashboardReadinessPayload {
  ensureUserTwinSeed(db, userId);

  const row = db
    .select({
      indicatorsJson: twinReadinessState.indicatorsJson,
      socializationCompleted: twinReadinessState.socializationCompleted,
      finalStateMessageShown: twinReadinessState.finalStateMessageShown,
      identityLabel: users.identityLabel,
      twinProfileId: twinProfiles.id,
    })
    .from(users)
    .innerJoin(twinProfiles, eq(twinProfiles.userId, users.id))
    .innerJoin(twinReadinessState, eq(twinReadinessState.twinProfileId, twinProfiles.id))
    .where(eq(users.id, userId))
    .get();

  if (!row) {
    throw new Error(`[waia] twin readiness row missing for user ${userId} after seed`);
  }

  const readinessInput = rowToReadinessInput(
    row.indicatorsJson,
    row.socializationCompleted,
    row.finalStateMessageShown,
  );
  const userTurnCount = countUserDialogueTurns(db, row.twinProfileId);
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
