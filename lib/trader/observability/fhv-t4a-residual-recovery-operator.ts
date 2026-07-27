/**
 * DEE-436 — PRE_AUTH residual-state read and governed recovery operator helpers.
 */

import { createHash } from "node:crypto";

import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import { FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL } from "@/lib/trader/observability/fhv-t4a-operator-contract";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import {
  assertFhvT4aSupervisorResidualStateSafe,
  assertResidualProofMatchesFreshRunBindings,
  fhvT4aSupervisorResidualStateDigest,
  parseFhvT4aSupervisorResidualStateProof,
  type FhvT4aSupervisorResidualStateProofV1,
} from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";
import {
  parseFhvT4aResidualRecoveryPayload,
  writeFhvT4aResidualRecoveryReceipt,
} from "@/lib/trader/observability/fhv-t4-residual-recovery-receipt";

export type FhvT4aResidualRecoveryBindings = Readonly<{
  execHost: string;
  sshUser: string;
  localStateDir: string;
  failedRunId: string;
  failedTargetSha: string;
  failedReleaseTag: string;
  organizationId: string;
  operatorId: string;
  expectedHostname: string;
  expectedMachineIdSha256: string;
  systemctlBin: string;
  pythonBin: string;
  installedUnitsDir: string;
  recoveryAuthorization?: string;
}>;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new FhvT4aOperatorError("FHV_T4A_RESIDUAL_RECOVERY_BINDING_MISSING", `Missing ${name}`);
  }
  return value;
}

export function resolveFhvT4aResidualRecoveryBindings(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aResidualRecoveryBindings {
  return {
    execHost: requireEnv("EXEC_HOST", env),
    sshUser: requireEnv("SSH_USER", env),
    localStateDir: requireEnv("FHV_T4A_LOCAL_STATE_DIR", env),
    failedRunId: requireEnv("FHV_T4A_RESIDUAL_RECOVERY_FAILED_RUN_ID", env),
    failedTargetSha: requireEnv("FHV_T4A_RESIDUAL_RECOVERY_FAILED_TARGET_SHA", env).toLowerCase(),
    failedReleaseTag: requireEnv("FHV_T4A_RESIDUAL_RECOVERY_FAILED_RELEASE_TAG", env),
    organizationId: requireEnv("FHV_ORGANIZATION_ID", env),
    operatorId: requireEnv("FHV_OPERATOR_ID", env),
    expectedHostname: requireEnv("FHV_EXPECTED_HOSTNAME", env),
    expectedMachineIdSha256: requireEnv("FHV_EXPECTED_MACHINE_ID_SHA256", env),
    systemctlBin: requireEnv("FHV_SYSTEMCTL_BIN", env),
    pythonBin: requireEnv("FHV_PYTHON_BIN", env),
    installedUnitsDir: env.FHV_SYSTEMD_DIR?.trim() || "/etc/systemd/system",
    recoveryAuthorization: env.FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION?.trim(),
  };
}

function extractJsonLine(stdout: string, schemaNeedle: string): string {
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("{") && entry.includes(schemaNeedle));
  if (!line) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_JSON_MISSING",
      `JSON payload missing for ${schemaNeedle}.`,
    );
  }
  return line;
}

export function readFhvT4aSupervisorResidualStateDuringPreauth(input: {
  bindings: FhvT4aOperatorBindings;
  transport: FhvT4aOperatorTransport;
  installedUnitsDir?: string;
}): FhvT4aSupervisorResidualStateProofV1 {
  const { bindings, transport } = input;
  const installedUnitsDir = input.installedUnitsDir ?? "/etc/systemd/system";
  const args = [
    "--systemctl-bin",
    bindings.systemctlBin,
    "--python-bin",
    bindings.pythonBin,
    "--systemd-dir",
    installedUnitsDir,
    "--expected-run-id",
    bindings.runId,
    "--expected-target-sha",
    bindings.targetSha,
    "--expected-organization-id",
    bindings.organizationId,
    "--expected-hostname",
    bindings.expectedHostname,
    "--expected-machine-id-sha256",
    bindings.expectedMachineIdSha256,
  ];
  const scriptPath = "scripts/ops/fhv-t4-supervisor-residual-state-read.sh";
  const scriptBody = transport.gitShowBlob(bindings.targetSha, scriptPath);
  const remoteCommand = `bash -s -- ${args.map(shellQuote).join(" ")}`;
  const result = transport.ssh({
    remoteCommand,
    stdin: scriptBody,
    asRoot: true,
    preauthPhase: true,
    preauthBootstrapPath: scriptPath,
    preauthBootstrapBody: scriptBody,
  });
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_BOOTSTRAP_STREAM_FAILED",
      `Residual state read failed: ${result.stderr || result.stdout}`,
    );
  }
  const proof = parseFhvT4aSupervisorResidualStateProof(
    JSON.parse(extractJsonLine(result.stdout, "fhv-t4-supervisor-residual-state/v1")),
  );
  assertResidualProofMatchesFreshRunBindings({
    proof,
    runId: bindings.runId,
    targetSha: bindings.targetSha,
    organizationId: bindings.organizationId,
    expectedHostname: bindings.expectedHostname,
    expectedMachineIdSha256: bindings.expectedMachineIdSha256,
  });
  assertFhvT4aSupervisorResidualStateSafe(proof);
  return proof;
}

function recoveryRemoteArgs(
  recovery: FhvT4aResidualRecoveryBindings,
  mode: "--preview" | "--confirm",
): string[] {
  return [
    mode,
    "--systemctl-bin",
    recovery.systemctlBin,
    "--python-bin",
    recovery.pythonBin,
    "--systemd-dir",
    recovery.installedUnitsDir,
    "--failed-run-id",
    recovery.failedRunId,
    "--failed-target-sha",
    recovery.failedTargetSha,
    "--failed-release-tag",
    recovery.failedReleaseTag,
    "--expected-hostname",
    recovery.expectedHostname,
    "--expected-machine-id-sha256",
    recovery.expectedMachineIdSha256,
    "--expected-organization-id",
    recovery.organizationId,
    "--expected-operator-id",
    recovery.operatorId,
  ];
}

export function runFhvT4aResidualRecoveryPreview(
  recovery: FhvT4aResidualRecoveryBindings,
  transport: FhvT4aOperatorTransport,
): string {
  const scriptPath = "scripts/ops/fhv-t4-supervisor-residual-recovery.sh";
  const scriptBody = transport.gitShowBlob(recovery.failedTargetSha, scriptPath);
  const remoteCommand = `bash -s -- ${recoveryRemoteArgs(recovery, "--preview").map(shellQuote).join(" ")}`;
  const result = transport.ssh({
    remoteCommand,
    stdin: scriptBody,
    asRoot: true,
  });
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_FAILED",
      result.stderr || result.stdout,
    );
  }
  const payload = parseFhvT4aResidualRecoveryPayload(
    JSON.parse(extractJsonLine(result.stdout, "fhv-t4-supervisor-residual-recovery/v1")),
  );
  if (payload.classification !== "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK") {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_FAILED",
      payload.classification,
    );
  }
  return "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK";
}

export function runFhvT4aResidualRecoveryConfirm(
  recovery: FhvT4aResidualRecoveryBindings,
  transport: FhvT4aOperatorTransport,
): string {
  if (recovery.recoveryAuthorization !== FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_REQUIRED",
      `Recovery requires exact ${FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL}.`,
    );
  }
  const scriptPath = "scripts/ops/fhv-t4-supervisor-residual-recovery.sh";
  const scriptBody = transport.gitShowBlob(recovery.failedTargetSha, scriptPath);
  const remoteCommand = [
    `FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION=${shellQuote(recovery.recoveryAuthorization)}`,
    "bash -s --",
    recoveryRemoteArgs(recovery, "--confirm").map(shellQuote).join(" "),
  ].join(" ");
  const result = transport.ssh({
    remoteCommand,
    stdin: scriptBody,
    asRoot: true,
  });
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_FAILED",
      result.stderr || result.stdout,
    );
  }
  const payload = parseFhvT4aResidualRecoveryPayload(
    JSON.parse(extractJsonLine(result.stdout, "fhv-t4-supervisor-residual-recovery/v1")),
  );
  if (payload.classification !== "FHV_T4A_RESIDUAL_RECOVERY_OK" || !payload.afterState) {
    throw new FhvT4aOperatorError("FHV_T4A_RESIDUAL_RECOVERY_FAILED", payload.classification);
  }
  const recoveryPayloadDigest = sha256Hex(JSON.stringify(payload));
  writeFhvT4aResidualRecoveryReceipt(recovery.localStateDir, {
    failedRunId: recovery.failedRunId,
    failedTargetSha: recovery.failedTargetSha,
    failedReleaseTag: recovery.failedReleaseTag,
    organizationId: recovery.organizationId,
    operatorId: recovery.operatorId,
    execHost: recovery.execHost,
    sshUser: recovery.sshUser,
    hostBootId: payload.hostBootId,
    beforeState: payload.beforeState,
    afterState: payload.afterState,
    recoveryPayloadDigest,
  });
  return "FHV_T4A_RESIDUAL_RECOVERY_OK";
}

export { fhvT4aSupervisorResidualStateDigest };
