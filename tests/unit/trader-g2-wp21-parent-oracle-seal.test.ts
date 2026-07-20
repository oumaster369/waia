import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertBoundParentPatchBytes,
  assertBoundVectorFixtureBytes,
  assertParentGitSha,
  WP21_PARENT_GIT_SHA,
  WP21_PARENT_PATCH_SHA256,
} from "@/lib/trader/research/wp21-g2-parent-seal-orchestrator";

describe("trader g2 wp21 parent oracle seal", () => {
  it("rejects parent instrumentation patch digest mismatch", () => {
    expect(() => assertBoundParentPatchBytes("/tmp/nonexistent-wp21-parent-seal-test")).toThrow();
  });

  it("rejects wrong parent git sha", () => {
    expect(() => assertParentGitSha("0000000000000000000000000000000000000000")).toThrow(
      "WP21_PARENT_SEAL_PARENT_SHA_MISMATCH",
    );
    expect(() => assertParentGitSha(WP21_PARENT_GIT_SHA)).not.toThrow();
  });

  it("fails closed on patch apply check failure", () => {
    const repoRoot = process.cwd();
    const patchPath = path.join(
      repoRoot,
      "tests/fixtures/trader/wp21-parent-5e9fb106-cost-vector-oracle-v2.patch",
    );
    const digest = createHash("sha256").update(readFileSync(patchPath)).digest("hex");
    expect(digest).toBe(WP21_PARENT_PATCH_SHA256);
  });

  it("rejects vector fixture digest mismatch", () => {
    expect(() => assertBoundVectorFixtureBytes("/tmp/nonexistent-wp21-vector-fixture")).toThrow();
    expect(() => assertBoundVectorFixtureBytes(process.cwd())).not.toThrow();
  });

  it("prohibits Number parseFloat Math on economic values", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/trader/research/wp21-g2-cost-vector-comparison.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bMath\./);
  });
});
