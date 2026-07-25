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
  type FhvT4aStepResult,
} from "@/lib/trader/observability/fhv-t4a-operator-executor";
import {
  createFhvT4aLiveTransport,
  getFhvT4aOperatorTransportForTests,
  type FhvT4aOperatorTransport,
} from "@/lib/trader/observability/fhv-t4a-operator-transport";
import { createFhvT4aHermeticTransportFromEnv } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
import { validateFhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4-binding-validation";
import {
  assertPreauthReceiptMatches,
  fhvT4aBindingDigest,
  readFhvT4aLocalReleaseReceipt,
  readFhvT4aPostBeforeReceipt,
  readFhvT4aPreauthReceipt,
  writeFhvT4aLocalReleaseReceipt,
  writeFhvT4aPostBeforeReceipt,
  writeFhvT4aPostFinalizeReceipt,
  writeFhvT4aPreauthReceipt,
  digestFile,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";

export class FhvT4aOperatorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aOperatorError";
  }
}

export type FhvT4aOperatorBindings = Readonly<{
  execHost: string;
  sshUser: string;
  localReleaseRoot: string;
  localStateDir: string;
  localNodeBin: string;
  localGitBin: string;
  localSshBin: string;
  targetSha: string;
  releaseTag: string;
  originUrl: string;
  runId: string;
  organizationId: string;
  operatorId: string;
  serviceUser: string;
  environmentFile: string;
  artifactRoot: string;
  checkoutParent: string;
  expectedHostname: string;
  expectedMachineIdSha256: string;
  nodeBin: string;
  corepackBin: string;
  gitBin: string;
  pythonBin: string;
  dockerBin: string;
  systemctlBin: string;
  authorization?: string;
  workstationTracePath: string;
}>;

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

function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new FhvT4aOperatorError("FHV_T4A_BINDING_MISSING", `Missing required env: ${name}`);
  }
  return value;
}

export function resolveFhvT4aOperatorBindings(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aOperatorBindings {
  const localStateDir = requireEnv("FHV_T4A_LOCAL_STATE_DIR", env);
  const bindings = {
    execHost: requireEnv("EXEC_HOST", env),
    sshUser: requireEnv("SSH_USER", env),
    localReleaseRoot: requireEnv("FHV_LOCAL_RELEASE_ROOT", env),
    localStateDir,
    localNodeBin: requireEnv("FHV_LOCAL_NODE_BIN", env),
    localGitBin: requireEnv("FHV_LOCAL_GIT_BIN", env),
    localSshBin: requireEnv("FHV_LOCAL_SSH_BIN", env),
    targetSha: requireEnv("EXECUTION_SERVER_TARGET_SHA", env).toLowerCase(),
    releaseTag: requireEnv("FHV_RELEASE_TAG", env),
    originUrl: env.FHV_ORIGIN_URL?.trim() || "https://github.com/oumaster369/waia.git",
    runId: requireEnv("FHV_RUN_ID", env),
    organizationId: requireEnv("FHV_ORGANIZATION_ID", env),
    operatorId: requireEnv("FHV_OPERATOR_ID", env),
    serviceUser: requireEnv("FHV_SERVICE_USER", env),
    environmentFile: requireEnv("FHV_ENVIRONMENT_FILE", env),
    artifactRoot: requireEnv("FHV_ARTIFACT_ROOT", env),
    checkoutParent: requireEnv("FHV_CHECKOUT_PARENT", env),
    expectedHostname: requireEnv("FHV_EXPECTED_HOSTNAME", env),
    expectedMachineIdSha256: requireEnv("FHV_EXPECTED_MACHINE_ID_SHA256", env),
    nodeBin: requireEnv("FHV_NODE_BIN", env),
    corepackBin: requireEnv("FHV_COREPACK_BIN", env),
    gitBin: requireEnv("FHV_GIT_BIN", env),
    pythonBin: requireEnv("FHV_PYTHON_BIN", env),
    dockerBin: requireEnv("FHV_DOCKER_BIN", env),
    systemctlBin: requireEnv("FHV_SYSTEMCTL_BIN", env),
    authorization: env.FHV_T4A_AUTHORIZATION?.trim(),
    workstationTracePath:
      env.FHV_T4A_WORKSTATION_TRACE_PATH?.trim() ??
      join(localStateDir, "fhv-t4a-operator-trace.jsonl"),
  };
  validateFhvT4aOperatorBindings({
    targetSha: bindings.targetSha,
    releaseTag: bindings.releaseTag,
    runId: bindings.runId,
    organizationId: bindings.organizationId,
    checkoutParent: bindings.checkoutParent,
    artifactRoot: bindings.artifactRoot,
    repoRoot: join(bindings.checkoutParent, `waia-${bindings.targetSha}`),
    runDir: join(bindings.artifactRoot, "RI-P7/fhv-ops-rehearsal", bindings.runId),
    sealDestination: join(bindings.artifactRoot, "RI-P7/fhv-ops-rehearsal-seals", bindings.runId),
  });
  return bindings;
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
): void {
  const scriptBody = transport.gitShowBlob(bindings.targetSha, scriptPath);
  const remoteCommand = `bash -s -- ${remoteArgs.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ")}`;
  const result = transport.ssh({ remoteCommand, stdin: scriptBody, asRoot });
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
    const bindingDigest = fhvT4aBindingDigest({
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      originUrl: bindings.originUrl,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
    });
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
    readFhvT4aLocalReleaseReceipt(bindings.localStateDir);
    transport.resetRemoteWrites();
    const sudo = transport.sudoNoninteractiveProbe();
    if (sudo.exitCode !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_SUDO_NONINTERACTIVE_FAILED",
        "sudo -n probe failed during pre-auth.",
      );
    }
    streamBootstrapScript(
      transport,
      bindings,
      "scripts/ops/fhv-validate-origin-url.sh",
      ["--origin-url", bindings.originUrl],
      false,
    );
    streamBootstrapScript(
      transport,
      bindings,
      "scripts/ops/fhv-t4-host-preflight.sh",
      [
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
      ],
      true,
    );
    const writes = transport.remoteWriteCount();
    if (writes !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_PREAUTH_REMOTE_WRITES",
        `pre-auth remote write count must be 0, got ${writes}.`,
      );
    }
    const localReceipt = readFhvT4aLocalReleaseReceipt(bindings.localStateDir);
    writeFhvT4aPreauthReceipt(bindings.localStateDir, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      originUrl: bindings.originUrl,
      execHost: bindings.execHost,
      sshUser: bindings.sshUser,
      expectedHostname: bindings.expectedHostname,
      expectedMachineIdSha256: bindings.expectedMachineIdSha256,
      serviceUser: bindings.serviceUser,
      serviceUid: 1000,
      serviceGid: 1000,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      nodeBin: bindings.nodeBin,
      corepackBin: bindings.corepackBin,
      gitBin: bindings.gitBin,
      pythonBin: bindings.pythonBin,
      dockerBin: bindings.dockerBin,
      systemctlBin: bindings.systemctlBin,
      bootstrapBlobDigests: localReceipt.bootstrapBlobDigests,
      bindingDigest: localReceipt.bindingDigest,
      preauthRemoteWriteCount: writes,
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
    const localReceipt = readFhvT4aLocalReleaseReceipt(bindings.localStateDir);
    const preauthReceipt = readFhvT4aPreauthReceipt(bindings.localStateDir);
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
    if (!existsSync(ctx.continuityBefore)) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_CONTINUITY_BEFORE_MISSING",
        "Real continuity-before artifact required.",
      );
    }
    writeFhvT4aPostBeforeReceipt(bindings.localStateDir, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      runDir: ctx.runDir,
      continuityBeforePath: ctx.continuityBefore,
      continuityBeforeDigest: digestFile(ctx.continuityBefore),
      stepProofDigests,
    });
    return FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT;
  }

  if (phase === "post-reconnect-finalize") {
    const postBefore = readFhvT4aPostBeforeReceipt(bindings.localStateDir);
    if (!existsSync(postBefore.continuityBeforePath)) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_CONTINUITY_BEFORE_MISSING",
        "continuity-before proof required for post-reconnect-finalize.",
      );
    }
    const ceremonyLines: Record<string, string> = {};
    const stepProofDigests: Record<string, string> = {};
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
        for (const line of result.stdout.split("\n")) {
          const idx = line.indexOf("=");
          if (idx > 0) {
            ceremonyLines[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        }
      }
    }
    writeFhvT4aPostFinalizeReceipt(bindings.localStateDir, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      continuityAfterPath: ctx.continuityAfter,
      continuityAfterDigest: digestFile(ctx.continuityAfter),
      ceremonyClassifications: ceremonyLines,
      stepProofDigests,
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

if (process.env.WAIA_TRADER_CLI === "1" || import.meta.url.endsWith(process.argv[1] ?? "")) {
  main();
}

export { main as runFhvT4aOperatorCli };
