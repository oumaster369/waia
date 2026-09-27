import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";

import { sealHistoricalKnowledgeEdgeV1 } from "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { applyKnowledgeEdgeVersion, contentFromEdge } from "@/lib/trader/knowledge/knowledge-edge-version-repository-postgres";
import { computeKnowledgeEdgeVersionContentDigestHex, type KnowledgeEdgeVersionSnapshot } from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import type { KnowledgeEdge } from "@/lib/trader/knowledge/knowledge.types";
import { createMkbReadModelSourcePostgres } from "@/lib/trader/knowledge/mkb-read-model-postgres";

const EDGE: KnowledgeEdge = {
  id: "edge-known", organizationId: "org-known", fromRef: "pattern:a", toRef: "hypothesis:a",
  relationKind: "supports", confidence: "0.2000", strength: "1.0000", regimeScope: "probe",
  failureCasesJson: "[]", hypothesisId: "hyp-a", verified: true,
  createdAt: new Date("2026-01-01T10:00:00.000Z"), updatedAt: new Date("2026-01-01T10:00:00.000Z"),
};
const ACTIVE_SEAL_AT_3C8B = "5422c141f0b30edd6c94bf8e7fced5b804d88c97bac6b4f64e69c0da7b9059f0";
function snapshot(lifecycleState: "ACTIVE" | "RETIRED"): KnowledgeEdgeVersionSnapshot {
  const content = contentFromEdge(EDGE, lifecycleState);
  return { id: "version", version: 2, content,
    contentDigestHex: computeKnowledgeEdgeVersionContentDigestHex(content),
    reasonClass: lifecycleState === "RETIRED" ? "RETIRED" : "OPERATOR_GOVERNED_CORRECTION" };
}

describe("DEE-1131 Knowledge snapshot eligibility", () => {
  it("leaves an unversioned legacy domain object unchanged", () => {
    expect(applyKnowledgeEdgeVersion(EDGE, null)).toBe(EDGE);
    expect(contentFromEdge(EDGE).lifecycleState).toBe("ACTIVE");
  });

  it.each(["ACTIVE", "RETIRED"] as const)("carries selected %s lifecycle without rewriting facts or the input", (lifecycleState) => {
    const before = structuredClone(EDGE);
    const projected = applyKnowledgeEdgeVersion(EDGE, snapshot(lifecycleState));
    expect(projected).toEqual({ ...EDGE, lifecycleState });
    expect(EDGE).toEqual(before);
    expect(projected.verified).toBe(true);
    expect(projected.confidence).toBe("0.2000");
  });

  it("retains exact legacy V1 seal bytes; retirement is denied independently of this seal", () => {
    expect(sealHistoricalKnowledgeEdgeV1(EDGE)).toBe(ACTIVE_SEAL_AT_3C8B);
    expect(sealHistoricalKnowledgeEdgeV1(applyKnowledgeEdgeVersion(EDGE, snapshot("ACTIVE")))).toBe(ACTIVE_SEAL_AT_3C8B);
    expect(sealHistoricalKnowledgeEdgeV1(applyKnowledgeEdgeVersion(EDGE, snapshot("RETIRED")))).toBe(ACTIVE_SEAL_AT_3C8B);
  });

  it("emits both event and recorded predicates at the same supplied reader cutoff", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    // Empty SQL port only captures the actual Drizzle query; native suite proves row selection.
    const db = drizzle(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; });
    const cutoff = new Date("2026-01-01T12:00:00.000Z");
    await createMkbReadModelSourcePostgres(db as never).loadSnapshot({ organizationId: "org-known" }, {}, cutoff);
    const versions = queries.find((q) => q.sql.includes('from "trader_knowledge_edge_version_v2"'))!;
    expect(versions).toBeDefined();
    expect(versions.sql).toMatch(/"pit_event_at" <= \$\d+/);
    expect(versions.sql).toMatch(/"recorded_at" <= \$\d+/);
    expect(versions.sql).toMatch(/order by .*"version" desc/);
    expect(versions.params).toEqual(["org-known", cutoff.toISOString(), cutoff.toISOString()]);
  });
});
