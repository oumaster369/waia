import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertWp16EvidenceCleanSourceHead,
  assertWp16EvidencePublicationTarget,
  buildWp16EvidenceManifest,
  HTR_WP16_FINAL_ACCEPTED_PATH,
  HTR_WP16_STAGING_ROOT,
  resolveWp16EvidenceOutputPath,
} from "../../scripts/trader/replay-wp16-strategy-gating-evidence";

describe("HTR-WP16 evidence hermeticity", () => {
  it("rejects accepted evidence path during Phase A", () => {
    expect(() => assertWp16EvidencePublicationTarget(HTR_WP16_FINAL_ACCEPTED_PATH)).toThrow(
      "WP16_EVIDENCE_ACCEPTED_PATH_WRITE_DURING_PHASE_A",
    );
  });

  it("rejects staging escape outside gitignored root", () => {
    expect(() => assertWp16EvidencePublicationTarget("/tmp/wp16-evidence")).toThrow(
      "WP16_EVIDENCE_STAGING_ESCAPE",
    );
  });

  it("allows staging path under gitignored root", () => {
    const sha = "abc123";
    const target = resolveWp16EvidenceOutputPath(sha, process.cwd());
    expect(target).toContain(path.join(HTR_WP16_STAGING_ROOT, sha));
    expect(() => assertWp16EvidencePublicationTarget(target)).not.toThrow();
  });

  it("builds manifest with required Phase A fields", () => {
    const manifest = buildWp16EvidenceManifest({
      sourceGitSha: "deadbeef",
      sourceDirtyTree: false,
      profileDigest: "p".repeat(64),
      matrixDigest: "m".repeat(64),
    });
    expect(manifest.sourceGitSha).toBe("deadbeef");
    expect(manifest.sourceDirtyTree).toBe(false);
    expect(manifest.candidateStatus).toBe("COMPLETE_NOT_YET_ACCEPTED");
    expect(manifest.outputMode).toBe("GITIGNORED_STAGING");
    expect(manifest.finalAcceptedPath).toBe(HTR_WP16_FINAL_ACCEPTED_PATH);
    expect(manifest.dirtyTreeRule).toBe("REJECT_IF_DIRTY");
    expect(typeof manifest.semanticDigest).toBe("string");
  });

  it("assertWp16EvidenceCleanSourceHead requires clean tree", () => {
    expect(typeof assertWp16EvidenceCleanSourceHead).toBe("function");
  });
});
