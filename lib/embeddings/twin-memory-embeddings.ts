import "server-only";

import { createHash } from "node:crypto";

/** Fixed dimension for all Twin-memory embeddings (SQLite JSON storage — DEE-32). */
export const TWIN_MEMORY_EMBEDDING_DIM = 64;

/** Identifier recorded with stored vectors for auditing (deterministic stub; swap for prod model id later). */
export const TWIN_MEMORY_EMBEDDING_MODEL_ID = "stub-deterministic-v1";

/** Prefix role for separability in retrieval (Twin dialogue turns). */
export function composeTwinDialogueTurnEmbedInput(
  role: "user" | "assistant" | "system",
  content: string,
): string {
  return `${role}:${content}`;
}

/** Stable embedding input for scenario answers — must match persisted `payload_json`. */
export function composeScenarioEmbedInput(scenarioKey: string, payloadJson: string): string {
  return `${scenarioKey}\n${payloadJson}`;
}

/**
 * Deterministic sync embedding — no network. Same UTF-8 text always yields the same vector.
 * Returns null only on unexpected failure inside try/catch.
 */
export function embedTwinMemoryText(input: string): number[] | null {
  try {
    const normalized = input.normalize("NFKC");
    const out: number[] = [];
    let h = createHash("sha256").update(normalized, "utf8").digest();
    for (let i = 0; i < TWIN_MEMORY_EMBEDDING_DIM; i++) {
      if (i > 0 && i % 32 === 0) {
        h = createHash("sha256").update(h).update(String(i)).digest();
      }
      const b0 = h[i % 32]!;
      const b1 = h[(i + 1) % 32]!;
      const v = (((b0 << 8) | b1) / 65535) * 2 - 1;
      out.push(v);
    }
    const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
    if (norm === 0 || !Number.isFinite(norm)) {
      return Array.from({ length: TWIN_MEMORY_EMBEDDING_DIM }, (_, j) =>
        Math.sin(((j + 1) / TWIN_MEMORY_EMBEDDING_DIM) * Math.PI),
      );
    }
    return out.map((x) => x / norm);
  } catch {
    return null;
  }
}

export function serializeEmbeddingJson(vec: number[] | null): string | null {
  if (vec === null || vec.length !== TWIN_MEMORY_EMBEDDING_DIM) {
    return null;
  }
  for (let i = 0; i < vec.length; i++) {
    if (!Number.isFinite(vec[i])) {
      return null;
    }
  }
  try {
    return JSON.stringify(vec);
  } catch {
    return null;
  }
}

export function parseEmbeddingJson(row: string | null): number[] | null {
  if (row === null || row.trim() === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(row) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const nums = parsed.map(Number);
    if (
      nums.length !== TWIN_MEMORY_EMBEDDING_DIM ||
      nums.some((x) => !Number.isFinite(x))
    ) {
      return null;
    }
    return nums;
  } catch {
    return null;
  }
}

/** Cosine similarity without assuming unit length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (
    a.length !== b.length ||
    a.length !== TWIN_MEMORY_EMBEDDING_DIM ||
    b.length !== TWIN_MEMORY_EMBEDDING_DIM
  ) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  if (d === 0 || !Number.isFinite(d)) {
    return 0;
  }
  const c = dot / d;
  return Number.isFinite(c) ? c : 0;
}
