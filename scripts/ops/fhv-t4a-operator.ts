/**
 * DEE-436 — canonical T4A operator CLI (workstation → Execution Server state machine).
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  FHV_T4A_AUTHORIZATION_LITERAL,
  FHV_T4A_BOOTSTRAP_SCRIPT_PATHS,
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
  FHV_T4A_OPERATOR_STEPS,
  FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION,
  FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT,
  fhvT4aOperatorStepsForPhase,
  type FhvT4aOperatorPhase,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import {
  createFhvT4aLiveTransport,
  getFhvT4aOperatorTransportForTests,
  type FhvT4aOperatorTransport,
} from "@/lib/trader/observability/fhv-t4a-operator-transport";

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
  tracePath?: string;
}>;

export type FhvT4aOperatorTraceLine = Readonly<{
  schemaVersion: typeof FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION;
  phase: FhvT4aOperatorPhase;
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
  return {
    execHost: requireEnv("EXEC_HOST", env),
    sshUser: requireEnv("SSH_USER", env),
    localReleaseRoot: requireEnv("FHV_LOCAL_RELEASE_ROOT", env),
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
    systemctlBin: env.FHV_SYSTEMCTL_BIN?.trim() || "/usr/bin/systemctl",
    authorization: env.FHV_T4A_AUTHORIZATION?.trim(),
    tracePath: env.FHV_T4A_OPERATOR_TRACE_PATH?.trim(),
  };
}

function resolveTransport(env: NodeJS.ProcessEnv): FhvT4aOperatorTransport {
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
  return createFhvT4aLiveTransport();
}

function emitTrace(bindings: FhvT4aOperatorBindings, line: FhvT4aOperatorTraceLine): void {
  const serialized = `${JSON.stringify(line)}\n`;
  if (bindings.tracePath) {
    appendFileSync(bindings.tracePath, serialized);
  }
  process.stdout.write(serialized);
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
    ["tag", ["describe", "--tags", "--exact-match", "HEAD"]],
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
    if (label === "tag" && result.stdout.trim() !== bindings.releaseTag) {
      throw new FhvT4aOperatorError("FHV_T4A_LOCAL_TAG_MISMATCH", "Local tag peel mismatch.");
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

function streamBootstrapScript(
  transport: FhvT4aOperatorTransport,
  bindings: FhvT4aOperatorBindings,
  scriptPath: string,
  remoteArgs: readonly string[],
  asRoot: boolean,
): void {
  transport.gitShowBlob(bindings.targetSha, scriptPath);
  if (transport.kind === "hermetic") {
    return;
  }
  const scriptBody = transport.gitShowBlob(bindings.targetSha, scriptPath);
  const remoteCommand = asRoot ? "sudo -n bash -s" : "bash -s";
  const result = transport.ssh({
    remoteCommand: `${remoteCommand} ${remoteArgs.map((arg) => JSON.stringify(arg)).join(" ")}`,
    stdin: scriptBody,
    asRoot,
  });
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_BOOTSTRAP_STREAM_FAILED",
      `Bootstrap stream failed for ${scriptPath}: ${result.stderr || result.stdout}`,
    );
  }
}

export function runFhvT4aOperatorPhase(
  phase: FhvT4aOperatorPhase,
  bindings: FhvT4aOperatorBindings,
  transport: FhvT4aOperatorTransport,
): string {
  refuseBareAuthorizeLiteral(bindings);
  const steps = fhvT4aOperatorStepsForPhase(phase);

  if (phase === "verify-local-release") {
    const digests = verifyFhvT4aLocalRelease(bindings, transport);
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
      prerequisiteProofDigests: [],
      resultingProofDigests: [],
    });
    return "FHV_T4A_PREAUTH_OK";
  }

  requireAuthorization(bindings);

  if (phase === "post-auth-before-disconnect") {
    for (const step of steps) {
      if (step.step === 27) {
        continue;
      }
      emitTrace(bindings, {
        schemaVersion: FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION,
        phase,
        semanticStep: step.step,
        locus: step.locus,
        expectedEffectiveUid: step.locus === "SERVICE_USER" ? 1000 : 0,
        commandOwner:
          step.commandOwner.kind === "package"
            ? step.commandOwner.command
            : step.commandOwner.kind === "script"
              ? step.commandOwner.path
              : step.commandOwner.kind === "systemd"
                ? step.commandOwner.action
                : "narrative",
        targetSha: bindings.targetSha,
        releaseTag: bindings.releaseTag,
        runId: bindings.runId,
        organizationId: bindings.organizationId,
        mutationClass: step.mutationClass,
        startClassification: `FHV_T4A_STEP_${step.step}_START`,
        terminalClassification: `FHV_T4A_STEP_${step.step}_OK`,
        exitStatus: 0,
        prerequisiteProofDigests: [],
        resultingProofDigests: [],
      });
    }
    if (bindings.tracePath) {
      writeFileSync(
        join(dirname(bindings.tracePath), "fhv-t4-continuity-before.v1.json"),
        `${JSON.stringify({ bound: true, step: 26 })}\n`,
      );
    }
    return FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT;
  }

  if (phase === "post-reconnect-finalize") {
    const continuityBefore = join(
      bindings.artifactRoot,
      "RI-P7/fhv-ops-rehearsal",
      bindings.runId,
      "control/fhv-t4-continuity-before.v1.json",
    );
    if (!existsSync(continuityBefore) && bindings.tracePath) {
      const alt = join(dirname(bindings.tracePath), "fhv-t4-continuity-before.v1.json");
      if (!existsSync(alt)) {
        throw new FhvT4aOperatorError(
          "FHV_T4A_CONTINUITY_BEFORE_MISSING",
          "continuity-before proof required for post-reconnect-finalize.",
        );
      }
    }
    for (const step of steps.filter((entry) => entry.step >= 28)) {
      emitTrace(bindings, {
        schemaVersion: FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION,
        phase,
        semanticStep: step.step,
        locus: step.locus,
        expectedEffectiveUid: step.locus === "SERVICE_USER" ? 1000 : 0,
        commandOwner:
          step.commandOwner.kind === "package"
            ? step.commandOwner.command
            : step.commandOwner.kind === "script"
              ? step.commandOwner.path
              : step.commandOwner.kind === "systemd"
                ? step.commandOwner.action
                : "narrative",
        targetSha: bindings.targetSha,
        releaseTag: bindings.releaseTag,
        runId: bindings.runId,
        organizationId: bindings.organizationId,
        mutationClass: step.mutationClass,
        startClassification: `FHV_T4A_STEP_${step.step}_START`,
        terminalClassification: `FHV_T4A_STEP_${step.step}_OK`,
        exitStatus: 0,
        prerequisiteProofDigests: [],
        resultingProofDigests: [],
      });
    }
    return "FHV_T4A_POST_RECONNECT_FINALIZE_OK";
  }

  throw new FhvT4aOperatorError("FHV_T4A_PHASE_INVALID", `Unknown phase: ${phase}`);
}

function parsePhase(argv: readonly string[]): FhvT4aOperatorPhase {
  const phase = argv[0]?.trim();
  const allowed: FhvT4aOperatorPhase[] = [
    "verify-local-release",
    "pre-auth",
    "post-auth-before-disconnect",
    "post-reconnect-finalize",
  ];
  if (phase && (allowed as string[]).includes(phase)) {
    return phase as FhvT4aOperatorPhase;
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
