import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertHtrReadinessPreflightPass,
  computeHtrReadinessPreflightDigest,
  parseHtrWp23ReadinessPreflightCliArgs,
  runHtrReadinessPreflight,
} from "@/lib/trader/readiness/htr-readiness-preflight";
import { HTR_FHV_RUN_CONTRACT_V0 } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import {
  HTR_WP23_EVIDENCE_STAGING_ROOT,
  assertHtrWp23EvidenceGitHeadMatches,
  assertHtrWp23EvidenceGitTreeClean,
  assertHtrWp23EvidenceSourceGitSha,
  assertHtrWp23EvidenceStagingTargetAllowed,
  resolveHtrWp23EvidenceStagingDir,
  runHtrWp23OfficialEvidenceSeal,
  sealHtrWp23EvidenceStaging,
  verifyHtrWp23EvidenceStaging,
} from "@/lib/trader/readiness/htr-readiness-evidence-harness";

const TEST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SYMLINK_TEST_SHA = "cccccccccccccccccccccccccccccccccccccccc";

function removeStagingPath(targetPath: string): void {
  try {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      unlinkSync(targetPath);
      return;
    }
    rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

vi.mock("@/lib/trader/backtest/replay-benchmark-harness", () => ({
  readGitCodeSha: vi.fn(() => TEST_SHA),
  readGitDirtyTree: vi.fn(() => false),
}));

describe("HTR-WP23 readiness preflight", () => {
  it("self-test passes with pinned contracts", () => {
    const result = runHtrReadinessPreflight({ mode: "self-test" });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_PASS");
    expect(result.failureCodes).toEqual([]);
    expect(result.gateGroupIds).toContain("CG-G");
    expect(result.holdoutNoReadAttestation).toBe(true);
    expect(result.noServerMutationAttestation).toBe(true);
    assertHtrReadinessPreflightPass(result);
  });

  it("candidate-run accepts exact FHV contract pins", () => {
    const result = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: {
        venue: HTR_FHV_RUN_CONTRACT_V0.venue,
        venueScope: HTR_FHV_RUN_CONTRACT_V0.venueScope,
        marketType: HTR_FHV_RUN_CONTRACT_V0.marketType,
        symbols: HTR_FHV_RUN_CONTRACT_V0.symbols,
        cashUsdt: HTR_FHV_RUN_CONTRACT_V0.initialPortfolio.cashUsdt,
        costModelVersion: HTR_FHV_RUN_CONTRACT_V0.costModelVersion,
        costModelFeesBps: HTR_FHV_RUN_CONTRACT_V0.costModelFeesBps,
        costModelSlippageBps: HTR_FHV_RUN_CONTRACT_V0.costModelSlippageBps,
        drawdownPolicyVersion: HTR_FHV_RUN_CONTRACT_V0.drawdownPolicyVersion,
        maxAccountDrawdownPct: HTR_FHV_RUN_CONTRACT_V0.maxAccountDrawdownPct,
        maxMonthlyDrawdownPct: HTR_FHV_RUN_CONTRACT_V0.maxMonthlyDrawdownPct,
        maxStrategyDrawdownPct: HTR_FHV_RUN_CONTRACT_V0.maxStrategyDrawdownPct,
        breachAction: HTR_FHV_RUN_CONTRACT_V0.breachAction,
        datasetManifestSemanticDigest: HTR_FHV_RUN_CONTRACT_V0.datasetManifestSemanticDigestPin,
        blindHoldoutStatus: HTR_FHV_RUN_CONTRACT_V0.blindHoldout.status,
        datasetSourceClassification: HTR_FHV_RUN_CONTRACT_V0.datasetSourceClassification,
      },
    });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_PASS");
  });

  it("computes stable digest for identical results", () => {
    const first = runHtrReadinessPreflight({ mode: "self-test" });
    const second = runHtrReadinessPreflight({ mode: "self-test" });
    expect(computeHtrReadinessPreflightDigest(first)).toBe(
      computeHtrReadinessPreflightDigest(second),
    );
  });
});

describe("HTR-WP23 readiness preflight CLI", () => {
  it("parses self-test mode", () => {
    expect(parseHtrWp23ReadinessPreflightCliArgs(["--self-test"]).kind).toBe("self-test");
  });

  it("parses official evidence seal mode", () => {
    const parsed = parseHtrWp23ReadinessPreflightCliArgs([
      "--emit-evidence",
      "--staging-only",
      "--source-git-sha",
      TEST_SHA,
    ]);
    expect(parsed).toMatchObject({ kind: "evidence-seal", sourceGitSha: TEST_SHA });
  });

  it.each([
    [["--emit-evidence", "--source-git-sha", TEST_SHA], "STAGING_ONLY_REQUIRED"],
    [["--emit-evidence", "--staging-only"], "SOURCE_GIT_SHA_REQUIRED"],
    [["--staging-only", "--source-git-sha", TEST_SHA], "EMIT_EVIDENCE_REQUIRED"],
    [["--source-git-sha", TEST_SHA], "EMIT_EVIDENCE_REQUIRED"],
    [["--self-test", "--unknown-flag"], "UNKNOWN_FLAG"],
    [["--holdout-read"], "FORBIDDEN_FLAG"],
    [["--mutate-execution-server"], "FORBIDDEN_FLAG"],
    [
      ["--emit-evidence", "--staging-only", "--source-git-sha", TEST_SHA, "--self-test"],
      "INCOMPATIBLE_MODE_FLAGS",
    ],
    [
      [
        "--emit-evidence",
        "--staging-only",
        "--source-git-sha",
        TEST_SHA,
        "--source-git-sha",
        TEST_SHA,
      ],
      "DUPLICATE_SOURCE_GIT_SHA",
    ],
    [["--emit-evidence", "--staging-only", "--source-git-sha"], "SOURCE_GIT_SHA_VALUE_REQUIRED"],
  ] as const)("rejects invalid argv %j", (argv, codeFragment) => {
    expect(() => parseHtrWp23ReadinessPreflightCliArgs([...argv])).toThrow(codeFragment);
  });
});

describe("HTR-WP23 official evidence seal", () => {
  const repoCwd = process.cwd();

  beforeEach(() => {
    removeStagingPath(resolveHtrWp23EvidenceStagingDir(TEST_SHA, repoCwd));
    removeStagingPath(resolveHtrWp23EvidenceStagingDir(SYMLINK_TEST_SHA, repoCwd));
  });

  afterEach(() => {
    removeStagingPath(resolveHtrWp23EvidenceStagingDir(TEST_SHA, repoCwd));
    removeStagingPath(resolveHtrWp23EvidenceStagingDir(SYMLINK_TEST_SHA, repoCwd));
  });

  it("validates source git sha format", () => {
    expect(() => assertHtrWp23EvidenceSourceGitSha("abc")).toThrow("SHORT_OR_LONG");
    expect(() => assertHtrWp23EvidenceSourceGitSha(`${TEST_SHA}`.toUpperCase())).toThrow(
      "NOT_LOWERCASE",
    );
    expect(() => assertHtrWp23EvidenceSourceGitSha("g".repeat(40))).toThrow("MALFORMED");
  });

  it("rejects sha/head mismatch and dirty tree", async () => {
    expect(() => assertHtrWp23EvidenceGitHeadMatches("c".repeat(40))).toThrow("HEAD_MISMATCH");
    const git = await import("@/lib/trader/backtest/replay-benchmark-harness");
    vi.mocked(git.readGitDirtyTree).mockReturnValueOnce(true);
    expect(() => assertHtrWp23EvidenceGitTreeClean()).toThrow("DIRTY_SOURCE_TREE");
  });

  it("rejects symlink escape under staging root", () => {
    const root = join(repoCwd, HTR_WP23_EVIDENCE_STAGING_ROOT);
    mkdirSync(root, { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), "htr-wp23-outside-"));
    const linkPath = join(root, SYMLINK_TEST_SHA);
    removeStagingPath(linkPath);
    symlinkSync(outside, linkPath);
    try {
      expect(() => assertHtrWp23EvidenceStagingTargetAllowed(SYMLINK_TEST_SHA, repoCwd)).toThrow(
        "SYMLINK",
      );
    } finally {
      removeStagingPath(linkPath);
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("seals through the official harness path and verifies sidecars", () => {
    const sealed = runHtrWp23OfficialEvidenceSeal(TEST_SHA, repoCwd);
    expect(sealed.sourceGitSha).toBe(TEST_SHA);
    expect(sealed.sourceDirtyTree).toBe(false);
    expect(sealed.credentialsDetected).toBe(false);
    expect(sealed.holdoutRead).toBe(false);
    expect(sealed.executionServerMutation).toBe(false);
    expect(sealed.manifestVerification).toBe(true);
    expect(sealed.semanticVerification).toBe(true);
    expect(verifyHtrWp23EvidenceStaging(sealed.stagingDir)).toBe(true);
    expect(readFileSync(join(sealed.stagingDir, "manifest.json"), "utf8")).toContain(TEST_SHA);
  });

  it("fails one-byte mutation verification", () => {
    const preflight = runHtrReadinessPreflight({ mode: "self-test", sourceGitSha: TEST_SHA });
    assertHtrReadinessPreflightPass(preflight);
    const sealed = sealHtrWp23EvidenceStaging({
      sourceGitSha: TEST_SHA,
      sourceDirtyTree: false,
      preflightResult: preflight,
      cwd: repoCwd,
    });
    expect(verifyHtrWp23EvidenceStaging(sealed.stagingDir)).toBe(true);
    const digestPath = join(sealed.stagingDir, "manifest.digest");
    const originalDigest = readFileSync(digestPath, "utf8");
    writeFileSync(digestPath, `${originalDigest}x`, "utf8");
    expect(verifyHtrWp23EvidenceStaging(sealed.stagingDir)).toBe(false);
  });

  it("fails official seal when tracked tree is dirty", async () => {
    const git = await import("@/lib/trader/backtest/replay-benchmark-harness");
    vi.mocked(git.readGitDirtyTree).mockReturnValueOnce(true);
    expect(() => runHtrWp23OfficialEvidenceSeal(TEST_SHA, repoCwd)).toThrow("DIRTY_SOURCE_TREE");
  });
});
