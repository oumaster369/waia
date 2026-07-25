/**
 * DEE-436 — observer qualification proof capture (mandatory steps 15 / 29).
 */

import { createHash } from "node:crypto";

import type { FhvT4ObserverQualificationPhase } from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import { serializeFhvT4ObserverQualificationProof } from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import type { FhvT4aExecContext } from "@/lib/trader/observability/fhv-t4a-operator-executor";
import { FhvT4aOperatorError } from "@/scripts/ops/fhv-t4a-operator";

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

function readCompletedCampaignIdentity(ctx: FhvT4aExecContext): SystemdIdentity {
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
  return JSON.parse(result.stdout.trim()) as SystemdIdentity;
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
  extraEnv?: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const b = ctx.bindings;
  const envPrefix = extraEnv
    ? Object.entries(extraEnv)
        .map(([key, value]) => `${key}=${shellQuote(value)}`)
        .join(" ")
    : "";
  const cmd = [
    envPrefix,
    `"${ctx.repoRoot}/scripts/ops/fhv-t4-service-user-exec.sh"`,
    `--service-user ${shellQuote(b.serviceUser)}`,
    `--environment-file ${shellQuote(b.environmentFile)}`,
    `--repo-root ${shellQuote(ctx.repoRoot)}`,
    `--node-bin ${shellQuote(b.nodeBin)}`,
    `--corepack-bin ${shellQuote(b.corepackBin)}`,
    `-- ${packageScript}`,
    ...args.map(shellQuote),
  ]
    .filter(Boolean)
    .join(" ");
  return ctx.transport.ssh({ remoteCommand: cmd, asRoot: true });
}

export type FhvT4aObserverQualificationResult = Readonly<{
  proofPath: string;
  proofDigest: string;
  statusDigest: string;
  observerIdentity: SystemdIdentity;
  completedCampaignIdentity: SystemdIdentity;
}>;

export function captureFhvT4aObserverQualification(
  ctx: FhvT4aExecContext,
  phase: FhvT4ObserverQualificationPhase,
  priorObserverInvocationId?: string,
): FhvT4aObserverQualificationResult {
  const b = ctx.bindings;
  const proofPath =
    phase === "PRE_CAMPAIGN"
      ? `${ctx.runDir}/control/fhv-t4-observer-qualification-pre-campaign.v1.json`
      : `${ctx.runDir}/control/fhv-t4-observer-qualification-post-restart.v1.json`;

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
  const completedCampaignIdentity = readCompletedCampaignIdentity(ctx);

  if (phase === "POST_RESTART" && priorObserverInvocationId) {
    if (identityAfter.invocationId === priorObserverInvocationId) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_OBSERVER_RESTART_IDENTITY_UNCHANGED",
        "Post-restart observer invocation must change.",
      );
    }
  }

  const statusDigest = sha256Hex(status.stdout);
  const proof = serializeFhvT4ObserverQualificationProof({
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
  });

  const writeCmd = `cat > ${shellQuote(proofPath)} <<'FHV_T4A_QUAL_EOF'\n${JSON.stringify(proof)}\nFHV_T4A_QUAL_EOF`;
  const write = ctx.transport.ssh({ remoteCommand: writeCmd, asRoot: true });
  if (write.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_OBSERVER_QUALIFICATION_WRITE_FAILED",
      write.stderr || write.stdout,
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
