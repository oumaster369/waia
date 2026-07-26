/**
 * DEE-436 — canonical T4A operator CLI (workstation → Execution Server state machine).
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  FHV_T4A_AUTHORIZATION_LITERAL,
  FHV_T4A_BOOTSTRAP_SCRIPT_PATHS,
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
  FHV_T4A_OPERATOR_STEPS,
  FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION,
  FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import {
  buildFhvT4aExecContext,
  executeFhvT4aStep,
  parseFhvT4aTaggedKeyValueLines,
  type FhvT4aStepResult,
} from "@/lib/trader/observability/fhv-t4a-operator-executor";
import {
  createFhvT4aLiveTransport,
  getFhvT4aOperatorTransportForTests,
  type FhvT4aOperatorTransport,
} from "@/lib/trader/observability/fhv-t4a-operator-transport";
import { createFhvT4aHermeticTransportFromEnv } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
import { resolveFhvT4aOperatorBindingsFromSpec } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import {
  assertPreauthReceiptMatches,
  fhvT4aBindingDigest,
  fhvT4aFullBindingFields,
  fhvT4aPreauthLedgerDigest,
  readFhvT4aLocalReleaseReceipt,
  readFhvT4aPostBeforeReceipt,
  readFhvT4aPreauthReceipt,
  writeFhvT4aLocalReleaseReceipt,
  writeFhvT4aPostBeforeReceipt,
  writeFhvT4aPostFinalizeReceipt,
  writeFhvT4aPreauthReceipt,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import {
  assertPreflightMatchesBindings,
  parseFhvT4HostPreflightV2,
} from "@/lib/trader/observability/fhv-t4-host-preflight";
import { parseFhvT4CompletedCampaignSystemdIdentity } from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import { parseFhvT4ObserverSystemdIdentity } from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";
import { revalidateFhvT4aReconnectBaseline } from "@/lib/trader/observability/fhv-t4a-reconnect-baseline";
import { resolveFhvT4ObserverQualificationPreCampaignPath } from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";

export { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";

export type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";

export type FhvT4aOperatorTraceLine = Readonly<{
  schemaVersion: typeof FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION;
  phase: string;
  semanticStep: number | string;
  locus: string;
  expectedEffectiveUid: number | "n/a";
  commandOwner: string;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  mutationClass: string;
  startClassification: string;
  terminalClassification: string;
  exitStatus: number;
  prerequisiteProofDigests: readonly string[];
  resultingProofDigests: readonly string[];
}>;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function resolveFhvT4aOperatorBindings(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aOperatorBindings {
  return resolveFhvT4aOperatorBindingsFromSpec(env);
}

function resolveTransport(env: NodeJS.ProcessEnv): FhvT4aOperatorTransport {
  if (env.FHV_T4A_HERMETIC_INTEGRATION === "1") {
    return createFhvT4aHermeticTransportFromEnv(env);
  }
  if (env.FHV_T4A_OPERATOR_TEST_MODE === "1") {
    const injected = getFhvT4aOperatorTransportForTests();
    if (!injected) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_TEST_TRANSPORT_MISSING",
        "FHV_T4A_OPERATOR_TEST_MODE requires injected transport.",
      );
    }
    return injected;
  }
  return createFhvT4aLiveTransport(env);
}

function emitTrace(bindings: FhvT4aOperatorBindings, line: FhvT4aOperatorTraceLine): void {
  mkdirSync(bindings.localStateDir, { recursive: true });
  const serialized = `${JSON.stringify(line)}\n`;
  appendFileSync(bindings.workstationTracePath, serialized);
  process.stdout.write(serialized);
}

function emitStepTrace(
  bindings: FhvT4aOperatorBindings,
  phase: string,
  step: number,
  locus: string,
  commandOwner: string,
  mutationClass: string,
  result: FhvT4aStepResult,
): void {
  emitTrace(bindings, {
    schemaVersion: FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION,
    phase,
    semanticStep: step,
    locus,
    expectedEffectiveUid: locus === "SERVICE_USER" ? 1000 : locus === "REMOTE_ROOT" ? 0 : "n/a",
    commandOwner,
    targetSha: bindings.targetSha,
    releaseTag: bindings.releaseTag,
    runId: bindings.runId,
    organizationId: bindings.organizationId,
    mutationClass,
    startClassification: `FHV_T4A_STEP_${step}_START`,
    terminalClassification: result.classification,
    exitStatus: result.exitCode,
    prerequisiteProofDigests: result.prerequisiteProofDigests,
    resultingProofDigests: result.resultingProofDigests,
  });
}

function assertNoGitStatePollution(transport: FhvT4aOperatorTransport): void {
  for (const flag of ["merge", "rebase", "cherry-pick", "bisect"]) {
    const dir = transport.localGit(["rev-parse", "--git-path", flag]);
    if (dir.exitCode !== 0) {
      continue;
    }
    const path = dir.stdout.trim();
    if (path && existsSync(path)) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_LOCAL_GIT_STATE_BLOCKED",
        `Local git ${flag} in progress.`,
      );
    }
  }
}

export function verifyFhvT4aLocalRelease(
  bindings: FhvT4aOperatorBindings,
  transport: FhvT4aOperatorTransport,
): Record<string, string> {
  assertNoGitStatePollution(transport);
  const checks: Array<[string, readonly string[]]> = [
    ["status", ["status", "--porcelain=v1"]],
    ["head", ["rev-parse", "HEAD"]],
    ["tag-peel", ["rev-parse", `${bindings.releaseTag}^{}`]],
    ["origin", ["remote", "get-url", "origin"]],
  ];
  for (const [label, args] of checks) {
    const result = transport.localGit(args);
    if (result.exitCode !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_LOCAL_RELEASE_VERIFY_FAILED",
        `Local release verify failed: ${label}`,
      );
    }
    if (label === "status" && result.stdout.trim()) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_LOCAL_RELEASE_DIRTY",
        "Local release tracked tree/index is not clean.",
      );
    }
    if (label === "head" && result.stdout.trim().toLowerCase() !== bindings.targetSha) {
      throw new FhvT4aOperatorError("FHV_T4A_LOCAL_HEAD_MISMATCH", "Local HEAD != target SHA.");
    }
    if (label === "tag-peel" && result.stdout.trim().toLowerCase() !== bindings.targetSha) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_LOCAL_TAG_MISMATCH",
        "Release tag peel != target SHA.",
      );
    }
    if (label === "origin" && result.stdout.trim() !== bindings.originUrl) {
      throw new FhvT4aOperatorError("FHV_T4A_LOCAL_ORIGIN_MISMATCH", "Local origin mismatch.");
    }
  }

  const bootstrapDigests: Record<string, string> = {};
  for (const scriptPath of FHV_T4A_BOOTSTRAP_SCRIPT_PATHS) {
    const blob = transport.gitShowBlob(bindings.targetSha, scriptPath);
    bootstrapDigests[scriptPath] = sha256Hex(blob);
  }
  return bootstrapDigests;
}

function streamBootstrapScript(
  transport: FhvT4aOperatorTransport,
  bindings: FhvT4aOperatorBindings,
  scriptPath: string,
  remoteArgs: readonly string[],
  asRoot: boolean,
  preauthPhase = false,
): void {
  const scriptBody = transport.gitShowBlob(bindings.targetSha, scriptPath);
  const remoteCommand = `bash -s -- ${remoteArgs.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ")}`;
  const result = transport.ssh({
    remoteCommand,
    stdin: scriptBody,
    asRoot,
    preauthPhase,
    preauthBootstrapPath: scriptPath,
    preauthBootstrapBody: scriptBody,
  });
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_BOOTSTRAP_STREAM_FAILED",
      `Bootstrap stream failed for ${scriptPath}: ${result.stderr || result.stdout}`,
    );
  }
}

function refuseBareAuthorizeLiteral(bindings: FhvT4aOperatorBindings): void {
  if (bindings.authorization === "AUTHORIZE") {
    throw new FhvT4aOperatorError(
      "FHV_T4A_AUTHORIZATION_LITERAL_REJECTED",
      "Refusing bare AUTHORIZE literal.",
    );
  }
}

function requireAuthorization(bindings: FhvT4aOperatorBindings): void {
  if (bindings.authorization !== FHV_T4A_AUTHORIZATION_LITERAL) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_AUTHORIZATION_REQUIRED",
      `Phase requires exact ${FHV_T4A_AUTHORIZATION_LITERAL}.`,
    );
  }
}

export function runFhvT4aOperatorPhase(
  phase:
    | "verify-local-release"
    | "pre-auth"
    | "post-auth-before-disconnect"
    | "post-reconnect-finalize",
  bindings: FhvT4aOperatorBindings,
  transport: FhvT4aOperatorTransport,
): string {
  refuseBareAuthorizeLiteral(bindings);

  if (phase === "verify-local-release") {
    const digests = verifyFhvT4aLocalRelease(bindings, transport);
    const bindingDigest = fhvT4aBindingDigest(fhvT4aFullBindingFields(bindings));
    writeFhvT4aLocalReleaseReceipt(bindings.localStateDir, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      originUrl: bindings.originUrl,
      bootstrapBlobDigests: digests,
      bindingDigest,
    });
    emitTrace(bindings, {
      schemaVersion: FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION,
      phase,
      semanticStep: "local-release",
      locus: "WORKSTATION",
      expectedEffectiveUid: "n/a",
      commandOwner: "fhv-t4a-operator:verify-local-release",
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      mutationClass: "read-only",
      startClassification: "FHV_T4A_LOCAL_RELEASE_VERIFY_START",
      terminalClassification: "FHV_T4A_LOCAL_RELEASE_VERIFY_OK",
      exitStatus: 0,
      prerequisiteProofDigests: [],
      resultingProofDigests: Object.values(digests),
    });
    return "FHV_T4A_LOCAL_RELEASE_VERIFY_OK";
  }

  if (phase === "pre-auth") {
    const expectedBindingDigest = fhvT4aBindingDigest(fhvT4aFullBindingFields(bindings));
    readFhvT4aLocalReleaseReceipt(bindings.localStateDir, expectedBindingDigest);
    transport.resetRemoteWrites();
    const sudo = transport.sudoNoninteractiveProbe();
    if (sudo.exitCode !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_SUDO_NONINTERACTIVE_FAILED",
        "sudo -n probe failed during pre-auth.",
      );
    }
    const analyzeProbe = transport.ssh({
      remoteCommand: `test -x '${bindings.systemdAnalyzeBin.replace(/'/g, `'\\''`)}'`,
      asRoot: true,
      preauthPhase: true,
    });
    if (analyzeProbe.exitCode !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_SYSTEMD_ANALYZE_BIN_INVALID",
        "FHV_SYSTEMD_ANALYZE_BIN must be absolute and executable on Execution Server.",
      );
    }
    streamBootstrapScript(
      transport,
      bindings,
      "scripts/ops/fhv-validate-origin-url.sh",
      ["--origin-url", bindings.originUrl],
      false,
      true,
    );
    const preflightArgs = [
      "--expected-hostname",
      bindings.expectedHostname,
      "--expected-machine-id-sha256",
      bindings.expectedMachineIdSha256,
      "--service-user",
      bindings.serviceUser,
      "--environment-file",
      bindings.environmentFile,
      "--artifact-root",
      bindings.artifactRoot,
      "--checkout-parent",
      bindings.checkoutParent,
      "--node-bin",
      bindings.nodeBin,
      "--corepack-bin",
      bindings.corepackBin,
      "--git-bin",
      bindings.gitBin,
      "--python-bin",
      bindings.pythonBin,
      "--docker-bin",
      bindings.dockerBin,
      "--expected-legacy-container-name",
      FHV_T4A_LEGACY_CONTAINER_NAME,
      "--expected-legacy-container-image",
      FHV_T4A_LEGACY_CONTAINER_IMAGE,
    ];
    const preflightScriptBody = transport.gitShowBlob(
      bindings.targetSha,
      "scripts/ops/fhv-t4-host-preflight.sh",
    );
    const preflightRemoteCommand = `bash -s -- ${preflightArgs.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ")}`;
    const preflightResult = transport.ssh({
      remoteCommand: preflightRemoteCommand,
      stdin: preflightScriptBody,
      asRoot: true,
      preauthPhase: true,
      preauthBootstrapPath: "scripts/ops/fhv-t4-host-preflight.sh",
      preauthBootstrapBody: preflightScriptBody,
    });
    if (preflightResult.exitCode !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_BOOTSTRAP_STREAM_FAILED",
        `Bootstrap stream failed for host-preflight: ${preflightResult.stderr || preflightResult.stdout}`,
      );
    }
    const preflightJsonLine = preflightResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("{") && line.includes("fhv-t4-host-preflight"));
    if (!preflightJsonLine) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_PREFLIGHT_JSON_MISSING",
        "Host preflight JSON payload missing from stdout.",
      );
    }
    const preflight = parseFhvT4HostPreflightV2(JSON.parse(preflightJsonLine));
    assertPreflightMatchesBindings(preflight, bindings);
    const ledgerEntries = transport.preauthLedgerEntries();
    const mutatingCommandCount = transport.preauthMutatingCommandCount();
    if (mutatingCommandCount !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_PREAUTH_REMOTE_WRITES",
        `pre-auth measured mutating command count must be 0, got ${mutatingCommandCount}.`,
      );
    }
    const rejectedCommandCount = ledgerEntries.filter(
      (entry) => entry.classification === "rejected",
    ).length;
    if (rejectedCommandCount !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_PREAUTH_REJECTED_COMMANDS",
        `pre-auth rejected command count must be 0, got ${rejectedCommandCount}.`,
      );
    }
    const localReceipt = readFhvT4aLocalReleaseReceipt(
      bindings.localStateDir,
      expectedBindingDigest,
    );
    writeFhvT4aPreauthReceipt(bindings.localStateDir, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      originUrl: bindings.originUrl,
      execHost: bindings.execHost,
      sshUser: bindings.sshUser,
      expectedHostname: bindings.expectedHostname,
      expectedMachineIdSha256: bindings.expectedMachineIdSha256,
      serviceUser: bindings.serviceUser,
      serviceUid: preflight.serviceUid,
      serviceGid: preflight.serviceGid,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      nodeBin: bindings.nodeBin,
      corepackBin: bindings.corepackBin,
      gitBin: bindings.gitBin,
      pythonBin: bindings.pythonBin,
      dockerBin: bindings.dockerBin,
      systemctlBin: bindings.systemctlBin,
      systemdAnalyzeBin: bindings.systemdAnalyzeBin,
      bootstrapBlobDigests: localReceipt.bootstrapBlobDigests,
      bindingDigest: localReceipt.bindingDigest,
      preauthLedger: ledgerEntries,
      preauthLedgerDigest: fhvT4aPreauthLedgerDigest(ledgerEntries),
      rejectedCommandCount,
      mutatingCommandCount,
      preflightHostFacts: {
        hostname: preflight.hostname,
        machineIdSha256: preflight.machineIdSha256,
        serviceUser: preflight.serviceUser,
        serviceUid: preflight.serviceUid,
        serviceGid: preflight.serviceGid,
        servicePrimaryGroup: preflight.servicePrimaryGroup,
        environmentFile: preflight.environmentFile,
        artifactRoot: preflight.artifactRoot,
        checkoutParent: preflight.checkoutParent,
        nodeBin: preflight.nodeBin,
        corepackBin: preflight.corepackBin,
        gitBin: preflight.gitBin,
        pythonBin: preflight.pythonBin,
        dockerBin: preflight.dockerBin,
        systemctlBin: bindings.systemctlBin,
        systemdAnalyzeBin: bindings.systemdAnalyzeBin,
        legacyContainerName: preflight.legacyContainerName,
        legacyContainerImage: preflight.legacyContainerImage,
        legacyContainerState: preflight.legacyContainerState,
        hostBootId: preflight.hostBootId ?? null,
        minimumFreeKiB: preflight.minimumFreeKiB,
        observedFreeKiB: preflight.observedFreeKiB,
        hostMonotonicSample: preflight.hostMonotonicSample,
      },
    });
    emitTrace(bindings, {
      schemaVersion: FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION,
      phase,
      semanticStep: "pre-auth",
      locus: "SSH_STDIN",
      expectedEffectiveUid: 0,
      commandOwner: "fhv-t4a-operator:pre-auth",
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      mutationClass: "remote-read",
      startClassification: "FHV_T4A_PREAUTH_START",
      terminalClassification: "FHV_T4A_PREAUTH_OK",
      exitStatus: 0,
      prerequisiteProofDigests: [localReceipt.contentDigest],
      resultingProofDigests: [],
    });
    return "FHV_T4A_PREAUTH_OK";
  }

  requireAuthorization(bindings);
  const ctx = buildFhvT4aExecContext(bindings, transport);

  if (phase === "post-auth-before-disconnect") {
    const expectedBindingDigest = fhvT4aBindingDigest(fhvT4aFullBindingFields(bindings));
    const localReceipt = readFhvT4aLocalReleaseReceipt(
      bindings.localStateDir,
      expectedBindingDigest,
    );
    const preauthReceipt = readFhvT4aPreauthReceipt(bindings.localStateDir, expectedBindingDigest);
    assertPreauthReceiptMatches(preauthReceipt, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      originUrl: bindings.originUrl,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
    });
    const stepProofDigests: Record<string, string> = {};
    for (let step = 1; step <= 26; step += 1) {
      const result = executeFhvT4aStep(ctx, step);
      const contractStep = FHV_T4A_OPERATOR_STEPS.find((entry) => entry.step === step);
      emitStepTrace(
        bindings,
        phase,
        step,
        contractStep?.locus ?? "REMOTE_ROOT",
        contractStep?.commandOwner.kind === "package"
          ? contractStep.commandOwner.command
          : contractStep?.commandOwner.kind === "script"
            ? contractStep.commandOwner.path
            : contractStep?.commandOwner.kind === "systemd"
              ? contractStep.commandOwner.action
              : "unknown",
        contractStep?.mutationClass ?? "remote-mutate",
        result,
      );
      stepProofDigests[String(step)] = sha256Hex(JSON.stringify(result));
    }
    if (!transport.remoteFileExists(ctx.continuityBefore)) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_CONTINUITY_BEFORE_MISSING",
        "Real continuity-before artifact required.",
      );
    }
    const observerQualificationPrePath = resolveFhvT4ObserverQualificationPreCampaignPath(
      ctx.runDir,
    );
    if (!transport.remoteFileExists(observerQualificationPrePath)) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_OBSERVER_QUALIFICATION_PRE_MISSING",
        "Pre-campaign observer qualification proof required.",
      );
    }
    const campaignIdentityCmd = `"${ctx.repoRoot}/scripts/ops/fhv-t4-campaign-systemd-identity-read.sh" --systemctl-bin '${bindings.systemctlBin.replace(/'/g, `'\\''`)}' --python-bin '${bindings.pythonBin.replace(/'/g, `'\\''`)}' waia-fhv-campaign.service`;
    const campaignIdentityResult = transport.ssh({
      remoteCommand: campaignIdentityCmd,
      asRoot: true,
    });
    if (campaignIdentityResult.exitCode !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_CAMPAIGN_IDENTITY_READ_FAILED",
        campaignIdentityResult.stderr || campaignIdentityResult.stdout,
      );
    }
    const observerIdentityCmd = `"${ctx.repoRoot}/scripts/ops/fhv-t4-observer-systemd-identity-read.sh" --systemctl-bin '${bindings.systemctlBin.replace(/'/g, `'\\''`)}' --python-bin '${bindings.pythonBin.replace(/'/g, `'\\''`)}' waia-fhv-observer.service`;
    const observerIdentityResult = transport.ssh({
      remoteCommand: observerIdentityCmd,
      asRoot: true,
    });
    if (observerIdentityResult.exitCode !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_OBSERVER_IDENTITY_READ_FAILED",
        observerIdentityResult.stderr || observerIdentityResult.stdout,
      );
    }
    const campaignIdentity = parseFhvT4CompletedCampaignSystemdIdentity(
      JSON.parse(campaignIdentityResult.stdout.trim()),
    );
    const observerIdentity = parseFhvT4ObserverSystemdIdentity(
      JSON.parse(observerIdentityResult.stdout.trim()),
    );
    writeFhvT4aPostBeforeReceipt(bindings.localStateDir, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      execHost: bindings.execHost,
      sshUser: bindings.sshUser,
      bindingDigest: expectedBindingDigest,
      runDir: ctx.runDir,
      continuityBeforePath: ctx.continuityBefore,
      continuityBeforeDigest: transport.remoteSha256(ctx.continuityBefore),
      observerIdentityDigest: sha256Hex(JSON.stringify(observerIdentity)),
      campaignIdentityDigest: campaignIdentity.contentDigest,
      observerQualificationPrePath,
      observerQualificationPreDigest: transport.remoteSha256(observerQualificationPrePath),
      stepProofDigests,
    });
    return FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT;
  }

  if (phase === "post-reconnect-finalize") {
    const postBefore = readFhvT4aPostBeforeReceipt(bindings.localStateDir);
    const baseline = revalidateFhvT4aReconnectBaseline({
      bindings,
      transport,
      postBeforeReceipt: postBefore,
    });
    ctx.postBeforeReceipt = postBefore;
    ctx.reconnectBaseline = baseline;
    const ceremonyLines: Record<string, string> = {};
    const stepProofDigests: Record<string, string> = {};
    let evidenceSealRootDigest = "";
    let evidenceSealManifestDigest = "";
    let evidenceSealVerifyClassification = "";
    for (const step of [28, 29, 30, 31, 32]) {
      const result = executeFhvT4aStep(ctx, step);
      const contractStep = FHV_T4A_OPERATOR_STEPS.find((entry) => entry.step === step);
      emitStepTrace(
        bindings,
        phase,
        step,
        contractStep?.locus ?? "SERVICE_USER",
        contractStep?.commandOwner.kind === "package"
          ? contractStep.commandOwner.command
          : contractStep?.commandOwner.kind === "systemd"
            ? contractStep.commandOwner.action
            : "unknown",
        contractStep?.mutationClass ?? "service-user-mutate",
        result,
      );
      stepProofDigests[String(step)] = sha256Hex(JSON.stringify(result));
      if (step === 32) {
        const tagged = parseFhvT4aTaggedKeyValueLines(result.stdout);
        for (const [key, value] of Object.entries(tagged)) {
          ceremonyLines[key] = value;
          if (key === "rootDigest") {
            evidenceSealRootDigest = value;
          }
          if (key === "classification" && value.includes("SEAL")) {
            evidenceSealVerifyClassification = value;
          }
        }
      }
    }
    if (!evidenceSealRootDigest) {
      throw new FhvT4aOperatorError(
        "FINAL_RECEIPT_SEAL_ROOT_MISSING",
        "seal-evidence rootDigest missing from step 32 output.",
      );
    }
    const sealManifestPath = `${ctx.sealDestination}/inventory.json`;
    if (transport.remoteFileExists(sealManifestPath)) {
      evidenceSealManifestDigest = transport.remoteSha256(sealManifestPath);
    }
    const publishedSealRootPath = `${ctx.sealDestination}/SEAL_ROOT.sha256`;
    const publishedSealRoot = transport.readRemoteFile(publishedSealRootPath).trim();
    if (publishedSealRoot !== evidenceSealRootDigest) {
      throw new FhvT4aOperatorError(
        "FINAL_RECEIPT_SEAL_ROOT_MISSING",
        "Published seal rootDigest does not match seal-evidence capture.",
      );
    }
    const expectedBindingDigest = fhvT4aBindingDigest(fhvT4aFullBindingFields(bindings));
    writeFhvT4aPostFinalizeReceipt(bindings.localStateDir, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      bindingDigest: expectedBindingDigest,
      postBeforeReceiptDigest: postBefore.contentDigest,
      continuityAfterPath: ctx.continuityAfter,
      continuityAfterDigest: transport.remoteSha256(ctx.continuityAfter),
      evidenceSealRootDigest,
      evidenceSealManifestDigest,
      evidenceSealVerifyClassification,
      ceremonyClassifications: ceremonyLines,
      stepProofDigests,
      proofDigestBundle: {
        continuityBefore: postBefore.continuityBeforeDigest,
        continuityAfter: transport.remoteSha256(ctx.continuityAfter),
        observerQualificationPre: postBefore.observerQualificationPreDigest,
        observerQualificationPost: transport.remoteSha256(
          `${ctx.runDir}/control/fhv-t4-observer-qualification-post-restart.v1.json`,
        ),
        hostProbeDeployment: transport.remoteSha256(ctx.hostProbePath),
        hostProbePostRollback: transport.remoteSha256(ctx.postRollbackHostProbePath),
        rollbackProof: transport.remoteSha256(
          `${ctx.runDir}/control/fhv-t4-rollback-proof.v1.json`,
        ),
      },
    });
    return "FHV_T4A_POST_RECONNECT_FINALIZE_OK";
  }

  throw new FhvT4aOperatorError("FHV_T4A_PHASE_INVALID", `Unknown phase: ${phase}`);
}

function parsePhase(argv: readonly string[]): Parameters<typeof runFhvT4aOperatorPhase>[0] {
  const phase = argv[0]?.trim();
  const allowed = [
    "verify-local-release",
    "pre-auth",
    "post-auth-before-disconnect",
    "post-reconnect-finalize",
  ] as const;
  if (phase && (allowed as readonly string[]).includes(phase)) {
    return phase as (typeof allowed)[number];
  }
  throw new FhvT4aOperatorError("FHV_T4A_PHASE_ARG_MISSING", "Usage: fhv-t4a-operator.ts <phase>");
}

function main(): void {
  const phase = parsePhase(process.argv.slice(2));
  const bindings = resolveFhvT4aOperatorBindings();
  const transport = resolveTransport(process.env);
  const classification = runFhvT4aOperatorPhase(phase, bindings, transport);
  console.log(`classification=${classification}`);
  console.log(`FHV_T4A_LEGACY_CONTAINER_NAME=${FHV_T4A_LEGACY_CONTAINER_NAME}`);
  console.log(`FHV_T4A_LEGACY_CONTAINER_IMAGE=${FHV_T4A_LEGACY_CONTAINER_IMAGE}`);
  console.log(`FHV_T4A_OPERATOR_STEPS=${FHV_T4A_OPERATOR_STEPS.length}`);
}

if (process.argv[1]?.endsWith("fhv-t4a-operator.ts")) {
  main();
}

export { main as runFhvT4aOperatorCli };
