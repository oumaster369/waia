/**
 * PR #452 Phase 1 — FHV official streaming behavioral proofs (M1–M10).
 *
 * RED tests assert fixed GREEN streaming, authority, and bounded-state behavior.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { FhvOfficialDatasetReader } from "@/lib/trader/market-data/fhv-official-dataset-reader";
import { validateFhvV2DatasetReadOnly } from "@/lib/trader/market-data/fhv-dataset-seal";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FhvArtifactAuthorityError,
  assertFhvAuthorizationReceiptForExecution,
} from "@/lib/trader/observability/fhv-artifact-authority-chain";
import {
  executeFhvControlReplayLaunch,
  FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
} from "@/lib/trader/observability/fhv-control-replay-execution";
import {
  writeFhvConfigurationFreezeArtifactAtomic,
  readFhvConfigurationFreezeArtifact,
} from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import { readFhvDatasetQualificationReceipt } from "@/lib/trader/observability/fhv-dataset-qualification";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import {
  readFhvFullHistoricalAuthorizationReceipt,
  writeFhvFullHistoricalAuthorizationReceiptAtomic,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
} from "@/lib/trader/observability/fhv-execution-purpose";
import {
  executeFhvFullHistoricalLaunch,
  validateFhvFullHistoricalLaunchInput,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import * as fhvFullHistoricalEngine from "@/lib/trader/observability/fhv-full-historical-engine";
import {
  buildFhvOfficialV2ScaleDataset,
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
  FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  setupFhvBoundedLaunchArtifacts,
  setupFhvOfficialSchemaLaunchArtifacts,
  setupFhvOfficialV2ControlReplayArtifacts,
  setupFhvOfficialV2MultiYearLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const OPERATOR_ID = "fhv-streaming-red-operator";
const MEMORY_CEILING_BYTES = 256 * 1024 * 1024;
const BARS1M_PREFIX_CEILING = EXPAND_MIN_BARS * 4;

describe("PR452 Phase 1 FHV official streaming RED M1–M10", () => {
  let v2DatasetRoot: string;
  let v2ManifestPath: string;

  beforeAll(() => {
    v2DatasetRoot = mkdtempSync(join(tmpdir(), "fhv-streaming-v2-scale-"));
    const built = buildFhvOfficialV2ScaleDataset(v2DatasetRoot);
    v2ManifestPath = built.manifestPath;
  }, 600_000);

  afterAll(() => {
    if (v2DatasetRoot) {
      rmSync(v2DatasetRoot, { recursive: true, force: true });
    }
  });

  it("M1 OFFICIAL_FULL_LAUNCH_EAGER_CORPUS_RED: OFFICIAL_MULTI_YEAR v2 uses datasetRoot not eager Bar[]", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-m1-"));
    const runId = "fhv-m1-v2-launch";
    const backtestSpy = vi.spyOn(fhvFullHistoricalEngine, "runFullHistoricalBacktest");
    try {
      const prep = setupFhvOfficialV2MultiYearLaunchArtifacts({
        artifactRoot: root,
        runId,
        datasetRoot: v2DatasetRoot,
        manifestPath: v2ManifestPath,
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
      });

      await executeFhvFullHistoricalLaunch({
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: prep.configurationFreezePath,
        authorizationReceiptPath: prep.authorizationReceiptPath,
        authorizationReceiptDigest: prep.authorizationReceiptDigest,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        datasetRoot: v2DatasetRoot,
        manifestPath: v2ManifestPath,
        checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
        controlReplayReceiptPath: prep.controlReplayReceiptPath,
        maxCycles: 8,
      });

      expect(backtestSpy).toHaveBeenCalled();
      const call = backtestSpy.mock.calls.at(-1)?.[0];
      expect(call?.qualificationMode).toBe("OFFICIAL_MULTI_YEAR");
      expect(call?.datasetRoot).toBe(v2DatasetRoot);
      expect(call?.bars).toBeUndefined();
    } finally {
      backtestSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("M2 OFFICIAL_CONTROL_REPLAY_DOUBLE_EAGER_CORPUS_RED: control replay v2 uses datasetRoot not Bar[]", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-m2-"));
    const runId = `fhv-v2-control-replay-1-${FHV_OFFICIAL_V2_SCALE_RELEASE_SHA.slice(0, 8)}`;
    const backtestSpy = vi.spyOn(fhvFullHistoricalEngine, "runFullHistoricalBacktest");
    try {
      const prep = setupFhvOfficialV2ControlReplayArtifacts({
        artifactRoot: root,
        datasetRoot: v2DatasetRoot,
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
      });

      await executeFhvControlReplayLaunch({
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: prep.configurationFreezePathRunOne,
        authorizationReceiptPath: prep.authorizationReceiptPathRunOne,
        authorizationReceiptDigest: readFhvFullHistoricalAuthorizationReceipt(
          prep.authorizationReceiptPathRunOne,
        ).authorizationReceiptDigest,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        datasetRoot: v2DatasetRoot,
        manifestPath: v2ManifestPath,
        checkoutIdentityProofPath: prep.checkoutIdentityProofPathRunOne,
        executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
        maxCycles: 8,
      });

      expect(backtestSpy).toHaveBeenCalled();
      const call = backtestSpy.mock.calls.at(-1)?.[0];
      expect(call?.qualificationMode).toBe("OFFICIAL_MULTI_YEAR");
      expect(call?.datasetRoot).toBe(v2DatasetRoot);
      expect(call?.bars).toBeUndefined();
      expect(call?.controlReplay).toBe(true);
    } finally {
      backtestSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("M3 OFFICIAL_REPLAY_SOURCE_FULL_EVENT_RETENTION_RED: reader retains bounded rolling windows only", () => {
    const reader = new FhvOfficialDatasetReader({
      datasetRoot: v2DatasetRoot,
      accessPurpose: "INTEGRITY_QUALIFICATION",
      includeHoldoutPartitions: false,
      cycleIdPrefix: "fhv-m3-retention",
    });

    const sampleCycles = 512;
    for (let index = 0; index < sampleCycles; index += 1) {
      const result = reader.next();
      if (result.done) {
        break;
      }
    }

    const cursor = reader.captureCursor();
    reader.close();

    expect(cursor.btc.rollingWindow.length).toBeLessThanOrEqual(EXPAND_MIN_BARS);
    expect(cursor.eth.rollingWindow.length).toBeLessThanOrEqual(EXPAND_MIN_BARS);
    expect(cursor.globalEventSequence).toBeGreaterThan(EXPAND_MIN_BARS);
  });

  it("M4 OFFICIAL_QUALIFICATION_LINEAR_MEMORY_RED: v2 seal-path validation streaming stays bounded", () => {
    const heapBefore = process.memoryUsage().heapUsed;
    const validated = validateFhvV2DatasetReadOnly(v2DatasetRoot);
    const heapAfter = process.memoryUsage().heapUsed;

    expect(validated.classification).toBe("FHV_V2_DATASET_VALIDATION_PASS");
    expect(heapAfter - heapBefore).toBeLessThan(MEMORY_CEILING_BYTES);
  }, 600_000);

  it("M5 OFFICIAL_SCALE_PROOF_NOT_PRODUCTION_BOUND_RED: scale smoke is not named production pass", () => {
    const body = readFileSync(
      join(process.cwd(), "tests/fhv/official-scale/fhv-official-scale.test.ts"),
      "utf8",
    );
    expect(body).toContain("FHV_V2_SCALE_FIXTURE_ACQUIRE_SEAL_VALIDATE_READER_SMOKE_PASS");
    expect(body).not.toMatch(/OFFICIAL_MULTI_YEAR_PRODUCTION_PATH_SCALE_PASS/);
    expect(body).not.toMatch(/PRODUCTION_BOUND.*PASS/);
  });

  it("M6 OFFICIAL_LAZY_SOURCE_RESUME_CURSOR_RED: restoreCursor resumes without full rescan", () => {
    const reader = new FhvOfficialDatasetReader({
      datasetRoot: v2DatasetRoot,
      accessPurpose: "CONTROL_REPLAY_STRATEGY",
      includeHoldoutPartitions: false,
      cycleIdPrefix: "fhv-m6-resume",
    });

    const advance = (count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const result = reader.next();
        if (result.done) {
          break;
        }
      }
    };

    advance(120);
    const checkpoint = reader.captureCursor();
    advance(40);
    const afterAdvance = reader.captureCursor();

    reader.restoreCursor(checkpoint);
    const resumed = reader.captureCursor();
    expect(resumed.globalEventSequence).toBe(checkpoint.globalEventSequence);
    expect(resumed.cycleIndex).toBe(checkpoint.cycleIndex);

    advance(40);
    const afterResumeAdvance = reader.captureCursor();
    expect(afterResumeAdvance.globalEventSequence).toBe(afterAdvance.globalEventSequence);
    expect(afterResumeAdvance.cycleIndex).toBe(afterAdvance.cycleIndex);

    expect(() => reader.reset()).toThrow(/reset is unsupported/i);
    reader.close();
  });

  it("M7 FHV_AUTHORITY_REQUIRED_FIELD_ABSENCE_RED: missing executionPurpose fails authority chain", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-m7-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-m7-missing-purpose",
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const receiptPath = prep.authorizationReceiptPath;
      const receipt = readFhvFullHistoricalAuthorizationReceipt(receiptPath);
      const {
        authorizationReceiptDigest: _digest,
        executionPurpose: _purpose,
        ...bodyWithoutPurpose
      } = receipt;
      const forgedReceipt = {
        ...bodyWithoutPurpose,
        authorizationReceiptDigest: computePayloadDigest(bodyWithoutPurpose),
      };
      writeFileSync(receiptPath, `${JSON.stringify(forgedReceipt, null, 2)}\n`);

      const qualificationReceipt = readFhvDatasetQualificationReceipt(
        prep.qualificationReceiptPath,
      );
      const freeze = readFhvConfigurationFreezeArtifact(prep.configurationFreezePath);

      expect(() =>
        assertFhvAuthorizationReceiptForExecution({
          receiptPath,
          identity: {
            releaseSha: FHV_TEST_RELEASE_SHA,
            releaseTag: FHV_TEST_RELEASE_TAG,
            organizationId: FHV_TEST_ORG_ID,
            operatorId: OPERATOR_ID,
          },
          runId: "fhv-m7-missing-purpose",
          qualificationReceipt,
          freezeDigest: freeze.configurationFreeze.configurationFreezeDigest,
          expectedExecutionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
        }),
      ).toThrow(FhvArtifactAuthorityError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("M8 CONTROL_REPLAY_FALSE_OFFICIAL_COMPLETION_RED: non-bounded CR classifies FHV_CONTROL_REPLAY_CEREMONY_PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-m8-"));
    const runId = "fhv-m8-schema-cr";
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const qualificationReceipt = readFhvDatasetQualificationReceipt(
        prep.qualificationReceiptPath,
      );
      const crRunId = `${runId}-cr`;
      const crFreeze = writeFhvConfigurationFreezeArtifactAtomic({
        artifactDir: join(root, "prep", runId, "freeze-cr"),
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        runId: crRunId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
        datasetDigest: qualificationReceipt.datasetContentDigest,
        manifestDigest: qualificationReceipt.manifestSemanticDigest,
        strategyVersions: [`${MEAN_REVERSION_V0}@0.1.0`],
        strategyDigests: [
          computeSemanticSha256Hex({ strategyVersion: `${MEAN_REVERSION_V0}@0.1.0` }),
        ],
        checkpointDigest: "fhv-m8-cr-checkpoint",
        datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
      });
      const crAuth = writeFhvFullHistoricalAuthorizationReceiptAtomic({
        receiptDir: join(root, "prep", runId, "auth-cr"),
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
        datasetDigest: crFreeze.artifact.configurationFreeze.datasetDigest,
        manifestDigest: crFreeze.artifact.configurationFreeze.manifestDigest,
        configurationFreezeDigest: crFreeze.artifact.configurationFreeze.configurationFreezeDigest,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
        runId: crRunId,
        executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
      });

      const result = await executeFhvControlReplayLaunch({
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        runId: crRunId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: crFreeze.artifactPath,
        authorizationReceiptPath: crAuth.receiptPath,
        authorizationReceiptDigest: crAuth.receipt.authorizationReceiptDigest,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
        manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
        executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
        maxCycles: 8,
      });

      expect(result.classification).toBe("FHV_CONTROL_REPLAY_CEREMONY_PASS");
      expect(result.classification).not.toBe("FULL_HISTORICAL_VALIDATION_COMPLETED");
      expect(result.classification).not.toBe("FHV_SCHEMA_INTEGRATION_CEREMONY_PASS");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("M9 FHV_EXECUTION_MODE_LATE_REJECTION_RED: wrong executionPurpose rejected before consume", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-m9-"));
    const runId = "fhv-m9-wrong-purpose";
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
      });

      expect(() =>
        validateFhvFullHistoricalLaunchInput({
          releaseSha: FHV_TEST_RELEASE_SHA,
          releaseTag: FHV_TEST_RELEASE_TAG,
          runId,
          organizationId: FHV_TEST_ORG_ID,
          operatorId: OPERATOR_ID,
          artifactRoot: root,
          configurationFreezePath: prep.configurationFreezePath,
          authorizationReceiptPath: prep.authorizationReceiptPath,
          authorizationReceiptDigest: prep.authorizationReceiptDigest,
          datasetQualificationReceiptPath: prep.qualificationReceiptPath,
          checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
          boundedFixture: true,
          executionPurpose: "CONTROL_REPLAY",
        }),
      ).toThrow(FhvArtifactAuthorityError);

      const receipt = readFhvFullHistoricalAuthorizationReceipt(prep.authorizationReceiptPath);
      expect(receipt.consumed).not.toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("M10 FHV_PUBLIC_PACKET_VALIDATOR_NOT_CI_BLOCKING_RED: ci.yml defines fhv-public-ceremony-packet job", () => {
    const body = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    expect(body).toMatch(/^\s*fhv-public-ceremony-packet:/m);
    expect(body).toContain("validate:fhv-public-ceremony-packets");
    expect(body).toMatch(/needs:.*fhv-public-ceremony-packet/);
  });
});

describe("PR452 OFFICIAL_RUNNER_BARS1M_PREFIX_RETENTION_RED", () => {
  it("STREAM_ONLY bars1mPrefix stays bounded under official launch", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-bars1m-prefix-"));
    const runId = "fhv-bars1m-prefix-run";
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const result = await executeFhvFullHistoricalLaunch({
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: prep.configurationFreezePath,
        authorizationReceiptPath: prep.authorizationReceiptPath,
        authorizationReceiptDigest: prep.authorizationReceiptDigest,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
        boundedFixture: true,
        maxCycles: 40,
      });

      expect(result.backtest?.bars1mPrefixLength).toBeDefined();
      expect(result.backtest!.bars1mPrefixLength!).toBeLessThanOrEqual(BARS1M_PREFIX_CEILING);
      expect(result.backtest!.bars1mPrefixLength!).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
