import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { buildFhvConfigurationFreeze } from "@/lib/trader/observability/fhv-configuration-freeze";
import { FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION } from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  executeFhvFullHistoricalLaunch,
  validateFhvFullHistoricalLaunchInput,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

const RELEASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-full-launch-test-operator";
const STRATEGY_VERSION = `${MEAN_REVERSION_V0}@0.1.0`;
const STRATEGY_DIGEST = computeSemanticSha256Hex({ strategyVersion: STRATEGY_VERSION });

function buildBaseInput(artifactRoot: string, runId: string) {
  const freeze = buildFhvConfigurationFreeze({
    releaseSha: RELEASE_SHA,
    runId,
    organizationId: ORG_ID,
    operatorId: OPERATOR_ID,
    datasetDigest: "bounded-fixture-digest",
    manifestDigest: "bounded-fixture-manifest",
    strategyVersions: [STRATEGY_VERSION],
    strategyDigests: [STRATEGY_DIGEST],
    checkpointDigest: "test-checkpoint",
  });
  return {
    authorization: FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION,
    releaseSha: RELEASE_SHA,
    runId,
    organizationId: ORG_ID,
    operatorId: OPERATOR_ID,
    datasetDigest: "bounded-fixture-digest",
    manifestDigest: "bounded-fixture-manifest",
    strategyVersions: [STRATEGY_VERSION] as const,
    strategyDigests: [STRATEGY_DIGEST] as const,
    checkpointDigest: "test-checkpoint",
    configurationFreezeDigest: freeze.configurationFreezeDigest,
    artifactRoot,
    boundedFixture: true,
    maxCycles: 10,
  };
}

describe("DEE-436 FHV full launch fail-closed gates", () => {
  it("rejects missing authorization", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-no-auth");
      expect(() => validateFhvFullHistoricalLaunchInput({ ...input, authorization: "" })).toThrow(
        /AUTHORIZE-FULL-HISTORICAL-VALIDATION is required/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects AUTHORIZE-FHV-OPS-DEPLOY as authorization", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-wrong-auth");
      expect(() =>
        validateFhvFullHistoricalLaunchInput({
          ...input,
          authorization: "AUTHORIZE-FHV-OPS-DEPLOY",
        }),
      ).toThrow(/not interchangeable with AUTHORIZE-FHV-OPS-DEPLOY/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects rehearsal mode", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-rehearsal");
      expect(() => validateFhvFullHistoricalLaunchInput({ ...input, rehearsalMode: true })).toThrow(
        /FHV_REHEARSAL_MODE=true is rejected/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects wrong configuration freeze digest", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-bad-freeze");
      expect(() =>
        validateFhvFullHistoricalLaunchInput({
          ...input,
          configurationFreezeDigest: "0".repeat(64),
        }),
      ).toThrow(/configurationFreezeDigest mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects live exchange path tripwire", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-live-path");
      expect(() =>
        validateFhvFullHistoricalLaunchInput({ ...input, livePathInvoked: true }),
      ).toThrow(/Live exchange path invoked during FHV replay/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects reused runId after receipt written", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    const runId = "fhv-full-reuse-run";
    try {
      const input = buildBaseInput(root, runId);
      await executeFhvFullHistoricalLaunch(input);
      await expect(executeFhvFullHistoricalLaunch(input)).rejects.toMatchObject({
        code: "RUN_ID_REUSED",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects official launch without pinned dataset digest", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-bad-dataset");
      const freeze = buildFhvConfigurationFreeze({
        releaseSha: input.releaseSha,
        runId: input.runId,
        organizationId: input.organizationId,
        operatorId: input.operatorId,
        datasetDigest: "wrong-digest",
        manifestDigest: HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN,
        strategyVersions: [...input.strategyVersions],
        strategyDigests: [...input.strategyDigests],
        checkpointDigest: input.checkpointDigest,
      });
      expect(() =>
        validateFhvFullHistoricalLaunchInput({
          ...input,
          boundedFixture: false,
          datasetDigest: "wrong-digest",
          manifestDigest: HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN,
          configurationFreezeDigest: freeze.configurationFreezeDigest,
        }),
      ).toThrow(/datasetDigest must match pinned manifest digest/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("DEE-436 FHV bounded full launch end-to-end", () => {
  it("executes bounded fixture and classifies BOUNDED_FULL_HISTORICAL_END_TO_END_PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-e2e-"));
    const runId = `fhv-bounded-e2e-${Date.now()}`;
    try {
      const result = await executeFhvFullHistoricalLaunch(buildBaseInput(root, runId));
      expect(result.classification).toBe("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS");
      expect(result.semanticReproDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
