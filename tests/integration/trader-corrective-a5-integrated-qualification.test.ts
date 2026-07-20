import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/backtest/replay-benchmark-harness", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trader/backtest/replay-benchmark-harness")>();
  return {
    ...actual,
    readGitDirtyTree: () => false,
  };
});

import { readGitCodeSha } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  assertCorrectiveAEvidenceOneByteMutationRejected,
  resolveHtrCorrectiveAEvidenceStagingDir,
  sealHtrCorrectiveAEvidenceStaging,
  verifyHtrCorrectiveAEvidenceStaging,
} from "../../scripts/trader/htr-corrective-a-evidence-seal";
import {
  assertHtrCorrectiveAIntegratedQualificationPass,
  HTR_CORRECTIVE_A_PACKET_SHA256,
  runHtrCorrectiveAIntegratedQualification,
} from "../../scripts/trader/htr-corrective-a-qualify";
import type { HtrCorrectiveAIntegratedQualificationResult } from "../../scripts/trader/htr-corrective-a-qualify";
import type { HtrCorrectiveAEvidenceSealResult } from "../../scripts/trader/htr-corrective-a-evidence-seal";

type SealedCorrectiveAEvidenceFixture = {
  tempRoot: string;
  stagingDir: string;
  sourceGitSha: string;
  qualification: HtrCorrectiveAIntegratedQualificationResult;
  sealed: HtrCorrectiveAEvidenceSealResult;
};

function sealCorrectiveAEvidenceFixture(): SealedCorrectiveAEvidenceFixture {
  const sourceGitSha = readGitCodeSha();
  const qualification = runHtrCorrectiveAIntegratedQualification({ sourceGitSha });

  assertHtrCorrectiveAIntegratedQualificationPass(qualification);
  expect(qualification.sourceDirtyTree).toBe(false);
  expect(qualification.packetSha256).toBe(HTR_CORRECTIVE_A_PACKET_SHA256);
  expect(qualification.gateStatuses).toHaveLength(4);
  expect(qualification.gateStatuses.every((gate) => gate.terminalState === "PASS")).toBe(true);

  const tempRoot = mkdtempSync(join(tmpdir(), "htr-corrective-a5-"));
  const stagingDir = resolveHtrCorrectiveAEvidenceStagingDir(sourceGitSha, tempRoot);
  const sealed = sealHtrCorrectiveAEvidenceStaging({
    sourceGitSha,
    qualification,
    cwd: tempRoot,
  });

  return { tempRoot, stagingDir, sourceGitSha, qualification, sealed };
}

describe("DEE-415 C-A5 integrated qualification (G5)", () => {
  it("runs C-A1..A4 gates together, seals evidence, and rejects one-byte mutation", () => {
    const { tempRoot, stagingDir, sourceGitSha, sealed } = sealCorrectiveAEvidenceFixture();

    try {
      expect(sealed.sourceGitSha).toBe(sourceGitSha);
      expect(sealed.sourceDirtyTree).toBe(false);
      expect(sealed.packetSha256).toBe(HTR_CORRECTIVE_A_PACKET_SHA256);
      expect(sealed.artifactCount).toBe(3);
      expect(verifyHtrCorrectiveAEvidenceStaging(stagingDir)).toBe(true);

      const manifest = JSON.parse(readFileSync(join(stagingDir, "manifest.json"), "utf8")) as {
        sourceGitSha: string;
        sourceDirtyTree: boolean;
        packetSha256: string;
        artifactIndex: Array<{ payloadSha256: string; fileSha256: string }>;
      };
      expect(manifest.sourceGitSha).toBe(sourceGitSha);
      expect(manifest.sourceDirtyTree).toBe(false);
      expect(manifest.packetSha256).toBe(HTR_CORRECTIVE_A_PACKET_SHA256);
      expect(manifest.artifactIndex.every((entry) => entry.payloadSha256.length === 64)).toBe(true);
      expect(manifest.artifactIndex.every((entry) => entry.fileSha256.length === 64)).toBe(true);
      expect(readFileSync(join(stagingDir, "manifest.digest"), "utf8").trim()).toBe(
        sealed.manifestDigest,
      );
      expect(readFileSync(join(stagingDir, "semantic.digest"), "utf8").trim()).toBe(
        sealed.semanticDigest,
      );

      assertCorrectiveAEvidenceOneByteMutationRejected(stagingDir);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects one-byte mutation of sealed evidence", () => {
    const { tempRoot, stagingDir } = sealCorrectiveAEvidenceFixture();

    try {
      expect(verifyHtrCorrectiveAEvidenceStaging(stagingDir)).toBe(true);
      assertCorrectiveAEvidenceOneByteMutationRejected(stagingDir);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
