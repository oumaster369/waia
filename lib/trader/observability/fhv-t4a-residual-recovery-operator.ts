/**
 * DEE-436 — PRE_AUTH residual-state read and governed recovery operator helpers.
 */

import { createHash } from "node:crypto";

import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import { FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL } from "@/lib/trader/observability/fhv-t4a-operator-contract";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import { assertFhvT4aRecoveryImplementationRelease } from "@/lib/trader/observability/fhv-t4a-recovery-release-verify";
import {
  assertFhvT4aResidualRecoveryBeforeStateMatches,
  assertFhvT4aResidualUnitIdentityMatch,
  classifyFhvT4aResidualUnitIdentity,
  fhvT4aResidualRecoveryBeforeStateDigest,
} from "@/lib/trader/observability/fhv-t4-residual-unit-identity";
import {
  assertFhvT4aSupervisorResidualStateSafe,
  assertResidualProofMatchesFreshRunBindings,
  fhvT4aSupervisorResidualStateDigest,
  parseFhvT4aSupervisorResidualStateProof,
  type FhvT4aSupervisorResidualStateProofV1,
} from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";
import {
  assertFhvT4aResidualRecoveryReplaySafe,
  writeFhvT4aResidualRecoveryConfirmCompletion,
  parseFhvT4aResidualRecoveryPayload,
  readFhvT4aResidualRecoveryPreviewReceipt,
  writeFhvT4aResidualRecoveryConfirmAttempt,
  writeFhvT4aResidualRecoveryFailureReceipt,
  writeFhvT4aResidualRecoveryPreviewReceipt,
  writeFhvT4aResidualRecoveryReceipt,
} from "@/lib/trader/observability/fhv-t4-residual-recovery-receipt";

const RECOVERY_SCRIPT_PATH = "scripts/ops/fhv-t4-supervisor-residual-recovery.sh";

export type FhvT4aResidualRecoveryBindings = Readonly<{
  execHost: string;
  sshUser: string;
  recoveryId: string;
  localStateDir: string;
  localReleaseRoot: string;
  localGitBin: string;
  originUrl: string;
  implementationTargetSha: string;
  implementationReleaseTag: string;
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
    recoveryId: requireEnv("FHV_T4A_RESIDUAL_RECOVERY_ID", env),
    localStateDir: requireEnv("FHV_T4A_LOCAL_STATE_DIR", env),
    localReleaseRoot: requireEnv("FHV_LOCAL_RELEASE_ROOT", env),
    localGitBin: requireEnv("FHV_LOCAL_GIT_BIN", env),
    originUrl: requireEnv("FHV_ORIGIN_URL", env),
    implementationTargetSha: requireEnv("EXECUTION_SERVER_TARGET_SHA", env).toLowerCase(),
    implementationReleaseTag: requireEnv("FHV_RELEASE_TAG", env),
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

export { assertFhvT4aRecoveryImplementationRelease } from "@/lib/trader/observability/fhv-t4a-recovery-release-verify";

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

function invokeRecoveryScript(
  recovery: FhvT4aResidualRecoveryBindings,
  transport: FhvT4aOperatorTransport,
  mode: "--preview" | "--confirm",
  recoveryAuthorization?: string,
) {
  const scriptBody = transport.gitShowBlob(recovery.implementationTargetSha, RECOVERY_SCRIPT_PATH);
  const remoteCommand =
    mode === "--confirm"
      ? [
          `FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION=${shellQuote(recoveryAuthorization ?? "")}`,
          "bash -s --",
          recoveryRemoteArgs(recovery, mode).map(shellQuote).join(" "),
        ].join(" ")
      : `bash -s -- ${recoveryRemoteArgs(recovery, mode).map(shellQuote).join(" ")}`;
  return transport.ssh({
    remoteCommand,
    stdin: scriptBody,
    asRoot: true,
  });
}

function parseRecoveryPayload(stdout: string) {
  return parseFhvT4aResidualRecoveryPayload(
    JSON.parse(extractJsonLine(stdout, "fhv-t4-supervisor-residual-recovery/v1")),
  );
}

export function runFhvT4aResidualRecoveryPreview(
  recovery: FhvT4aResidualRecoveryBindings,
  transport: FhvT4aOperatorTransport,
): string {
  const { recoveryScriptDigest } = assertFhvT4aRecoveryImplementationRelease({
    recovery,
    transport,
  });
  transport.resetRemoteWrites();
  const result = invokeRecoveryScript(recovery, transport, "--preview");
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_FAILED",
      result.stderr || result.stdout,
    );
  }
  const payload = parseRecoveryPayload(result.stdout);
  const unitIdentityClassification =
    payload.unitIdentityClassification ??
    classifyFhvT4aResidualUnitIdentity({
      units: payload.beforeState.units,
      failedRunId: recovery.failedRunId,
      failedTargetSha: recovery.failedTargetSha,
      failedOrganizationId: recovery.organizationId,
    });
  if (unitIdentityClassification !== "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MATCH") {
    throw new FhvT4aOperatorError(
      unitIdentityClassification,
      `Recovery preview blocked: ${unitIdentityClassification}`,
    );
  }
  if (payload.classification !== "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK") {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_FAILED",
      payload.classification,
    );
  }
  if (transport.remoteWriteCount() !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_MUTATION",
      "Preview must perform zero remote writes.",
    );
  }
  writeFhvT4aResidualRecoveryPreviewReceipt(recovery.localStateDir, {
    recoveryId: recovery.recoveryId,
    recoveryImplementationSha: recovery.implementationTargetSha,
    recoveryImplementationTag: recovery.implementationReleaseTag,
    recoveryImplementationScriptDigest: recoveryScriptDigest,
    failedRunId: recovery.failedRunId,
    failedTargetSha: recovery.failedTargetSha,
    failedReleaseTag: recovery.failedReleaseTag,
    organizationId: recovery.organizationId,
    operatorId: recovery.operatorId,
    execHost: recovery.execHost,
    sshUser: recovery.sshUser,
    expectedHostname: recovery.expectedHostname,
    expectedMachineIdSha256: recovery.expectedMachineIdSha256,
    hostBootId: payload.hostBootId,
    beforeState: payload.beforeState,
    unitIdentityClassification,
    beforeStateDigest: fhvT4aResidualRecoveryBeforeStateDigest(payload.beforeState),
  });
  return "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK";
}

export function runFhvT4aResidualRecoveryConfirm(
  recovery: FhvT4aResidualRecoveryBindings,
  transport: FhvT4aOperatorTransport,
): string {
  assertFhvT4aResidualRecoveryReplaySafe(recovery.localStateDir);
  const previewReceipt = readFhvT4aResidualRecoveryPreviewReceipt(recovery.localStateDir);
  if (recovery.recoveryAuthorization !== FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_REQUIRED",
      `Recovery requires exact ${FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL}.`,
    );
  }
  assertFhvT4aRecoveryImplementationRelease({ recovery, transport });
  const confirmAttempt = writeFhvT4aResidualRecoveryConfirmAttempt(recovery.localStateDir, {
    recoveryId: recovery.recoveryId,
    previewReceiptDigest: previewReceipt.contentDigest,
    failedRunId: recovery.failedRunId,
  });

  const recordFailure = (input: {
    hostBootId: string;
    beforeState: typeof previewReceipt.beforeState;
    afterState?: typeof previewReceipt.beforeState;
    beforeStateDigest: string;
    afterStateDigest?: string;
    remoteExitStatus: number;
    remoteStdoutDigest: string;
    remoteStderrDigest: string;
  }) => {
    const completion = writeFhvT4aResidualRecoveryConfirmCompletion(recovery.localStateDir, {
      recoveryId: recovery.recoveryId,
      confirmAttemptDigest: confirmAttempt.contentDigest,
      status: "failed",
    });
    writeFhvT4aResidualRecoveryFailureReceipt(recovery.localStateDir, {
      recoveryId: recovery.recoveryId,
      previewReceiptDigest: previewReceipt.contentDigest,
      confirmAttemptDigest: confirmAttempt.contentDigest,
      confirmCompletionDigest: completion.contentDigest,
      failedRunId: recovery.failedRunId,
      failedTargetSha: recovery.failedTargetSha,
      failedReleaseTag: recovery.failedReleaseTag,
      hostBootId: input.hostBootId,
      beforeState: input.beforeState,
      afterState: input.afterState,
      beforeStateDigest: input.beforeStateDigest,
      afterStateDigest: input.afterStateDigest,
      remoteExitStatus: input.remoteExitStatus,
      remoteStdoutDigest: input.remoteStdoutDigest,
      remoteStderrDigest: input.remoteStderrDigest,
    });
  };

  const preConfirmPreview = invokeRecoveryScript(recovery, transport, "--preview");
  if (preConfirmPreview.exitCode !== 0) {
    recordFailure({
      hostBootId: previewReceipt.hostBootId,
      beforeState: previewReceipt.beforeState,
      beforeStateDigest: previewReceipt.beforeStateDigest,
      remoteExitStatus: preConfirmPreview.exitCode,
      remoteStdoutDigest: sha256Hex(preConfirmPreview.stdout),
      remoteStderrDigest: sha256Hex(preConfirmPreview.stderr),
    });
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_DRIFT",
      preConfirmPreview.stderr || preConfirmPreview.stdout,
    );
  }
  const driftPayload = parseRecoveryPayload(preConfirmPreview.stdout);
  try {
    assertFhvT4aResidualRecoveryBeforeStateMatches({
      authorized: previewReceipt.beforeState,
      observed: driftPayload.beforeState,
      authorizedHostBootId: previewReceipt.hostBootId,
      observedHostBootId: driftPayload.hostBootId,
    });
    assertFhvT4aResidualUnitIdentityMatch({
      units: driftPayload.beforeState.units,
      failedRunId: recovery.failedRunId,
      failedTargetSha: recovery.failedTargetSha,
      failedOrganizationId: recovery.organizationId,
    });
  } catch (error) {
    recordFailure({
      hostBootId: driftPayload.hostBootId,
      beforeState: previewReceipt.beforeState,
      afterState: driftPayload.beforeState,
      beforeStateDigest: previewReceipt.beforeStateDigest,
      afterStateDigest: fhvT4aResidualRecoveryBeforeStateDigest(driftPayload.beforeState),
      remoteExitStatus: 0,
      remoteStdoutDigest: sha256Hex(preConfirmPreview.stdout),
      remoteStderrDigest: sha256Hex(preConfirmPreview.stderr),
    });
    throw error;
  }

  const writesBeforeConfirm = transport.remoteWriteCount();
  const result = invokeRecoveryScript(
    recovery,
    transport,
    "--confirm",
    recovery.recoveryAuthorization,
  );
  if (result.exitCode !== 0) {
    let afterState = driftPayload.beforeState;
    try {
      const partial = parseRecoveryPayload(result.stdout);
      if (partial.afterState) {
        afterState = partial.afterState;
      }
    } catch {
      // preserve authorized before evidence only
    }
    recordFailure({
      hostBootId: previewReceipt.hostBootId,
      beforeState: previewReceipt.beforeState,
      afterState,
      beforeStateDigest: previewReceipt.beforeStateDigest,
      afterStateDigest: fhvT4aResidualRecoveryBeforeStateDigest(afterState),
      remoteExitStatus: result.exitCode,
      remoteStdoutDigest: sha256Hex(result.stdout),
      remoteStderrDigest: sha256Hex(result.stderr),
    });
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_FAILED",
      result.stderr || result.stdout,
    );
  }
  const payload = parseRecoveryPayload(result.stdout);
  if (payload.classification !== "FHV_T4A_RESIDUAL_RECOVERY_OK" || !payload.afterState) {
    recordFailure({
      hostBootId: previewReceipt.hostBootId,
      beforeState: previewReceipt.beforeState,
      beforeStateDigest: previewReceipt.beforeStateDigest,
      remoteExitStatus: result.exitCode,
      remoteStdoutDigest: sha256Hex(result.stdout),
      remoteStderrDigest: sha256Hex(result.stderr),
    });
    throw new FhvT4aOperatorError("FHV_T4A_RESIDUAL_RECOVERY_FAILED", payload.classification);
  }
  if (transport.remoteWriteCount() <= writesBeforeConfirm) {
    recordFailure({
      hostBootId: previewReceipt.hostBootId,
      beforeState: previewReceipt.beforeState,
      beforeStateDigest: previewReceipt.beforeStateDigest,
      remoteExitStatus: 0,
      remoteStdoutDigest: sha256Hex(result.stdout),
      remoteStderrDigest: sha256Hex(result.stderr),
    });
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_FAILED",
      "Confirm did not perform expected remote mutations.",
    );
  }
  const confirmCompletion = writeFhvT4aResidualRecoveryConfirmCompletion(recovery.localStateDir, {
    recoveryId: recovery.recoveryId,
    confirmAttemptDigest: confirmAttempt.contentDigest,
    status: "completed",
  });
  const recoveryPayloadDigest = sha256Hex(JSON.stringify(payload));
  writeFhvT4aResidualRecoveryReceipt(recovery.localStateDir, {
    recoveryId: recovery.recoveryId,
    previewReceiptDigest: previewReceipt.contentDigest,
    confirmAttemptDigest: confirmAttempt.contentDigest,
    confirmCompletionDigest: confirmCompletion.contentDigest,
    recoveryImplementationSha: recovery.implementationTargetSha,
    recoveryImplementationTag: recovery.implementationReleaseTag,
    failedRunId: recovery.failedRunId,
    failedTargetSha: recovery.failedTargetSha,
    failedReleaseTag: recovery.failedReleaseTag,
    organizationId: recovery.organizationId,
    operatorId: recovery.operatorId,
    execHost: recovery.execHost,
    sshUser: recovery.sshUser,
    hostBootId: payload.hostBootId,
    unitIdentityClassification: previewReceipt.unitIdentityClassification,
    beforeState: previewReceipt.beforeState,
    afterState: payload.afterState,
    beforeStateDigest: previewReceipt.beforeStateDigest,
    afterStateDigest: fhvT4aResidualRecoveryBeforeStateDigest(payload.afterState),
    recoveryPayloadDigest,
  });
  return "FHV_T4A_RESIDUAL_RECOVERY_OK";
}

export { fhvT4aSupervisorResidualStateDigest };
