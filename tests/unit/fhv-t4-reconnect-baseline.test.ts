import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
  type FhvT4ContinuitySnapshotV1,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import { computeFhvT4ObserverSystemdIdentityDigest } from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";
import {
  serializeFhvT4ObserverQualificationProof,
  type FhvT4ObserverQualificationProofV1,
} from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import {
  fhvT4aBindingDigest,
  fhvT4aFullBindingFields,
  type FhvT4aPostBeforeReceiptV1,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import { revalidateFhvT4aReconnectBaseline } from "@/lib/trader/observability/fhv-t4a-reconnect-baseline";
import type {
  FhvT4aRemoteFsExistsOperation,
  FhvT4aRemoteFsReadOperation,
  FhvT4aRemoteFsSha256Operation,
} from "@/lib/trader/observability/fhv-t4a-remote-fs-ops";
import {
  fhvT4CompletedCampaignIdentity,
  fhvT4ObserverIdentity,
} from "../helpers/fhv-t4-test-fixtures";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4a-reconnect";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const APPROVED_ROOT = "/remote/artifacts";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function buildBindings(): FhvT4aOperatorBindings {
  return {
    execHost: "exec.test",
    sshUser: "operator",
    localReleaseRoot: "/tmp/release",
    localStateDir: "/tmp/state",
    localNodeBin: "/usr/bin/node",
    localGitBin: "/usr/bin/git",
    localSshBin: "/usr/bin/ssh",
    targetSha: TARGET_SHA,
    releaseTag: "local-dev",
    originUrl: "https://github.com/example/waia.git",
    runId: RUN_ID,
    organizationId: ORG_ID,
    operatorId: "operator-test",
    serviceUser: "fhv",
    environmentFile: "/etc/fhv.env",
    artifactRoot: APPROVED_ROOT,
    checkoutParent: "/remote/checkouts",
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "a".repeat(64),
    nodeBin: "/usr/bin/node",
    corepackBin: "/usr/bin/corepack",
    gitBin: "/usr/bin/git",
    pythonBin: "/usr/bin/python3",
    dockerBin: "/usr/bin/docker",
    systemctlBin: "/usr/bin/systemctl",
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
    workstationTracePath: "/tmp/trace.jsonl",
  };
}

function buildContinuitySnapshot(
  overrides: Partial<FhvT4ContinuitySnapshotV1> = {},
): FhvT4ContinuitySnapshotV1 {
  const observer = fhvT4ObserverIdentity({
    invocationId: "11111111111111111111111111111111",
    mainPid: 1001,
    bootId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const campaign = fhvT4CompletedCampaignIdentity({
    invocationId: "cccccccccccccccccccccccccccccccc",
  });
  const digests = {
    manifest: "1".repeat(64),
    terminal: "2".repeat(64),
    checkpoint: "3".repeat(64),
    economicFrontier: "4".repeat(64),
    resumeRuntimeProof: "5".repeat(64),
    runChainManifest: "6".repeat(64),
    deploymentRecord: "7".repeat(64),
    commandLedger: "8".repeat(64),
    campaignRuntimeProof: "9".repeat(64),
  };
  const withoutDigest = {
    schemaVersion: FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    capturePhase: "before_disconnect" as const,
    observerSystemdIdentity: observer,
    campaignSystemdIdentity: campaign,
    digests,
    ...overrides,
  };
  return {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
}

function buildPreQualProof(): FhvT4ObserverQualificationProofV1 {
  return serializeFhvT4ObserverQualificationProof({
    schemaVersion: "fhv-t4-observer-qualification-proof/v1",
    phase: "PRE_CAMPAIGN",
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    unitName: "waia-fhv-observer.service",
    identityBeforeCapture: {
      unitName: "waia-fhv-observer.service",
      bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      invocationId: "11111111111111111111111111111111",
      mainPid: 1001,
      activeEnterTimestampMonotonicUs: "1000000",
      activeState: "active",
    },
    identityAfterCapture: {
      unitName: "waia-fhv-observer.service",
      bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      invocationId: "11111111111111111111111111111111",
      mainPid: 1001,
      activeEnterTimestampMonotonicUs: "1000000",
      activeState: "active",
    },
    statusDigest: "status-digest",
    capturedAtUtc: new Date().toISOString(),
  });
}

function buildPostBeforeReceipt(input: {
  continuity: FhvT4ContinuitySnapshotV1;
  preQual: FhvT4ObserverQualificationProofV1;
  bindings: FhvT4aOperatorBindings;
}): FhvT4aPostBeforeReceiptV1 {
  const continuityRaw = `${JSON.stringify(input.continuity, null, 2)}\n`;
  const preQualRaw = `${JSON.stringify(input.preQual, null, 2)}\n`;
  const continuityPath = `${APPROVED_ROOT}/continuity-before.json`;
  const preQualPath = `${APPROVED_ROOT}/pre-qual.json`;
  const withoutDigest = {
    schemaVersion: "fhv-t4a-post-before-receipt/v1" as const,
    targetSha: input.bindings.targetSha,
    releaseTag: input.bindings.releaseTag,
    runId: input.bindings.runId,
    organizationId: input.bindings.organizationId,
    execHost: input.bindings.execHost,
    sshUser: input.bindings.sshUser,
    bindingDigest: fhvT4aBindingDigest(fhvT4aFullBindingFields(input.bindings)),
    runDir: `${APPROVED_ROOT}/run`,
    continuityBeforePath: continuityPath,
    continuityBeforeDigest: sha256Hex(continuityRaw),
    observerIdentityDigest: computeFhvT4ObserverSystemdIdentityDigest(
      input.continuity.observerSystemdIdentity,
    ),
    campaignIdentityDigest: input.continuity.campaignSystemdIdentity.contentDigest,
    observerQualificationPrePath: preQualPath,
    observerQualificationPreDigest: sha256Hex(preQualRaw),
    stepProofDigests: {},
  };
  return {
    ...withoutDigest,
    completedAtUtc: new Date().toISOString(),
    contentDigest: computePayloadDigest(withoutDigest),
  };
}

function createOperationTransport(files: Map<string, string>): FhvT4aOperatorTransport {
  return {
    kind: "hermetic",
    approvedRemoteRoots: [APPROVED_ROOT],
    remoteReadByteCap: 1024 * 1024,
    remoteWriteCount: () => 0,
    resetRemoteWrites: () => undefined,
    sshInvocations: () => [],
    preauthLedgerEntries: () => [],
    preauthMutatingCommandCount: () => 0,
    ssh: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    sudoNoninteractiveProbe: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    gitShowBlob: () => "",
    localGit: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    remoteFileExists: (op: FhvT4aRemoteFsExistsOperation) => files.has(op.remotePath),
    readRemoteFile: (op: FhvT4aRemoteFsReadOperation) => {
      const content = files.get(op.remotePath);
      if (content === undefined) {
        throw new Error(`missing remote file: ${op.remotePath}`);
      }
      return content;
    },
    remoteSha256: (op: FhvT4aRemoteFsSha256Operation) => sha256Hex(files.get(op.remotePath) ?? ""),
  };
}

describe("revalidateFhvT4aReconnectBaseline negatives (DEE-436 F-02)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  function baselineFixture(): {
    bindings: FhvT4aOperatorBindings;
    postBeforeReceipt: FhvT4aPostBeforeReceiptV1;
    transport: FhvT4aOperatorTransport;
  } {
    root = mkdtempSync(join(tmpdir(), "fhv-reconnect-"));
    const bindings = buildBindings();
    const continuity = buildContinuitySnapshot();
    const preQual = buildPreQualProof();
    const continuityRaw = `${JSON.stringify(continuity, null, 2)}\n`;
    const preQualRaw = `${JSON.stringify(preQual, null, 2)}\n`;
    const postBeforeReceipt = buildPostBeforeReceipt({ bindings, continuity, preQual });
    const files = new Map<string, string>([
      [postBeforeReceipt.continuityBeforePath, continuityRaw],
      [postBeforeReceipt.observerQualificationPrePath, preQualRaw],
    ]);
    return {
      bindings,
      postBeforeReceipt,
      transport: createOperationTransport(files),
    };
  }

  it("accepts a valid reconnect baseline", () => {
    const fixture = baselineFixture();
    const baseline = revalidateFhvT4aReconnectBaseline(fixture);
    expect(baseline.continuityBefore.runId).toBe(RUN_ID);
    expect(baseline.preQualificationProof.phase).toBe("PRE_CAMPAIGN");
  });

  it("rejects invalid continuity schemaVersion", () => {
    const fixture = baselineFixture();
    const badContinuity = buildContinuitySnapshot({
      schemaVersion:
        "fhv-t4-continuity-snapshot/v0" as typeof FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
    });
    try {
      revalidateFhvT4aReconnectBaseline(withContinuityFixture(fixture, badContinuity));
      expect.unreachable("invalid continuity schema should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4aOperatorError);
      expect((error as FhvT4aOperatorError).code).toBe("RECONNECT_CONTINUITY_NOT_STRICTLY_PARSED");
    }
  });

  it("rejects invalid continuity contentDigest", () => {
    const fixture = baselineFixture();
    const badContinuity = { ...buildContinuitySnapshot(), contentDigest: "deadbeef" };
    try {
      revalidateFhvT4aReconnectBaseline(withContinuityFixture(fixture, badContinuity));
      expect.unreachable("invalid continuity contentDigest should fail");
    } catch (error) {
      expect((error as FhvT4aOperatorError).code).toBe("FHV_T4A_CONTINUITY_BEFORE_DIGEST_INVALID");
    }
  });

  it("rejects changed runId/orgId/targetSha in continuity-before", () => {
    for (const [field, value, code] of [
      ["runId", "other-run", "FHV_T4A_CONTINUITY_BEFORE_RUN_MISMATCH"],
      [
        "organizationId",
        "00000000-0000-4000-8000-000000000999",
        "FHV_T4A_CONTINUITY_BEFORE_ORG_MISMATCH",
      ],
      ["targetSha", "e".repeat(40), "FHV_T4A_CONTINUITY_BEFORE_SHA_MISMATCH"],
    ] as const) {
      const fixture = baselineFixture();
      const badContinuity = buildContinuitySnapshot({ [field]: value });
      try {
        revalidateFhvT4aReconnectBaseline(withContinuityFixture(fixture, badContinuity));
        expect.unreachable(`${field} mismatch should fail`);
      } catch (error) {
        expect(error).toBeInstanceOf(FhvT4aOperatorError);
        expect((error as FhvT4aOperatorError).code).toBe(code);
      }
    }
  });

  it("rejects wrong capturePhase", () => {
    const fixture = baselineFixture();
    const badContinuity = buildContinuitySnapshot({
      capturePhase: "after_reconnect",
    });
    try {
      revalidateFhvT4aReconnectBaseline(withContinuityFixture(fixture, badContinuity));
      expect.unreachable("wrong capturePhase should fail");
    } catch (error) {
      expect((error as FhvT4aOperatorError).code).toBe("FHV_T4A_CONTINUITY_BEFORE_PHASE_INVALID");
    }
  });

  it("rejects malformed observer/campaign identity", () => {
    const fixture = baselineFixture();
    const badContinuity = buildContinuitySnapshot({
      observerSystemdIdentity: {
        ...fhvT4ObserverIdentity({
          invocationId: "11111111111111111111111111111111",
          mainPid: 1234,
          bootId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
        mainPid: -1,
      },
    });
    try {
      revalidateFhvT4aReconnectBaseline(withContinuityFixture(fixture, badContinuity));
      expect.unreachable("malformed observer identity should fail");
    } catch (error) {
      expect((error as FhvT4aOperatorError).code).toBe(
        "FHV_T4A_CONTINUITY_BEFORE_IDENTITY_INVALID",
      );
    }
  });

  it("rejects changed identity digests versus receipt", () => {
    const fixture = baselineFixture();
    try {
      revalidateFhvT4aReconnectBaseline({
        ...fixture,
        postBeforeReceipt: {
          ...fixture.postBeforeReceipt,
          observerIdentityDigest: "f".repeat(64),
        },
      });
      expect.unreachable("observer digest mismatch should fail");
    } catch (error) {
      expect((error as FhvT4aOperatorError).code).toBe("OBSERVER_BASELINE_DIGEST_UNUSED");
    }

    try {
      revalidateFhvT4aReconnectBaseline({
        ...fixture,
        postBeforeReceipt: {
          ...fixture.postBeforeReceipt,
          campaignIdentityDigest: "f".repeat(64),
        },
      });
      expect.unreachable("campaign digest mismatch should fail");
    } catch (error) {
      expect((error as FhvT4aOperatorError).code).toBe(
        "CROSS_PHASE_CAMPAIGN_BASELINE_NOT_PERSISTED",
      );
    }
  });

  it("rejects binding identity mismatch on post-before receipt", () => {
    const fixture = baselineFixture();
    try {
      revalidateFhvT4aReconnectBaseline({
        ...fixture,
        postBeforeReceipt: {
          ...fixture.postBeforeReceipt,
          runId: "changed-run",
        },
      });
      expect.unreachable("runId mismatch should fail");
    } catch (error) {
      expect((error as FhvT4aOperatorError).code).toBe(
        "FHV_T4A_POST_BEFORE_RECEIPT_IDENTITY_MISMATCH",
      );
    }
  });
});

function withContinuityFixture(
  fixture: {
    bindings: FhvT4aOperatorBindings;
    postBeforeReceipt: FhvT4aPostBeforeReceiptV1;
    transport: FhvT4aOperatorTransport;
  },
  continuity: FhvT4ContinuitySnapshotV1,
): {
  bindings: FhvT4aOperatorBindings;
  postBeforeReceipt: FhvT4aPostBeforeReceiptV1;
  transport: FhvT4aOperatorTransport;
} {
  const continuityRaw = `${JSON.stringify(continuity, null, 2)}\n`;
  const preQualRaw = fixture.transport.readRemoteFile({
    remotePath: fixture.postBeforeReceipt.observerQualificationPrePath,
    approvedRoots: [APPROVED_ROOT],
    locus: "REMOTE_ROOT",
    pythonBin: "/usr/bin/python3",
    byteCap: 1024 * 1024,
  });
  const postBeforeReceipt = {
    ...fixture.postBeforeReceipt,
    continuityBeforeDigest: sha256Hex(continuityRaw),
  };
  const files = new Map<string, string>([
    [postBeforeReceipt.continuityBeforePath, continuityRaw],
    [postBeforeReceipt.observerQualificationPrePath, preQualRaw],
  ]);
  return {
    bindings: fixture.bindings,
    postBeforeReceipt,
    transport: createOperationTransport(files),
  };
}
