import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  verifyFhvT4DeploymentProofArtifact,
  writeFhvT4DeploymentProofAtomic,
} from "@/lib/trader/observability/fhv-t4-deployment-proof";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4a-deploy-proof";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const RELEASE_TAG = "v2026.07.24.test436";

let root = "";

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
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
    deploymentRecordDigest: "c".repeat(64),
    legacyContainerName: "ai-trader-execution-host" as const,
    legacyContainerImage: "waia-execution-host:bp6" as const,
    legacyContainerRunning: true,
    hostBootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    hostProbeProofDigest: "d".repeat(64),
    capturedAtUtc: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("fhv-t4 deployment proof v2 (DEE-436)", () => {
  it("rejects false legacy running, wrong image, and unit field mismatches", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-deploy-proof-"));
    const runDir = join(root, "run");
    mkdirSync(join(runDir, "control"), { recursive: true });

    expect(() =>
      writeFhvT4DeploymentProofAtomic(runDir, baseInput({ legacyContainerRunning: false })),
    ).toThrow(/legacyContainerRunning=true/i);

    expect(() =>
      writeFhvT4DeploymentProofAtomic(
        runDir,
        baseInput({ legacyContainerImage: "waia-execution-host:wrong" }),
      ),
    ).toThrow(/legacy container identity invalid/i);

    expect(() => writeFhvT4DeploymentProofAtomic(runDir, baseInput({ unitUser: "root" }))).toThrow(
      /User\/WorkingDirectory\/EnvironmentFile/i,
    );

    expect(() =>
      writeFhvT4DeploymentProofAtomic(runDir, baseInput({ unitWorkingDirectory: "/tmp/evil" })),
    ).toThrow(/User\/WorkingDirectory\/EnvironmentFile/i);

    expect(() =>
      writeFhvT4DeploymentProofAtomic(runDir, baseInput({ unitEnvironmentFile: "/tmp/evil.env" })),
    ).toThrow(/User\/WorkingDirectory\/EnvironmentFile/i);
  });

  it("rejects stale proof from another run on verify", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-deploy-stale-"));
    const runDir = join(root, "run");
    mkdirSync(join(runDir, "control"), { recursive: true });
    writeFhvT4DeploymentProofAtomic(runDir, baseInput());
    expect(() =>
      verifyFhvT4DeploymentProofArtifact({
        runRoot: runDir,
        targetSha: TARGET_SHA,
        releaseTag: RELEASE_TAG,
        runId: "other-run",
        organizationId: ORG_ID,
        serviceUser: "fhv",
        workingDirectory: "/opt/waia",
        environmentFile: "/etc/waia/fhv.env",
      }),
    ).toThrow(/identity|mismatch/i);
  });
});
