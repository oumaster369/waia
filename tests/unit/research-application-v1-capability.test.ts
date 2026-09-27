// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { APPLICATION_COMPUTATION_SCOPE, APPLICATION_COMPUTATION_SOURCE_MANIFEST, APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST } from
  "@/lib/trader/paper/research-application-v1/computation-manifest";
import type { ResearchApplicationFoldV1, ResearchApplicationRelationV1 } from "@/lib/trader/paper/research-application-v1/contract";
import type { MiEvidence } from "@/lib/trader/mi/evidence.types";
import { assertCanonicalRuntimeIntelligenceStateV1, type RuntimeKnowledgeAuthorityV1 } from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { assertKnowledgeSelectionReceiptV2, type KnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";

// These compile-time controls also run under the separately scheduled whole-project typecheck.
function incompatibleTypes(fold: ResearchApplicationFoldV1, relation: ResearchApplicationRelationV1) {
  // @ts-expect-error Research has no ordinary hypotheses, knowledge digest or authority.
  const ordinary: RuntimeKnowledgeAuthorityV1 = fold;
  // @ts-expect-error A research relation is not old MSV-bound MiEvidence.
  const legacyEvidence: MiEvidence = relation;
  return { ordinary, legacyEvidence };
}
void incompatibleTypes;

describe("DEE1132 pure research capability closure", () => {
  it("pins the actual passive dependency closure and refuses to claim a not-yet-built CLI", () => {
    const result = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/trader/generate-research-application-manifest.ts", "--check"], { encoding: "utf8" }));
    expect(APPLICATION_COMPUTATION_SCOPE).toBe("PURE_POLICY_ONLY"); expect(result.scope).toBe(APPLICATION_COMPUTATION_SCOPE);
    expect(result.entries).toEqual(APPLICATION_COMPUTATION_SOURCE_MANIFEST); expect(result.digest).toBe(APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST);
    expect(result.external).toEqual(["node:crypto", "zod"]);
    const paths = result.entries.map((e: { path: string }) => e.path);
    expect(paths).toContain("lib/trader/intelligence/hypothesis/evidence-judgment-kernel-v1.ts");
    expect(paths).toContain("lib/trader/knowledge/navigator/selection-kernel-v2.ts");
    for (const row of APPLICATION_COMPUTATION_SOURCE_MANIFEST) {
      expect(createHash("sha256").update(readFileSync(row.path)).digest("hex")).toBe(row.sha256);
      expect(row.path).not.toMatch(/runtime-knowledge-authority|canonical-runtime-intelligence-fold|repository|service\.ts|\/db\/|\/forecast|predictive-admission|\/execution\/|\/risk\/|\/live\/|gateway|\/connectors\/|run-saved|paper-bar-close-loop/);
    }
  });
  it("existing authority validators refuse explicit research envelopes, even through casts", () => {
    const research = { schemaVersion: "waia.trader.research_application_fold.v1", authority: "RESEARCH_APPLICATION_ONLY", purpose: "RESEARCH_NON_CAPITAL", researchJudgments: [] };
    expect(() => assertCanonicalRuntimeIntelligenceStateV1(research as unknown as RuntimeKnowledgeAuthorityV1)).toThrow();
    expect(() => assertKnowledgeSelectionReceiptV2({ ...research, schemaVersion: "waia.trader.research_application_selection.v1" } as unknown as KnowledgeSelectionReceiptV2)).toThrow();
  });
  it("keeps no invocation of ambient clock/random/source callback in the new policy modules", () => {
    for (const file of ["lib/trader/paper/research-application-v1/contract.ts", "lib/trader/paper/research-application-v1/specification.ts"])
      expect(readFileSync(file, "utf8")).not.toMatch(/Date\.now|Math\.random|randomUUID|process\.env|\bfetch\s*\(|\.query\s*\(|\.transaction\s*\(/);
  });
});
