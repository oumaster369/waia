import { describe, expect, it } from "vitest";

import {
  assertExpectedParentSealDigests,
  generateWp21G2ParentSeal,
} from "@/lib/trader/research/wp21-g2-parent-seal-orchestrator";

describe("trader g2 wp21 parent seal regeneration integration", () => {
  it("requires parent worktree typecheck after patch apply", () => {
    const result = generateWp21G2ParentSeal();
    expect(result.zeroFillSemantic.cycleCount).toBe(6);
  }, 240_000);

  it("requires byte-identical repeated oracle execution", () => {
    const first = generateWp21G2ParentSeal();
    const second = generateWp21G2ParentSeal();
    expect(first.parentOracleSemantic.semanticResultDigest).toBe(
      second.parentOracleSemantic.semanticResultDigest,
    );
  }, 480_000);

  it("binds oracle provenance digest to bound patch and fixture", () => {
    const result = generateWp21G2ParentSeal();
    assertExpectedParentSealDigests(result);
    expect(result.provenanceDigest).toMatch(/^[0-9a-f]{64}$/);
  }, 240_000);
});
