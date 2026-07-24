import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  verifyFhvT4Ceremony,
  verifyFhvT4DeploymentTruth,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import { writeFhvT4DeploymentProofAtomic } from "@/lib/trader/observability/fhv-t4-deployment-proof";
import {
  verifyFhvT4RollbackProofArtifact,
  writeFhvT4RollbackProofAtomic,
} from "@/lib/trader/observability/fhv-t4-rollback-proof";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import { writeFhvSystemdDeployedRevisionAtomic } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4a-ceremony";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const RELEASE_TAG = "v2026.07.24.test436";

let root = "";

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

describe("fhv-t4 physically consistent ceremony proofs (DEE-436)", () => {
  it("binds rollback proof after deployment proof without live installed units", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-ceremony-"));
    const runDir = materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
        t4DeterministicPause: true,
      }),
    ).runDir;
    mkdirSync(join(runDir, "control"), { recursive: true });

    const rendered = join(root, "rendered");
    const installed = join(root, "installed");
    mkdirSync(rendered, { recursive: true });
    mkdirSync(installed, { recursive: true });
    const unitBody = `[Service]\nUser=fhv\nWorkingDirectory=/opt/waia\nEnvironmentFile=/etc/waia/fhv.env\nEnvironment=FHV_TARGET_SHA=${TARGET_SHA}\nEnvironment=FHV_RUN_ID=${RUN_ID}\nEnvironment=FHV_ORGANIZATION_ID=${ORG_ID}\n`;
    for (const unit of [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT]) {
      writeFileSync(join(rendered, unit), unitBody);
      writeFileSync(join(installed, unit), unitBody);
    }
    const unitDigest = createHash("sha256").update(unitBody).digest("hex");
    writeFhvSystemdDeployedRevisionAtomic(root, {
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      renderedUnitDigests: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: unitDigest,
        [FHV_SYSTEMD_OBSERVER_UNIT]: unitDigest,
      },
      installedAtUtc: new Date().toISOString(),
      operatorId: "t4-operator",
      serviceUser: "fhv",
      legacyContainerRunning: true,
    });
    const deployment = verifyFhvT4DeploymentTruth({
      repoRoot: root,
      targetSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      serviceUser: "fhv",
      workingDirectory: "/opt/waia",
      environmentFile: "/etc/waia/fhv.env",
      renderedUnitsDir: rendered,
      installedUnitsDir: installed,
    });
    const record = JSON.parse(
      readFileSync(join(root, ".ops/fhv-systemd-deployed-revision.v1.json"), "utf8"),
    );
    const deploymentProof = writeFhvT4DeploymentProofAtomic(runDir, {
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      serviceUser: "fhv",
      workingDirectory: "/opt/waia",
      environmentFile: "/etc/waia/fhv.env",
      unitUser: "fhv",
      unitWorkingDirectory: "/opt/waia",
      unitEnvironmentFile: "/etc/waia/fhv.env",
      renderedUnitDigests: deployment.installedDigests,
      installedUnitDigests: deployment.installedDigests,
      deploymentRecordDigest: computePayloadDigest(record),
      legacyContainerName: "ai-trader-execution-host",
      legacyContainerImage: "waia-execution-host:bp6",
      legacyContainerRunning: true,
      hostBootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      hostProbeProofDigest: "c".repeat(64),
      capturedAtUtc: new Date().toISOString(),
    });

    rmSync(installed, { recursive: true, force: true });
    writeFhvT4RollbackProofAtomic(runDir, {
      releaseSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      unitActiveStates: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "inactive",
        [FHV_SYSTEMD_OBSERVER_UNIT]: "inactive",
      },
      unitEnabledStates: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "disabled",
        [FHV_SYSTEMD_OBSERVER_UNIT]: "disabled",
      },
      unitFilesPresent: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: false,
        [FHV_SYSTEMD_OBSERVER_UNIT]: false,
      },
      residualProcesses: [],
      legacyContainerName: "ai-trader-execution-host",
      legacyContainerImage: "waia-execution-host:bp6",
      legacyContainerRunning: true,
      deploymentRecordDigest: computePayloadDigest(record),
      capturedAtUtc: new Date(Date.now() + 1000).toISOString(),
    });

    expect(
      verifyFhvT4RollbackProofArtifact({
        runRoot: runDir,
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        deploymentProof,
      }).contentDigest,
    ).toBeTruthy();
  });

  it("rejects rollback proof captured before deployment proof", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-ceremony-order-"));
    const runDir = materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
        t4DeterministicPause: true,
      }),
    ).runDir;
    mkdirSync(join(runDir, "control"), { recursive: true });
    writeFhvSystemdDeployedRevisionAtomic(root, {
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      renderedUnitDigests: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "a".repeat(64),
        [FHV_SYSTEMD_OBSERVER_UNIT]: "b".repeat(64),
      },
      installedAtUtc: new Date().toISOString(),
      operatorId: "t4-operator",
      serviceUser: "fhv",
      legacyContainerRunning: true,
    });
    const recordDigest = computePayloadDigest(
      JSON.parse(readFileSync(join(root, ".ops/fhv-systemd-deployed-revision.v1.json"), "utf8")),
    );
    const deploymentProof = writeFhvT4DeploymentProofAtomic(runDir, {
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      serviceUser: "fhv",
      workingDirectory: "/opt/waia",
      environmentFile: "/etc/waia/fhv.env",
      unitUser: "fhv",
      unitWorkingDirectory: "/opt/waia",
      unitEnvironmentFile: "/etc/waia/fhv.env",
      renderedUnitDigests: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "a".repeat(64),
        [FHV_SYSTEMD_OBSERVER_UNIT]: "b".repeat(64),
      },
      installedUnitDigests: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "a".repeat(64),
        [FHV_SYSTEMD_OBSERVER_UNIT]: "b".repeat(64),
      },
      deploymentRecordDigest: recordDigest,
      legacyContainerName: "ai-trader-execution-host",
      legacyContainerImage: "waia-execution-host:bp6",
      legacyContainerRunning: true,
      hostBootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      hostProbeProofDigest: "c".repeat(64),
      capturedAtUtc: new Date(Date.now() + 5000).toISOString(),
    });
    writeFhvT4RollbackProofAtomic(runDir, {
      releaseSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      unitActiveStates: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "inactive",
        [FHV_SYSTEMD_OBSERVER_UNIT]: "inactive",
      },
      unitEnabledStates: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "disabled",
        [FHV_SYSTEMD_OBSERVER_UNIT]: "disabled",
      },
      unitFilesPresent: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: false,
        [FHV_SYSTEMD_OBSERVER_UNIT]: false,
      },
      residualProcesses: [],
      legacyContainerName: "ai-trader-execution-host",
      legacyContainerImage: "waia-execution-host:bp6",
      legacyContainerRunning: true,
      deploymentRecordDigest: recordDigest,
      capturedAtUtc: new Date().toISOString(),
    });
    expect(() =>
      verifyFhvT4RollbackProofArtifact({
        runRoot: runDir,
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        deploymentProof,
      }),
    ).toThrow(/ORDERING_INVALID|after deployment proof/i);
  });

  it("verify-ceremony fails closed without immutable proofs and seal", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-ceremony-neg-"));
    const runDir = materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
        t4DeterministicPause: true,
      }),
    ).runDir;
    expect(() =>
      verifyFhvT4Ceremony({
        identity: {
          runRoot: runDir,
          runId: RUN_ID,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
          releaseTag: RELEASE_TAG,
          repoRoot: root,
        },
        sealDestination: join(root, "missing-seal"),
        continuityBeforePath: join(runDir, "control/continuity-before.json"),
        continuityAfterPath: join(runDir, "control/continuity-after.json"),
        serviceUser: "fhv",
        workingDirectory: "/opt/waia",
        environmentFile: "/etc/waia/fhv.env",
      }),
    ).toThrow();
  });
});
