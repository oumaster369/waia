import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  collectLiveHostEnvironment,
  hostEnvironmentsMatch,
  loadReferenceHostEnvironment,
} from "@/lib/trader/backtest/d11b-host-fingerprint";
import {
  buildHtrWp22D11bThresholdSnapshotV1,
  HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE,
  HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA,
  HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SEMANTIC_SCHEMA_V1,
  toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1,
  toQualificationAttemptSemanticV1,
  toQualificationRunObservationSemanticV1,
} from "@/lib/trader/backtest/htr-completed-runtime-qualification.types";
import {
  computeSemanticSha256Hex,
  canonicalizeSemanticJsonString,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  D11B_APPROVED_DATASET_SHA256,
  D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS,
  D11B_THRESHOLDS,
  HTR_WP09_QUALIFICATION_EVIDENCE_SCHEMA,
  type QualificationAttemptResult,
  type QualificationRunObservation,
} from "@/lib/trader/backtest/replay-qualification-harness";

function isD11bQualificationHost(): boolean {
  try {
    hostEnvironmentsMatch(loadReferenceHostEnvironment(), collectLiveHostEnvironment());
    return true;
  } catch {
    return false;
  }
}

function sampleObservation(
  overrides: Partial<QualificationRunObservation> = {},
): QualificationRunObservation {
  return {
    runLabel: "N2-warm-1",
    isCold: false,
    runWallTimeMs: 120_000,
    meanPaperCycleMs: 1.2,
    p95PaperCycleMs: 2.4,
    maxPaperCycleMs: 3.1,
    rssDeltaBytes: 1_024,
    heapUsedDeltaBytes: 512,
    retainedCycleResults: 0,
    serializedCanvasBytes: 4_096,
    cycleCount: 129_581,
    barCount: 129_600,
    fullHistoryRescans: 0,
    semanticReproDigest: "a".repeat(64),
    evidenceDigest: "b".repeat(64),
    baselineRssBytes: undefined,
    ...overrides,
  };
}

function sampleAttempt(
  overrides: Partial<QualificationAttemptResult> = {},
): QualificationAttemptResult {
  const warmRun = sampleObservation();
  const coldRun = sampleObservation({ runLabel: "N2-cold", isCold: true });
  const dataset = {
    size: "N2" as const,
    barCount: 129_600,
    canvasAdvanceCount: 129_600,
    integratedReplayCycleCount: 129_581,
    barSetDigest: "c".repeat(64),
    warmRuns: [warmRun],
    coldRun,
    aggregate: {
      medianWallMs: 120_000,
      maxWallMs: 130_000,
      runtimeRangePct: 5,
      meanPaperCycleMs: 1.2,
      p95PaperCycleMs: 2.4,
      maxPaperCycleMs: 3.1,
      medianRssDeltaBytes: 1_024,
      p95RssDeltaBytes: 2_048,
      medianHeapDeltaBytes: 512,
      p95HeapDeltaBytes: 768,
      maxSerializedCanvasBytes: 4_096,
      maxRetainedCycleResults: 0,
      maxFullHistoryRescans: 0,
      p95PostGcLiveHeapDeltaBytes: undefined,
      maxPeakBufferedProjections: undefined,
    },
  };

  return {
    schemaVersion: HTR_WP09_QUALIFICATION_EVIDENCE_SCHEMA,
    terminalState: "HTR_WP09_D11B_MEMORY_AMENDMENT_V1_PASS",
    activeQualificationContract: "D11B_MEMORY_GATE_AMENDMENT_V1",
    gitSha: "420b31e1a743b27654a43c663cc7d94a0efc90e2",
    dirtyTree: false,
    hostFingerprintSha256: "d".repeat(64),
    datasetSha256: D11B_APPROVED_DATASET_SHA256,
    n1: {
      ...dataset,
      size: "N1",
      barCount: 64_800,
      canvasAdvanceCount: 64_800,
      integratedReplayCycleCount: 64_781,
    },
    n2: dataset,
    hostPreflight: {
      nodeVersion: "v22.0.0",
      platform: "darwin",
      arch: "arm64",
      cpuModel: "Apple M1",
      cpuCount: 8,
      totalMemBytes: 16_000_000_000,
    },
    diagnosticGrowth: {
      rssGrowthFor2xN: 1024,
      heapGrowthFor2xN: 512,
      rssGrowthGateResult: "DIAGNOSTIC_ONLY",
      heapGrowthGateResult: "DIAGNOSTIC_ONLY",
    },
    thresholdFailures: undefined,
    ...overrides,
  };
}

describe("HTR-WP22 completed-runtime D-11B qualification", () => {
  it("pins unchanged D-11B thresholds binding", () => {
    expect(D11B_THRESHOLDS.qualificationBarCountN2).toBe(129_600);
    expect(D11B_THRESHOLDS.integratedReplayCycleCountN2).toBe(129_581);
    expect(D11B_THRESHOLDS.maxTotalWallMs).toBe(1_800_000);
    expect(D11B_THRESHOLDS.measuredWarmRunsPerN).toBe(5);
  });

  it("pins approved D-11B N2 dataset digest", () => {
    expect(D11B_APPROVED_DATASET_SHA256).toBe(
      "e3415ffb324961ce19ce014a08d6cc3bc12bcaaba6ae380824dc7049f33a570f",
    );
  });

  it("declares completed-runtime phase and schema constants", () => {
    expect(HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE).toBe("completed-runtime-d11b");
    expect(HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA).toBe(
      "htr-wp22-completed-runtime-qualification/v1",
    );
    expect(HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SEMANTIC_SCHEMA_V1).toBe(
      "htr-wp22-completed-runtime-qualification-semantic/v1",
    );
  });

  it("omits undefined optional run-observation fields from semantic projection", () => {
    const semantic = toQualificationRunObservationSemanticV1(sampleObservation());
    expect(Object.hasOwn(semantic, "baselineRssBytes")).toBe(false);
    expect(() => computeSemanticSha256Hex(semantic)).not.toThrow();
  });

  it("preserves defined optional run-observation fields in semantic projection", () => {
    const semantic = toQualificationRunObservationSemanticV1(
      sampleObservation({ baselineRssBytes: 4096, peakBufferedProjections: 4 }),
    );
    expect(semantic.baselineRssBytes).toBe(4096);
    expect(semantic.peakBufferedProjections).toBe(4);
  });

  it("hashes the full semantic payload successfully for a pass attempt", () => {
    const payload = toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1({
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS",
      sourceGitSha: "420b31e1a743b27654a43c663cc7d94a0efc90e2",
      sourceDirtyTree: false,
      hostFingerprintSha256: "d".repeat(64),
      qualificationHarnessSha256: "e".repeat(64),
      qualificationAttempt: sampleAttempt(),
    });
    expect(() => computeSemanticSha256Hex(payload)).not.toThrow();
    expect(payload.d11bThresholdSnapshot.measuredWarmRunsPerN).toBe(5);
    expect(payload.qualificationAttempt.n2.barCount).toBe(129_600);
  });

  it("produces identical digest for identical semantic payloads", () => {
    const input = {
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS" as const,
      sourceGitSha: "420b31e1a743b27654a43c663cc7d94a0efc90e2",
      sourceDirtyTree: false,
      hostFingerprintSha256: "d".repeat(64),
      qualificationHarnessSha256: "e".repeat(64),
      qualificationAttempt: sampleAttempt(),
    };
    const first = computeSemanticSha256Hex(
      toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1(input),
    );
    const second = computeSemanticSha256Hex(
      toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1(input),
    );
    expect(second).toBe(first);
  });

  it("changes digest when a semantic acceptance measurement changes", () => {
    const base = toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1({
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS",
      sourceGitSha: "420b31e1a743b27654a43c663cc7d94a0efc90e2",
      sourceDirtyTree: false,
      hostFingerprintSha256: "d".repeat(64),
      qualificationHarnessSha256: "e".repeat(64),
      qualificationAttempt: sampleAttempt(),
    });
    const mutated = structuredClone(base);
    mutated.qualificationAttempt.n2.integratedReplayCycleCount = 1;
    expect(computeSemanticSha256Hex(mutated)).not.toBe(computeSemanticSha256Hex(base));
  });

  it("is insensitive to JavaScript key insertion order", () => {
    const payload = toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1({
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS",
      sourceGitSha: "420b31e1a743b27654a43c663cc7d94a0efc90e2",
      sourceDirtyTree: false,
      hostFingerprintSha256: "d".repeat(64),
      qualificationHarnessSha256: "e".repeat(64),
      qualificationAttempt: sampleAttempt(),
    });
    const reordered = {
      qualificationAttempt: payload.qualificationAttempt,
      semanticSchemaVersion: payload.semanticSchemaVersion,
      schemaVersion: payload.schemaVersion,
      phase: payload.phase,
      terminalState: payload.terminalState,
      sourceGitSha: payload.sourceGitSha,
      sourceDirtyTree: payload.sourceDirtyTree,
      hostFingerprintSha256: payload.hostFingerprintSha256,
      d11bThresholdsBinding: payload.d11bThresholdsBinding,
      d11bThresholdSnapshot: payload.d11bThresholdSnapshot,
      qualificationHarnessSha256: payload.qualificationHarnessSha256,
    };
    expect(computeSemanticSha256Hex(reordered)).toBe(computeSemanticSha256Hex(payload));
  });

  it("preserves array order significance in warmRuns", () => {
    const attempt = sampleAttempt();
    const secondWarm = sampleObservation({
      runLabel: "N2-warm-2",
      semanticReproDigest: "f".repeat(64),
    });
    attempt.n2.warmRuns = [attempt.n2.warmRuns[0]!, secondWarm];
    const reversed = structuredClone(attempt);
    reversed.n2.warmRuns = [...attempt.n2.warmRuns].reverse();
    const forward = computeSemanticSha256Hex(toQualificationAttemptSemanticV1(attempt));
    const backward = computeSemanticSha256Hex(toQualificationAttemptSemanticV1(reversed));
    expect(backward).not.toBe(forward);
  });

  it("embeds frozen D-11B threshold snapshot values", () => {
    const snapshot = buildHtrWp22D11bThresholdSnapshotV1();
    expect(snapshot.contract).toBe(
      D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.activeQualificationContract,
    );
    expect(snapshot.qualificationBarCountN2).toBe(D11B_THRESHOLDS.qualificationBarCountN2);
    expect(snapshot.maxBufferedProjections).toBe(
      D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxBufferedProjections,
    );
  });

  it("fails closed on unsupported semantic value types", () => {
    expect(() =>
      computeSemanticSha256Hex({
        ok: true,
        bad: undefined,
      }),
    ).toThrow(/unsupported value type/);
    expect(() =>
      computeSemanticSha256Hex({
        ok: true,
        bad: Number.NaN,
      }),
    ).toThrow(/non-finite number prohibited/);
    expect(() =>
      computeSemanticSha256Hex({
        ok: true,
        bad: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/non-finite number prohibited/);
    expect(() =>
      computeSemanticSha256Hex({
        ok: true,
        bad: () => "secret-value",
      }),
    ).toThrow(/unsupported value type/);
    expect(() =>
      computeSemanticSha256Hex({
        ok: true,
        bad: Symbol("secret"),
      }),
    ).toThrow(/unsupported value type/);
  });

  it("does not embed secret-like strings in the canonical semantic JSON", () => {
    const payload = toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1({
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS",
      sourceGitSha: "420b31e1a743b27654a43c663cc7d94a0efc90e2",
      sourceDirtyTree: false,
      hostFingerprintSha256: "d".repeat(64),
      qualificationHarnessSha256: "e".repeat(64),
      qualificationAttempt: sampleAttempt(),
    });
    const canonical = canonicalizeSemanticJsonString(payload);
    expect(canonical).not.toMatch(/password|api[_-]?key|secret|token/i);
  });

  it("keeps invalidated attempts out of accepted pass digests", () => {
    const invalidated = toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1({
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_ATTEMPT_INVALIDATED",
      sourceGitSha: "420b31e1a743b27654a43c663cc7d94a0efc90e2",
      sourceDirtyTree: false,
      hostFingerprintSha256: "d".repeat(64),
      qualificationHarnessSha256: "e".repeat(64),
      qualificationAttempt: sampleAttempt({
        terminalState: "HTR_WP09_D11B_MEMORY_AMENDMENT_V1_ATTEMPT_INVALIDATED",
        invalidationReason: "sourceGitShaMismatch",
      }),
      invalidationReason: "sourceGitShaMismatch:expected=abc:actual=def",
    });
    const accepted = toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1({
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS",
      sourceGitSha: "420b31e1a743b27654a43c663cc7d94a0efc90e2",
      sourceDirtyTree: false,
      hostFingerprintSha256: "d".repeat(64),
      qualificationHarnessSha256: "e".repeat(64),
      qualificationAttempt: sampleAttempt(),
    });
    expect(invalidated.terminalState).not.toBe("HTR_WP22_COMPLETED_RUNTIME_D11B_PASS");
    expect(computeSemanticSha256Hex(invalidated)).not.toBe(computeSemanticSha256Hex(accepted));
  });

  it.skipIf(!isD11bQualificationHost() || readGitDirtyTree())(
    "invalidates when source git sha mismatches current HEAD",
    async () => {
      const { runHtrWp22CompletedRuntimeD11bQualification } =
        await import("@/lib/trader/backtest/htr-completed-runtime-qualification-harness");
      const result = await runHtrWp22CompletedRuntimeD11bQualification({
        sourceGitSha: "0".repeat(40),
      });
      expect(result.terminalState).toBe("HTR_WP22_COMPLETED_RUNTIME_D11B_ATTEMPT_INVALIDATED");
      expect(result.invalidationReason).toContain("sourceGitShaMismatch");
      expect(result.d11bThresholdsBinding).toBe("D11B_THRESHOLDS_UNCHANGED");
      expect(result.payloadSha256).toBeUndefined();
    },
  );
});

describe("HTR-WP22 evidence seal harness", () => {
  const qualificationSourceGitSha = "afd9a3107f58ea2d6782a4881a76dcfeeca9227d";
  const expectedD11bPayloadSha256 =
    "6821c8f7ee47d6f2ea04ce4577ac2df795940fd676e1a98e20d46353d0944624";
  const hermeticQualificationStagingRoot = path.join(
    process.cwd(),
    "tests/fixtures/trader/wp22/qualification-staging",
  );

  it("declares sequential resilience task order without Promise.all orchestration", async () => {
    const { HTR_WP22_EVIDENCE_SEAL_RESILIENCE_TASK_ORDER } =
      await import("@/lib/trader/backtest/htr-wp22-evidence-harness");
    expect(HTR_WP22_EVIDENCE_SEAL_RESILIENCE_TASK_ORDER).toEqual([
      "crash-recovery-matrix",
      "checkpoint-resume-parity",
      "bounded-memory-soak",
    ]);
  });

  it("loads bound D-11B qualification artifact without mutating payloadSha256", async () => {
    const { loadHtrWp22CompletedRuntimeFromQualificationStaging } =
      await import("@/lib/trader/backtest/htr-wp22-evidence-harness");
    const loaded = loadHtrWp22CompletedRuntimeFromQualificationStaging({
      qualificationSourceGitSha,
      stagingRoot: hermeticQualificationStagingRoot,
    });
    expect(loaded.terminalState).toBe("HTR_WP22_COMPLETED_RUNTIME_D11B_PASS");
    expect(loaded.sourceGitSha).toBe(qualificationSourceGitSha);
    expect(loaded.payloadSha256).toBe(expectedD11bPayloadSha256);
    expect(loaded.qualificationAttempt.gitSha).toBe(qualificationSourceGitSha);
  });

  it("rejects forged qualification source git sha on loaded artifact", async () => {
    const { loadHtrWp22CompletedRuntimeFromQualificationStaging } =
      await import("@/lib/trader/backtest/htr-wp22-evidence-harness");
    expect(() =>
      loadHtrWp22CompletedRuntimeFromQualificationStaging({
        qualificationSourceGitSha: "0".repeat(40),
        stagingRoot: hermeticQualificationStagingRoot,
      }),
    ).toThrow(/QUALIFICATION_ARTIFACT_MISSING|QUALIFICATION_SHA_MISMATCH/);
  });

  it("records per-artifact provenance with distinct qualification and assembly SHAs", async () => {
    const {
      buildHtrWp22EvidenceManifest,
      computeHtrWp22EvidenceGeneratorSha256,
      loadHtrWp22CompletedRuntimeFromQualificationStaging,
    } = await import("@/lib/trader/backtest/htr-wp22-evidence-harness");
    const { buildHtrWp22FixtureManifest } =
      await import("@/lib/trader/backtest/htr-wp22-fixture-manifest");
    const completedRuntime = loadHtrWp22CompletedRuntimeFromQualificationStaging({
      qualificationSourceGitSha,
      stagingRoot: hermeticQualificationStagingRoot,
    });
    const assemblyGitSha = readGitCodeSha();
    const manifest = buildHtrWp22EvidenceManifest("/tmp/unused", {
      sourceGitSha: assemblyGitSha,
      qualificationSourceGitSha,
      sourceDirtyTree: false,
      completedRuntime,
      fixtureManifest: buildHtrWp22FixtureManifest(),
    });
    const d11b = manifest.artifactIndex.find(
      (entry) => entry.path === "completed-runtime-d11b.json",
    );
    const fixture = manifest.artifactIndex.find(
      (entry) => entry.path === "multi-position-fixture-manifest.json",
    );
    expect(d11b?.artifactSourceGitSha).toBe(qualificationSourceGitSha);
    expect(fixture?.artifactSourceGitSha).toBe(assemblyGitSha);
    expect(d11b?.generatorGitSha).toBe(assemblyGitSha);
    expect(d11b?.generatorSha256).toBe(
      computeHtrWp22EvidenceGeneratorSha256(
        "lib/trader/backtest/htr-wp22-evidence-harness.ts",
        assemblyGitSha,
      ),
    );
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/password|api[_-]?key|secret|token/i);
  });

  it("rejects already-sealed staging targets and partial bundles", async () => {
    const {
      assertHtrWp22EvidenceStagingTargetWritable,
      resolveHtrWp22EvidenceStagingDir,
      loadHtrWp22CompletedRuntimeFromQualificationStaging,
      sealHtrWp22EvidenceStaging,
    } = await import("@/lib/trader/backtest/htr-wp22-evidence-harness");
    const { buildHtrWp22FixtureManifest } =
      await import("@/lib/trader/backtest/htr-wp22-fixture-manifest");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const testSha = "b".repeat(40);
    const tmpRoot = mkdtempSync(join(tmpdir(), "htr-wp22-sealed-"));
    try {
      const completedRuntime = loadHtrWp22CompletedRuntimeFromQualificationStaging({
        qualificationSourceGitSha,
        stagingRoot: hermeticQualificationStagingRoot,
      });
      sealHtrWp22EvidenceStaging({
        sourceGitSha: testSha,
        cwd: tmpRoot,
        bundle: {
          sourceGitSha: readGitCodeSha(),
          qualificationSourceGitSha,
          sourceDirtyTree: false,
          completedRuntime,
          fixtureManifest: buildHtrWp22FixtureManifest(),
        },
      });
      const sealedDir = resolveHtrWp22EvidenceStagingDir(testSha, tmpRoot);
      expect(() => assertHtrWp22EvidenceStagingTargetWritable(sealedDir)).toThrow(
        /ALREADY_SEALED|PARTIAL_NOT_ACCEPTED/,
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("fails verification on one-byte artifact mutation", async () => {
    const {
      loadHtrWp22CompletedRuntimeFromQualificationStaging,
      sealHtrWp22EvidenceStaging,
      verifyHtrWp22EvidenceStaging,
    } = await import("@/lib/trader/backtest/htr-wp22-evidence-harness");
    const { buildHtrWp22FixtureManifest } =
      await import("@/lib/trader/backtest/htr-wp22-fixture-manifest");
    const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const completedRuntime = loadHtrWp22CompletedRuntimeFromQualificationStaging({
      qualificationSourceGitSha,
      stagingRoot: hermeticQualificationStagingRoot,
    });
    const tmpRoot = mkdtempSync(join(tmpdir(), "htr-wp22-evidence-mutation-"));
    const sealed = sealHtrWp22EvidenceStaging({
      sourceGitSha: readGitCodeSha(),
      cwd: tmpRoot,
      bundle: {
        sourceGitSha: readGitCodeSha(),
        qualificationSourceGitSha,
        sourceDirtyTree: false,
        completedRuntime,
        fixtureManifest: buildHtrWp22FixtureManifest(),
      },
    });
    expect(verifyHtrWp22EvidenceStaging(sealed.stagingDir)).toBe(true);
    const artifactPath = join(sealed.stagingDir, "multi-position-fixture-manifest.json");
    const original = readFileSync(artifactPath, "utf8");
    writeFileSync(artifactPath, original.replace("BTCUSDT", "BTCUSDTX"), "utf8");
    expect(verifyHtrWp22EvidenceStaging(sealed.stagingDir)).toBe(false);
    rmSync(tmpRoot, { recursive: true, force: true });
  });
});
