/**
 * HTR-WP10 — default in-memory research session determinism (no caller-pinned newId).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildWp10DeterminismManifest,
  HTR_WP10_DETERMINISM_MANIFEST_SCHEMA_VERSION,
  HTR_WP10_DETERMINISM_PROPERTY,
  HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST,
  HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH,
  readHistoricalWp10Manifest,
  readHistoricalWp10Readme,
  resolveHistoricalWp10EvidenceDir,
  verifyManifestArtifactDigest,
} from "@/lib/trader/research/wp10-determinism-evidence-harness";
import { runWp10DefaultSessionReplay } from "@/tests/unit/helpers/wp10-replay-fixture";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(process.cwd(), relativePath)))
    .digest("hex");
}

describe("HTR-WP10 default session determinism", () => {
  it("produces byte-identical metrics, digests, and IDs across two isolated replays without mutating accepted evidence", async () => {
    const historicalManifestShaBefore = sha256File(
      `${HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH}/manifest.json`,
    );
    const historicalReadmeShaBefore = sha256File(
      `${HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH}/README.md`,
    );

    const first = await runWp10DefaultSessionReplay("2026-01-01T00:00:00.000Z");
    await delay(250);
    const second = await runWp10DefaultSessionReplay("2099-12-31T23:59:59.999Z");

    expect(first.cycleCount).toBeGreaterThan(0);
    expect(second.cycleCount).toBe(first.cycleCount);
    expect(second.closedTradeCount).toBe(first.closedTradeCount);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.decisionTraceDigest).toBe(first.decisionTraceDigest);
    expect(second.reproDigest).toBe(first.reproDigest);
    expect(second.orderIds).toEqual(first.orderIds);
    expect(second.fillIds).toEqual(first.fillIds);
    expect(second.fillExecutedAtIso).toEqual(first.fillExecutedAtIso);
    expect(second.featureSetIds).toEqual(first.featureSetIds);
    expect(second.strategySignalIds).toEqual(first.strategySignalIds);

    const currentManifest = buildWp10DeterminismManifest(first);
    expect(currentManifest.schemaVersion).toBe(HTR_WP10_DETERMINISM_MANIFEST_SCHEMA_VERSION);
    expect(currentManifest.property).toBe(HTR_WP10_DETERMINISM_PROPERTY);
    expect(currentManifest.runCount).toBe(2);
    expect(verifyManifestArtifactDigest(currentManifest, first)).toBe(true);

    const historicalManifest = readHistoricalWp10Manifest();
    expect(historicalManifest.schemaVersion).toBe(HTR_WP10_DETERMINISM_MANIFEST_SCHEMA_VERSION);
    expect(historicalManifest.property).toBe(HTR_WP10_DETERMINISM_PROPERTY);
    expect(historicalManifest.runCount).toBe(2);
    expect(historicalManifest.cycleCount).toBeGreaterThan(0);
    expect(historicalManifest.decisionTraceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(historicalManifest.reproDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(historicalManifest.artifactDigest).toBe(HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST);

    const historicalReadme = readHistoricalWp10Readme();
    expect(historicalReadme).toContain(HTR_WP10_HISTORICAL_ACCEPTED_ARTIFACT_DIGEST);

    // Current post-Macro-D code: within-version determinism only (not historical bef6c1 digests).
    expect(currentManifest.decisionTraceDigest).not.toBe(historicalManifest.decisionTraceDigest);
    expect(currentManifest.reproDigest).not.toBe(historicalManifest.reproDigest);
    expect(currentManifest.artifactDigest).not.toBe(historicalManifest.artifactDigest);

    expect(sha256File(`${HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH}/manifest.json`)).toBe(
      historicalManifestShaBefore,
    );
    expect(sha256File(`${HTR_WP10_HISTORICAL_EVIDENCE_RELATIVE_PATH}/README.md`)).toBe(
      historicalReadmeShaBefore,
    );
    expect(resolveHistoricalWp10EvidenceDir()).not.toContain("undefined");
  });
});
