import { describe, expect, it } from "vitest";

import {
  composeScenarioEmbedInput,
  composeTwinDialogueTurnEmbedInput,
  cosineSimilarity,
  embedTwinMemoryText,
  parseEmbeddingJson,
  serializeEmbeddingJson,
  TWIN_MEMORY_EMBEDDING_DIM,
} from "@/lib/embeddings/twin-memory-embeddings";

describe("twin-memory-embeddings", () => {
  it("embedTwinMemoryText is deterministic and normalized (unit length-ish)", () => {
    const a = embedTwinMemoryText("fixture text alpha");
    const b = embedTwinMemoryText("fixture text alpha");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toHaveLength(TWIN_MEMORY_EMBEDDING_DIM);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeGreaterThan(0.999);
    expect(norm).toBeLessThanOrEqual(1.001);
  });

  it("serializeEmbeddingJson rejects wrong length / non-finite", () => {
    expect(serializeEmbeddingJson(null)).toBe(null);
    expect(serializeEmbeddingJson([])).toBe(null);
    expect(
      serializeEmbeddingJson(
        Array.from({ length: TWIN_MEMORY_EMBEDDING_DIM - 1 }, () => 0),
      ),
    ).toBe(null);
    expect(
      serializeEmbeddingJson(Array.from({ length: TWIN_MEMORY_EMBEDDING_DIM }, () => Number.NaN)),
    ).toBe(null);
    const ok = embedTwinMemoryText("x")!;
    const json = serializeEmbeddingJson(ok);
    expect(json).not.toBe(null);
    expect(parseEmbeddingJson(json)).toEqual(ok);
    expect(parseEmbeddingJson("not-json")).toBe(null);
    expect(parseEmbeddingJson("[]")).toBe(null);
  });

  it("composeTwinDialogueTurnEmbedInput prefixes role", () => {
    expect(composeTwinDialogueTurnEmbedInput("user", "hi")).toBe("user:hi");
    expect(composeTwinDialogueTurnEmbedInput("assistant", "stub")).toBe("assistant:stub");
  });

  it("composeScenarioEmbedInput separates key from JSON", () => {
    expect(composeScenarioEmbedInput("morning", '{"a":1}')).toBe('morning\n{"a":1}');
  });

  it("cosineSimilarity returns 1 for identical vectors", () => {
    const v = Array.from({ length: TWIN_MEMORY_EMBEDDING_DIM }, (_, i) => (i % 2 === 0 ? 0.1 : -0.1));
    expect(cosineSimilarity(v, v)).toBeGreaterThan(0.999);
  });

  it("embedding differs materially for disjoint texts", () => {
    const a = embedTwinMemoryText("zzz_unique_alpha_terminal")!;
    const b = embedTwinMemoryText("qqq_unique_beta_terminal")!;
    expect(cosineSimilarity(a, b)).toBeLessThan(0.98);
  });
});
