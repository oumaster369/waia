import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  runMeasuredFlagOffRunnerInWorktree,
  withTemporaryWorktree,
  WP21_FLAG_OFF_PARENT_SHA,
} from "@/lib/trader/intelligence/epistemic/wp21-proof-harness";

describe("trader wp21 measured flag-off parity", () => {
  it("measures V1 research-path byte parity between parent and candidate worktrees", () => {
    const repoRoot = process.cwd();
    const parentOutputPath = path.join(
      mkdtempSync(path.join(tmpdir(), "wp21-v1-parent-")),
      "out.json",
    );
    const candidateOutputPath = path.join(
      mkdtempSync(path.join(tmpdir(), "wp21-v1-candidate-")),
      "out.json",
    );

    const parent = withTemporaryWorktree(WP21_FLAG_OFF_PARENT_SHA, (worktreePath) =>
      runMeasuredFlagOffRunnerInWorktree({
        worktreePath,
        repoRoot,
        metricsSchemaVersion: "1.0.0",
        outputPath: parentOutputPath,
      }),
    );

    const candidate = runMeasuredFlagOffRunnerInWorktree({
      worktreePath: repoRoot,
      repoRoot,
      metricsSchemaVersion: "1.0.0",
      outputPath: candidateOutputPath,
    });

    expect(parent.fullResearchPathDigest).toBe(candidate.fullResearchPathDigest);
    expect(parent.capitalPathDigest).toBe(candidate.capitalPathDigest);
    expect(parent.serializedCapitalPath).toBe(candidate.serializedCapitalPath);
  }, 180_000);

  it("measures V2 portfolio-context byte parity between parent and candidate worktrees", () => {
    const repoRoot = process.cwd();
    const parentOutputPath = path.join(
      mkdtempSync(path.join(tmpdir(), "wp21-v2-parent-")),
      "out.json",
    );
    const candidateOutputPath = path.join(
      mkdtempSync(path.join(tmpdir(), "wp21-v2-candidate-")),
      "out.json",
    );

    const parent = withTemporaryWorktree(WP21_FLAG_OFF_PARENT_SHA, (worktreePath) =>
      runMeasuredFlagOffRunnerInWorktree({
        worktreePath,
        repoRoot,
        metricsSchemaVersion: "2.0.0",
        outputPath: parentOutputPath,
      }),
    );

    const candidate = runMeasuredFlagOffRunnerInWorktree({
      worktreePath: repoRoot,
      repoRoot,
      metricsSchemaVersion: "2.0.0",
      outputPath: candidateOutputPath,
    });

    expect(parent.fullResearchPathDigest).toBe(candidate.fullResearchPathDigest);
    expect(parent.capitalPathDigest).toBe(candidate.capitalPathDigest);
    expect(parent.serializedCapitalPath).toBe(candidate.serializedCapitalPath);
    expect(parent.metricsSchemaVersion).toBe("2.0.0");
  }, 180_000);
});
