import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("DEE-629 canonical runtime intelligence consumer closure", () => {
  it("routes paper and market-brain non-live paths through canonical state", () => {
    const paper = read("lib/trader/paper/paper-cycle-runner.ts");
    const brain = read("lib/trader/market-brain/market-brain-pipeline.ts");
    expect(paper).toMatch(/canonicalRuntimeIntelligenceProvider/);
    expect(paper).toMatch(/canonicalRuntimeIntelligenceState,/);
    expect(brain).toMatch(/runMarketBrainPipelineWithCanonicalRuntimeIntelligenceV1/);
    expect(brain).toMatch(/canonicalRuntimeIntelligenceState: state/);
    expect(read("lib/trader/market-brain/run-market-brain-cycle.ts")).toMatch(/runMarketBrainPipelineWithCanonicalRuntimeIntelligenceV1/);
  });

  it("does not add canonical repository folding to the protected live cycle", () => {
    const live = read("lib/trader/live/run-live-cycle.ts");
    expect(live).not.toMatch(/canonicalRuntimeIntelligenceProvider/);
    expect(live).not.toMatch(/canonicalRuntimeIntelligenceState/);
  });

  it("keeps exactly one production hypothesis builder and a bounded canonical fold provider", () => {
    const evaluation = read("lib/trader/intelligence/evaluation-cycle.ts");
    const fold = read("lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1.ts");
    expect(evaluation.match(/buildHypothesisSet\(/g)).toHaveLength(1);
    expect(fold).toMatch(/createCanonicalRuntimeIntelligenceStateProviderV1/);
    expect(fold).toMatch(/foldCanonicalRuntimeIntelligenceStateV1\(\{ \.\.\.input, projectHypothesis \}, deps\)/);
  });

  it("applies the same mutable-edge PIT cutoff in memory and PostgreSQL adapters", () => {
    expect(read("lib/trader/knowledge/mkb-read-model-source.ts")).toMatch(/row\.updatedAt\.getTime\(\) <= asOfMs/);
    expect(read("lib/trader/knowledge/mkb-read-model-postgres.ts")).toMatch(/lte\(pgSchema\.traderKnowledgeEdges\.updatedAt, asOf\)/);
  });
});
