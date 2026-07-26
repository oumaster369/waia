/**
 * DEE-436 — observer qualification proof capture (mandatory steps 15 / 29).
 */

import { createHash } from "node:crypto";

import type { FhvT4CompletedCampaignSystemdIdentityV1 } from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import { parseFhvT4CompletedCampaignSystemdIdentity } from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import type { FhvT4ObserverQualificationPhase } from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import {
  resolveFhvT4ObserverQualificationProofPath,
  type FhvT4ObserverQualificationProofUnsignedV1,
} from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import type { FhvT4aExecContext } from "@/lib/trader/observability/fhv-t4a-operator-executor";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

type SystemdIdentity = Readonly<{
  bootId: string;
  invocationId: string;
  mainPid: number;
  activeEnterTimestampMonotonicUs: string;
  activeState: string;
}>;

function readObserverIdentity(ctx: FhvT4aExecContext): SystemdIdentity {
  const b = ctx.bindings;
  const cmd = [
    `"${ctx.repoRoot}/scripts/ops/fhv-t4-observer-systemd-identity-read.sh"`,
    `--systemctl-bin ${shellQuote(b.systemctlBin)}`,
    `--python-bin ${shellQuote(b.pythonBin)}`,
    "waia-fhv-observer.service",
  ].join(" ");
  const result = ctx.transport.ssh({ remoteCommand: cmd, asRoot: true });
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_IDENTITY_READ_FAILED",
      result.stderr || result.stdout,
    );
  }
  return JSON.parse(result.stdout.trim()) as SystemdIdentity;
}

function readCompletedCampaignIdentity(
  ctx: FhvT4aExecContext,
): FhvT4CompletedCampaignSystemdIdentityV1 {
  const b = ctx.bindings;
  const cmd = [
    `"${ctx.repoRoot}/scripts/ops/fhv-t4-campaign-systemd-identity-read.sh"`,
    `--systemctl-bin ${shellQuote(b.systemctlBin)}`,
    `--python-bin ${shellQuote(b.pythonBin)}`,
    "waia-fhv-campaign.service",
  ].join(" ");
  const result = ctx.transport.ssh({ remoteCommand: cmd, asRoot: true });
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_CAMPAIGN_IDENTITY_READ_FAILED",
      result.stderr || result.stdout,
    );
  }
  return parseFhvT4CompletedCampaignSystemdIdentity(JSON.parse(result.stdout.trim()));
}

function identityArgs(ctx: FhvT4aExecContext): readonly string[] {
  const b = ctx.bindings;
  return [
    "--run-root",
    ctx.runDir,
    "--run-id",
    b.runId,
    "--organization-id",
    b.organizationId,
    "--target-sha",
    b.targetSha,
  ];
}

function serviceUserExec(
  ctx: FhvT4aExecContext,
  packageScript: string,
  args: readonly string[],
): { exitCode: number; stdout: string; stderr: string } {
  const b = ctx.bindings;
  const cmd = [
    `"${ctx.repoRoot}/scripts/ops/fhv-t4-service-user-exec.sh"`,
    `--service-user ${shellQuote(b.serviceUser)}`,
    `--environment-file ${shellQuote(b.environmentFile)}`,
    `--repo-root ${shellQuote(ctx.repoRoot)}`,
    `--node-bin ${shellQuote(b.nodeBin)}`,
    `--corepack-bin ${shellQuote(b.corepackBin)}`,
    `-- ${packageScript}`,
    ...args.map(shellQuote),
  ].join(" ");
  return ctx.transport.ssh({ remoteCommand: cmd, asRoot: true });
}

export type FhvT4aObserverQualificationResult = Readonly<{
  proofPath: string;
  proofDigest: string;
  statusDigest: string;
  observerIdentity: SystemdIdentity;
  completedCampaignIdentity?: FhvT4CompletedCampaignSystemdIdentityV1;
}>;

export function captureFhvT4aObserverQualification(
  ctx: FhvT4aExecContext,
  phase: FhvT4ObserverQualificationPhase,
  priorObserverInvocationId?: string,
): FhvT4aObserverQualificationResult {
  const b = ctx.bindings;
  const proofPath = resolveFhvT4ObserverQualificationProofPath(ctx.runDir, phase);

  const waitCmd = [
    `"${ctx.repoRoot}/scripts/ops/fhv-t4-observer-wait-active.sh"`,
    `--systemctl-bin ${shellQuote(b.systemctlBin)}`,
    `--python-bin ${shellQuote(b.pythonBin)}`,
    "waia-fhv-observer.service 60000",
  ].join(" ");
  const wait = ctx.transport.ssh({ remoteCommand: waitCmd, asRoot: true });
  if (wait.exitCode !== 0) {
    throw new FhvT4aOperatorError("FHV_T4A_OBSERVER_WAIT_FAILED", wait.stderr || wait.stdout);
  }

  const identityBefore = readObserverIdentity(ctx);
  const status = serviceUserExec(ctx, "trader:fhv:t4:status", identityArgs(ctx));
  if (status.exitCode !== 0) {
    throw new FhvT4aOperatorError("FHV_T4A_OBSERVER_STATUS_FAILED", status.stderr || status.stdout);
  }
  const identityAfter = readObserverIdentity(ctx);

  let completedCampaignIdentity: FhvT4CompletedCampaignSystemdIdentityV1 | undefined;
  if (phase === "POST_RESTART") {
    completedCampaignIdentity = readCompletedCampaignIdentity(ctx);
    if (priorObserverInvocationId && identityAfter.invocationId === priorObserverInvocationId) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_OBSERVER_RESTART_IDENTITY_UNCHANGED",
        "Post-restart observer invocation must change.",
      );
    }
  }

  const statusDigest = sha256Hex(status.stdout);
  const unsignedPayload: FhvT4ObserverQualificationProofUnsignedV1 = {
    schemaVersion: "fhv-t4-observer-qualification-proof/v1",
    phase,
    runId: b.runId,
    organizationId: b.organizationId,
    targetSha: b.targetSha,
    bootId: identityAfter.bootId,
    unitName: "waia-fhv-observer.service",
    identityBeforeCapture: {
      invocationId: identityBefore.invocationId,
      mainPid: identityBefore.mainPid,
      activeEnterTimestampMonotonicUs: identityBefore.activeEnterTimestampMonotonicUs,
      activeState: identityBefore.activeState,
    },
    identityAfterCapture: {
      invocationId: identityAfter.invocationId,
      mainPid: identityAfter.mainPid,
      activeEnterTimestampMonotonicUs: identityAfter.activeEnterTimestampMonotonicUs,
      activeState: identityAfter.activeState,
    },
    statusDigest,
    capturedAtUtc: new Date().toISOString(),
    ...(phase === "POST_RESTART" && completedCampaignIdentity
      ? {
          completedCampaignIdentityDigest: completedCampaignIdentity.contentDigest,
        }
      : {}),
  };

  const writeResult = serviceUserExec(ctx, "trader:fhv:t4:write-observer-qualification-proof", [
    ...identityArgs(ctx),
    "--phase",
    phase,
    "--output",
    proofPath,
    "--proof-json",
    JSON.stringify(unsignedPayload),
  ]);
  if (writeResult.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_QUALIFICATION_WRITE_FAILED",
      writeResult.stderr || writeResult.stdout,
    );
  }
  if (!ctx.transport.remoteFileExists(proofPath)) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_QUALIFICATION_PROOF_MISSING",
      "Observer qualification proof missing after write.",
    );
  }
  const remoteDigest = ctx.transport.remoteSha256(proofPath);
  return {
    proofPath,
    proofDigest: remoteDigest,
    statusDigest,
    observerIdentity: identityAfter,
    completedCampaignIdentity,
  };
}

/** Service-user publication is owned by closure CLI; workstation capture stays unsigned-only. */
