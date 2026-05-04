import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import { diaryEntries, scenarioAnswers, twinDialogueTurns } from "@/db/schema";
import {
  cosineSimilarity,
  embedTwinMemoryText,
  parseEmbeddingJson,
} from "@/lib/embeddings/twin-memory-embeddings";
import { ensureUserTwinSeed, type WaiaSqliteDb } from "@/lib/twin-persistence/loader";

export type TwinMemorySource = "dialogue" | "diary" | "scenario";

/** One retrieval hit for downstream reasoning layer (DEE-32). */
export type TwinMemorySearchHit = {
  source: TwinMemorySource;
  id: string;
  /** Cosine similarity in approximately [-1, 1]; higher is closer. */
  score: number;
  previewText: string;
};

const MAX_TOP_N = 100;

export function searchTwinMemoriesByText(
  db: WaiaSqliteDb,
  userId: string,
  queryText: string,
  topN: number,
): TwinMemorySearchHit[] {
  const twinProfileId = ensureUserTwinSeed(db, userId);
  const queryVec = embedTwinMemoryText(queryText);
  if (queryVec === null) {
    return [];
  }

  const limit = Number.isFinite(topN) ? Math.min(Math.max(1, Math.floor(topN)), MAX_TOP_N) : 10;

  const candidates: TwinMemorySearchHit[] = [];

  const turns = db
    .select({
      id: twinDialogueTurns.id,
      role: twinDialogueTurns.role,
      content: twinDialogueTurns.content,
      embeddingJson: twinDialogueTurns.embeddingJson,
    })
    .from(twinDialogueTurns)
    .where(and(eq(twinDialogueTurns.twinProfileId, twinProfileId), isNotNull(twinDialogueTurns.embeddingJson)))
    .all();

  for (const t of turns) {
    const v = parseEmbeddingJson(t.embeddingJson);
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

  const diaries = db
    .select({
      id: diaryEntries.id,
      body: diaryEntries.body,
      embeddingJson: diaryEntries.embeddingJson,
    })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.userId, userId), isNotNull(diaryEntries.embeddingJson)))
    .all();

  for (const d of diaries) {
    const v = parseEmbeddingJson(d.embeddingJson);
    if (v === null) {
      continue;
    }
    const score = cosineSimilarity(queryVec, v);
    const body = d.body ?? "";
    candidates.push({
      source: "diary",
      id: d.id,
      score,
      previewText: body.length > 200 ? `${body.slice(0, 197)}…` : body,
    });
  }

  const scenarios = db
    .select({
      id: scenarioAnswers.id,
      scenarioKey: scenarioAnswers.scenarioKey,
      payloadJson: scenarioAnswers.payloadJson,
      embeddingJson: scenarioAnswers.embeddingJson,
    })
    .from(scenarioAnswers)
    .where(
      and(
        eq(scenarioAnswers.twinProfileId, twinProfileId),
        isNotNull(scenarioAnswers.embeddingJson),
      ),
    )
    .all();

  for (const s of scenarios) {
    const v = parseEmbeddingJson(s.embeddingJson);
    if (v === null) {
      continue;
    }
    const score = cosineSimilarity(queryVec, v);
    const pj = s.payloadJson;
    const truncated = pj.length > 160 ? `${pj.slice(0, 157)}…` : pj;
    candidates.push({
      source: "scenario",
      id: s.id,
      score,
      previewText: `${s.scenarioKey}: ${truncated}`,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}
