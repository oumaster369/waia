import { describe, expect, it } from "vitest";

import { resolveExpectedEffectiveUid } from "@/scripts/ops/fhv-t4a-operator";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import type { FhvT4aPreauthReceiptV1 } from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import { FHV_T4_TEST_SERVICE_USER_IDS } from "../helpers/fhv-t4-test-fixtures";

function preauthReceipt(serviceUid: number): FhvT4aPreauthReceiptV1 {
  return {
    schemaVersion: "fhv-t4a-preauth-receipt/v1",
    targetSha: "a".repeat(40),
    releaseTag: "local-dev",
    originUrl: "https://github.com/example/waia.git",
    execHost: "exec.test",
    sshUser: "operator",
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "b".repeat(64),
    serviceUser: "fhv",
    serviceUid,
    serviceGid: serviceUid,
    runId: "run",
    organizationId: "00000000-0000-4000-8000-000000000436",
    nodeBin: "/usr/bin/node",
    corepackBin: "/usr/bin/corepack",
    gitBin: "/usr/bin/git",
    pythonBin: "/usr/bin/python3",
    dockerBin: "/usr/bin/docker",
    systemctlBin: "/usr/bin/systemctl",
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
    legacyContainerName: "ai-trader-execution-host",
    legacyContainerImage: "waia-execution-host:test",
    bootstrapBlobDigests: {},
    bindingDigest: "c".repeat(64),
    preauthLedger: [],
    preauthLedgerDigest: "d".repeat(64),
    rejectedCommandCount: 0,
    mutatingCommandCount: 0,
    preflightHostFacts: {
      hostname: "exec.test",
      machineIdSha256: "b".repeat(64),
      serviceUser: "fhv",
      serviceUid,
      serviceGid: serviceUid,
      servicePrimaryGroup: "fhv",
      environmentFile: "/etc/fhv.env",
      artifactRoot: "/var/fhv/artifacts",
      checkoutParent: "/var/fhv/checkouts",
      nodeBin: "/usr/bin/node",
      corepackBin: "/usr/bin/corepack",
      gitBin: "/usr/bin/git",
      pythonBin: "/usr/bin/python3",
      dockerBin: "/usr/bin/docker",
      systemctlBin: "/usr/bin/systemctl",
      systemdAnalyzeBin: "/usr/bin/systemd-analyze",
      legacyContainerName: "ai-trader-execution-host",
      legacyContainerImage: "waia-execution-host:test",
      legacyContainerState: "running",
      hostBootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      minimumFreeKiB: 1000,
      observedFreeKiB: 5000,
      hostMonotonicSample: {},
    },
    completedAtUtc: new Date().toISOString(),
    contentDigest: "e".repeat(64),
    supervisorResidualState: {
      schemaVersion: "fhv-t4-supervisor-residual-state/v1",
      expectedRunId: "run",
      expectedTargetSha: "a".repeat(40),
      expectedOrganizationId: "00000000-0000-4000-8000-000000000436",
      expectedHostname: "exec.test",
      expectedMachineIdSha256: "b".repeat(64),
      observedHostname: "exec.test",
      observedMachineIdSha256: "b".repeat(64),
      hostBootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      units: [],
    },
    supervisorResidualStateDigest: "f".repeat(64),
    supervisorResidualClassification: "FHV_T4A_SUPERVISOR_RESIDUAL_SAFE",
  };
}

describe("resolveExpectedEffectiveUid trace emission (DEE-436 F-08)", () => {
  it("uses PRE_AUTH receipt serviceUid 1001 for SERVICE_USER locus", () => {
    const receipt = preauthReceipt(FHV_T4_TEST_SERVICE_USER_IDS.uid);
    expect(resolveExpectedEffectiveUid("SERVICE_USER", receipt)).toBe(1001);
    expect(resolveExpectedEffectiveUid("SERVICE_USER", receipt)).not.toBe(1000);
  });

  it("falls back to preflightHostFacts.serviceUid when top-level serviceUid absent", () => {
    const receipt = preauthReceipt(1001);
    const { serviceUid: _ignored, ...withoutTopLevelUid } = receipt;
    expect(
      resolveExpectedEffectiveUid("SERVICE_USER", {
        ...withoutTopLevelUid,
        serviceUid: undefined as unknown as number,
      }),
    ).toBe(1001);
  });

  it("returns 0 for REMOTE_ROOT and n/a for other loci", () => {
    expect(resolveExpectedEffectiveUid("REMOTE_ROOT", undefined)).toBe(0);
    expect(resolveExpectedEffectiveUid("SSH_USER", preauthReceipt(1001))).toBe("n/a");
  });

  it("rejects SERVICE_USER trace when service UID is missing", () => {
    expect(() => resolveExpectedEffectiveUid("SERVICE_USER", undefined)).toThrow(
      FhvT4aOperatorError,
    );
    try {
      resolveExpectedEffectiveUid("SERVICE_USER", undefined);
    } catch (error) {
      expect((error as FhvT4aOperatorError).code).toBe("STEP_TRACE_SERVICE_UID_HARDCODED");
    }
  });
});
