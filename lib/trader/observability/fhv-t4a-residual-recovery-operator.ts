/**
 * DEE-436 — PRE_AUTH residual-state read and governed recovery operator helpers.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import { FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL } from "@/lib/trader/observability/fhv-t4a-operator-contract";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
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
  finalizeFhvT4aResidualRecoveryConfirmAttempt,
  fhvT4aResidualRecoveryFailureReceiptPath,
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
  localStateDir: string;
  localReleaseRoot: string;
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
    localStateDir: requireEnv("FHV_T4A_LOCAL_STATE_DIR", env),
    localReleaseRoot: requireEnv("FHV_LOCAL_RELEASE_ROOT", env),
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

export function assertFhvT4aRecoveryImplementationRelease(input: {
  recovery: FhvT4aResidualRecoveryBindings;
  transport: FhvT4aOperatorTransport;
}): { recoveryScriptDigest: string } {
  const { recovery, transport } = input;
  const localHead = execFileSync("git", ["-C", recovery.localReleaseRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  })
    .trim()
    .toLowerCase();
  if (localHead !== recovery.implementationTargetSha) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_IMPLEMENTATION_SHA_MISMATCH",
      "FHV_LOCAL_RELEASE_ROOT HEAD must equal EXECUTION_SERVER_TARGET_SHA for recovery implementation.",
    );
  }
  let implementationScriptBody: string;
  try {
    implementationScriptBody = transport.gitShowBlob(
      recovery.implementationTargetSha,
      RECOVERY_SCRIPT_PATH,
    );
  } catch {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_IMPLEMENTATION_SCRIPT_MISSING",
      "Recovery implementation SHA does not contain the audited recovery script.",
    );
  }
  try {
    transport.gitShowBlob(recovery.failedTargetSha, RECOVERY_SCRIPT_PATH);
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_FAILED_SHA_CONTAINS_SCRIPT",
      "Failed evidence SHA must not contain the recovery script.",
    );
  } catch (error) {
    if (
      error instanceof FhvT4aOperatorError &&
      error.code === "FHV_T4A_RESIDUAL_RECOVERY_FAILED_SHA_CONTAINS_SCRIPT"
    ) {
      throw error;
    }
  }
  return { recoveryScriptDigest: sha256Hex(implementationScriptBody) };
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
    previewReceiptDigest: previewReceipt.contentDigest,
    failedRunId: recovery.failedRunId,
  });

  const preConfirmPreview = invokeRecoveryScript(recovery, transport, "--preview");
  if (preConfirmPreview.exitCode !== 0) {
    finalizeFhvT4aResidualRecoveryConfirmAttempt(recovery.localStateDir, "failed");
    writeFhvT4aResidualRecoveryFailureReceipt(recovery.localStateDir, {
      previewReceiptDigest: previewReceipt.contentDigest,
      confirmAttemptDigest: confirmAttempt.contentDigest,
      failedRunId: recovery.failedRunId,
      failedTargetSha: recovery.failedTargetSha,
      failedReleaseTag: recovery.failedReleaseTag,
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
    finalizeFhvT4aResidualRecoveryConfirmAttempt(recovery.localStateDir, "failed");
    writeFhvT4aResidualRecoveryFailureReceipt(recovery.localStateDir, {
      previewReceiptDigest: previewReceipt.contentDigest,
      confirmAttemptDigest: confirmAttempt.contentDigest,
      failedRunId: recovery.failedRunId,
      failedTargetSha: recovery.failedTargetSha,
      failedReleaseTag: recovery.failedReleaseTag,
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
    finalizeFhvT4aResidualRecoveryConfirmAttempt(recovery.localStateDir, "failed");
    let afterState = driftPayload.beforeState;
    try {
      const partial = parseRecoveryPayload(result.stdout);
      if (partial.afterState) {
        afterState = partial.afterState;
      }
    } catch {
      // preserve authorized before evidence only
    }
    writeFhvT4aResidualRecoveryFailureReceipt(recovery.localStateDir, {
      previewReceiptDigest: previewReceipt.contentDigest,
      confirmAttemptDigest: confirmAttempt.contentDigest,
      failedRunId: recovery.failedRunId,
      failedTargetSha: recovery.failedTargetSha,
      failedReleaseTag: recovery.failedReleaseTag,
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
    finalizeFhvT4aResidualRecoveryConfirmAttempt(recovery.localStateDir, "failed");
    throw new FhvT4aOperatorError("FHV_T4A_RESIDUAL_RECOVERY_FAILED", payload.classification);
  }
  if (transport.remoteWriteCount() <= writesBeforeConfirm) {
    finalizeFhvT4aResidualRecoveryConfirmAttempt(recovery.localStateDir, "failed");
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_FAILED",
      "Confirm did not perform expected remote mutations.",
    );
  }
  const finalizedAttempt = finalizeFhvT4aResidualRecoveryConfirmAttempt(
    recovery.localStateDir,
    "completed",
  );
  const recoveryPayloadDigest = sha256Hex(JSON.stringify(payload));
  writeFhvT4aResidualRecoveryReceipt(recovery.localStateDir, {
    previewReceiptDigest: previewReceipt.contentDigest,
    confirmAttemptDigest: finalizedAttempt.contentDigest,
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
