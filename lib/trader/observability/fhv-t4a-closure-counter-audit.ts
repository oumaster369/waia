/**
 * DEE-436 — machine-derived T4A closure defect counters (static + hermetic probes).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FHV_T4A_BOOTSTRAP_SCRIPT_PATHS,
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
  FHV_T4A_OPERATOR_STEPS,
  fhvT4aOperatorReleaseCheckoutIdentityArgs,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";

export const FHV_T4A_CLOSURE_COUNTER_NAMES = [
  "PACKET_CANONICAL_EXECUTABLE_OWNER_MISSING",
  "PACKET_LOW_LEVEL_COMMAND_DUPLICATION",
  "WORKSTATION_RELEASE_TREE_DIRTY_ALLOWED",
  "BOOTSTRAP_NOT_COMMIT_OBJECT_BOUND",
  "PREAUTH_STDIN_SIBLING_DEPENDENCY",
  "CHECKOUT_STDIN_SIBLING_DEPENDENCY",
  "INSTALL_STDIN_SIBLING_DEPENDENCY",
  "PREAUTH_REMOTE_WRITE_COUNT",
  "SUDO_NONINTERACTIVE_GAP",
  "STEP4_REQUIRED_GIT_BIN_MISSING",
  "STEP4_REQUIRED_PYTHON_BIN_MISSING",
  "SERVICE_USER_NODE_PATH_UNBOUND",
  "SERVICE_USER_COREPACK_PATH_UNBOUND",
  "INSTALL_NODE_PATH_UNBOUND",
  "SYSTEMD_EXECSTARTPRE_GIT_PATH_UNBOUND",
  "BARE_CRITICAL_TOOL_INVOCATIONS",
  "BOOT_ID_FORMAT_DRIFT",
  "ENVIRONMENT_FILE_SHELL_EVALUATION",
  "ENVIRONMENT_REQUIRED_KEY_GAP",
  "RESUME_NONROOT_SYSTEMCTL_PATH",
  "RESUME_ROOT_ENFORCEMENT_PROOF_MISSING",
  "CAMPAIGN_COMPLETION_ACTIVE_RACE",
  "CAMPAIGN_REACTIVATION_IDENTITY_GAP",
  "OBSERVER_HEALTH_IDENTITY_BINDING_MISSING",
  "OBSERVER_POST_RESTART_QUALIFICATION_MISSING",
  "LEGACY_CONTAINER_BINDING_DRIFT",
  "SYSTEMD_SANDBOX_PATH_INCOMPATIBILITY",
  "RUN_BINDING_VALIDATION_GAP",
  "EXACT_32_STEP_SIMULATION_MISSING",
  "STATIC_ONLY_REQUIRED_TEST_CASES",
  "PACKET_COMMAND_MISMATCHES",
  "IMPOSSIBLE_STATES",
  "MISSING_TEST_CASES",
  "TARGETED_TEST_FAILURES",
  "INTEGRATION_TEST_FAILURES",
  "FULL_TEST_FAILURES",
  "CLEAN_RUNNER_FAILURES",
  "BUILD_FAILURES",
  "FRESH_CHECK_FAILURES",
  "FRESH_CHECKS_PENDING",
] as const;

export type FhvT4aClosureCounterName = (typeof FHV_T4A_CLOSURE_COUNTER_NAMES)[number];

export type FhvT4aClosureCounterMap = Record<FhvT4aClosureCounterName, number>;

function zeroCounters(): FhvT4aClosureCounterMap {
  return Object.fromEntries(
    FHV_T4A_CLOSURE_COUNTER_NAMES.map((name) => [name, 0]),
  ) as FhvT4aClosureCounterMap;
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function countBareCriticalInvocations(root: string): number {
  const requiredBindings: Record<string, readonly string[]> = {
    "scripts/ops/fhv-t4-service-user-exec.sh": ["--node-bin", "--corepack-bin"],
    "scripts/ops/fhv-service-user-install-deps.sh": ["--node-bin"],
    "scripts/ops/fhv-t4-resume-campaign-root.sh": ["--systemctl-bin"],
    "scripts/ops/fhv-t4-host-preflight.sh": [
      "--node-bin",
      "--corepack-bin",
      "--git-bin",
      "--python-bin",
      "--docker-bin",
    ],
    "scripts/ops/fhv-t4-campaign-wait-completed.sh": ["--systemctl-bin", "--python-bin"],
    "scripts/ops/fhv-t4-campaign-systemd-identity-read.sh": ["--systemctl-bin", "--python-bin"],
    "scripts/ops/fhv-t4-observer-systemd-identity-read.sh": ["--systemctl-bin", "--python-bin"],
    "scripts/ops/fhv-t4-observer-wait-active.sh": ["--systemctl-bin", "--python-bin"],
  };
  let hits = 0;
  for (const [rel, flags] of Object.entries(requiredBindings)) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      hits += 1;
      continue;
    }
    const body = read(root, rel);
    for (const flag of flags) {
      if (!body.includes(flag)) {
        hits += 1;
      }
    }
  }
  return hits;
}

export type FhvT4aClosureCounterAuditOptions = Readonly<{
  root?: string;
  preauthRemoteWriteCount?: number;
  targetedTestFailures?: number;
  integrationTestFailures?: number;
  fullTestFailures?: number;
  cleanRunnerFailures?: number;
  buildFailures?: number;
  freshCheckFailures?: number;
  freshChecksPending?: number;
}>;

export function auditFhvT4aClosureCounters(
  options: FhvT4aClosureCounterAuditOptions = {},
): FhvT4aClosureCounterMap {
  const root = options.root ?? process.cwd();
  const counters = zeroCounters();

  const packetPath = join(root, "docs/ops/T4_OPERATOR_PACKET_V5.md");
  const packet = readFileSync(packetPath, "utf8");
  const nonExecutableStart = packet.indexOf("## NON_EXECUTABLE");
  const executableBody = nonExecutableStart === -1 ? packet : packet.slice(0, nonExecutableStart);

  const operatorSh = join(root, "scripts/ops/fhv-t4a-operator.sh");
  const operatorTs = join(root, "scripts/ops/fhv-t4a-operator.ts");
  if (!existsSync(operatorSh) || !existsSync(operatorTs)) {
    counters.PACKET_CANONICAL_EXECUTABLE_OWNER_MISSING = 1;
  }
  if (!executableBody.includes("fhv-t4a-operator.sh")) {
    counters.PACKET_CANONICAL_EXECUTABLE_OWNER_MISSING += 1;
  }

  if (/ssh "\$\{SSH_USER\}@\$\{EXEC_HOST\}"/.test(executableBody)) {
    counters.PACKET_LOW_LEVEL_COMMAND_DUPLICATION = 1;
  }

  const operatorBody = read(root, "scripts/ops/fhv-t4a-operator.ts");
  if (
    !operatorBody.includes("--porcelain=v1") ||
    !operatorBody.includes("FHV_T4A_LOCAL_RELEASE_DIRTY")
  ) {
    counters.WORKSTATION_RELEASE_TREE_DIRTY_ALLOWED = 1;
  }
  if (!operatorBody.includes("gitShowBlob") || !operatorBody.includes("targetSha")) {
    counters.BOOTSTRAP_NOT_COMMIT_OBJECT_BOUND = 1;
  }

  const bootstrapScripts = [
    "scripts/ops/fhv-t4-host-preflight.sh",
    "scripts/ops/fhv-service-user-checkout.sh",
    "scripts/ops/fhv-service-user-install-deps.sh",
  ] as const;
  for (const [index, scriptPath] of bootstrapScripts.entries()) {
    const body = read(root, scriptPath);
    if (body.includes("_fhv-t4-privilege-common.sh")) {
      if (index === 0) {
        counters.PREAUTH_STDIN_SIBLING_DEPENDENCY = 1;
      } else if (index === 1) {
        counters.CHECKOUT_STDIN_SIBLING_DEPENDENCY = 1;
      } else {
        counters.INSTALL_STDIN_SIBLING_DEPENDENCY = 1;
      }
    }
  }

  counters.PREAUTH_REMOTE_WRITE_COUNT = options.preauthRemoteWriteCount ?? 0;

  if (
    !operatorBody.includes("sudoNoninteractiveProbe") ||
    !read(root, "lib/trader/observability/fhv-t4a-operator-transport.ts").includes("BatchMode=yes")
  ) {
    counters.SUDO_NONINTERACTIVE_GAP = 1;
  }

  const step4Args = fhvT4aOperatorReleaseCheckoutIdentityArgs();
  if (!step4Args.includes("--git-bin")) {
    counters.STEP4_REQUIRED_GIT_BIN_MISSING = 1;
  }
  if (!step4Args.includes("--python-bin")) {
    counters.STEP4_REQUIRED_PYTHON_BIN_MISSING = 1;
  }
  if (!executableBody.includes("--git-bin") || !executableBody.includes("--python-bin")) {
    counters.STEP4_REQUIRED_GIT_BIN_MISSING += 1;
  }

  const serviceExec = read(root, "scripts/ops/fhv-t4-service-user-exec.sh");
  if (!serviceExec.includes("--node-bin")) {
    counters.SERVICE_USER_NODE_PATH_UNBOUND = 1;
  }
  if (!serviceExec.includes("--corepack-bin")) {
    counters.SERVICE_USER_COREPACK_PATH_UNBOUND = 1;
  }
  if (serviceExec.includes('source "$ENVIRONMENT_FILE"')) {
    counters.ENVIRONMENT_FILE_SHELL_EVALUATION = 1;
  }

  const installDeps = read(root, "scripts/ops/fhv-service-user-install-deps.sh");
  if (!installDeps.includes("--node-bin")) {
    counters.INSTALL_NODE_PATH_UNBOUND = 1;
  }

  const renderDir = join(root, "scripts/ops");
  const renderCandidates = ["fhv-systemd-render-units.sh", "fhv-systemd-install-units.sh"];
  let execStartPreGap = 0;
  for (const name of renderCandidates) {
    const path = join(renderDir, name);
    if (!existsSync(path)) {
      continue;
    }
    const body = readFileSync(path, "utf8");
    if (body.includes("ExecStartPre") && !body.includes("--git-bin")) {
      execStartPreGap = 1;
    }
  }
  counters.SYSTEMD_EXECSTARTPRE_GIT_PATH_UNBOUND = execStartPreGap;

  counters.BARE_CRITICAL_TOOL_INVOCATIONS = countBareCriticalInvocations(root);

  try {
    normalizeFhvT4BootId("11111111-2222-4333-8444-555555555555");
  } catch {
    counters.BOOT_ID_FORMAT_DRIFT = 1;
  }
  if (!existsSync(join(root, "lib/trader/observability/fhv-t4-environment-file.ts"))) {
    counters.ENVIRONMENT_REQUIRED_KEY_GAP = 1;
  }

  const observerCore = read(root, "lib/trader/observability/fhv-linux-systemd-executor.ts");
  if (observerCore.includes("systemctl start waia-fhv-campaign")) {
    counters.RESUME_NONROOT_SYSTEMCTL_PATH = 1;
  }
  if (!existsSync(join(root, "scripts/ops/fhv-t4-resume-campaign-root.sh"))) {
    counters.RESUME_ROOT_ENFORCEMENT_PROOF_MISSING = 1;
  }

  const waitCompleted = read(root, "scripts/ops/fhv-t4-campaign-wait-completed.sh");
  if (
    !waitCompleted.includes("deactivating") ||
    !waitCompleted.includes("InvocationID") ||
    waitCompleted.includes('ActiveState=active" ] && exit 1')
  ) {
    counters.CAMPAIGN_COMPLETION_ACTIVE_RACE = 1;
  }
  if (!waitCompleted.includes("NRestarts")) {
    counters.CAMPAIGN_REACTIVATION_IDENTITY_GAP = 1;
  }

  if (!existsSync(join(root, "lib/trader/observability/fhv-t4-observer-qualification-proof.ts"))) {
    counters.OBSERVER_HEALTH_IDENTITY_BINDING_MISSING = 1;
    counters.OBSERVER_POST_RESTART_QUALIFICATION_MISSING = 1;
  }

  if (
    !executableBody.includes(FHV_T4A_LEGACY_CONTAINER_NAME) ||
    !executableBody.includes(FHV_T4A_LEGACY_CONTAINER_IMAGE)
  ) {
    counters.LEGACY_CONTAINER_BINDING_DRIFT = 1;
  }

  const preflight = read(root, "scripts/ops/fhv-t4-host-preflight.sh");
  if (
    !preflight.includes("ProtectHome=true") &&
    !preflight.includes("/home/*") &&
    !operatorBody.includes("validateFhvT4aOperatorBindings")
  ) {
    counters.SYSTEMD_SANDBOX_PATH_INCOMPATIBILITY = 1;
  }

  if (
    !operatorBody.includes("FHV_ORGANIZATION_ID") ||
    !operatorBody.includes("resolveFhvT4aOperatorBindings")
  ) {
    counters.RUN_BINDING_VALIDATION_GAP = 1;
  }

  const stateMachineTest = join(root, "tests/integration/fhv-t4a-operator-state-machine.test.ts");
  if (!existsSync(stateMachineTest)) {
    counters.EXACT_32_STEP_SIMULATION_MISSING = 1;
  } else {
    const smBody = readFileSync(stateMachineTest, "utf8");
    if (
      !smBody.includes("post-auth-before-disconnect") ||
      !smBody.includes("post-reconnect-finalize") ||
      !smBody.includes("createFhvT4aHermeticTransport")
    ) {
      counters.EXACT_32_STEP_SIMULATION_MISSING = 1;
    }
    if (
      smBody.includes("indexOf") &&
      !smBody.includes("runFhvT4aOperatorPhase") &&
      !smBody.includes("verifyFhvT4aLocalRelease")
    ) {
      counters.STATIC_ONLY_REQUIRED_TEST_CASES = 1;
    }
  }

  if (FHV_T4A_OPERATOR_STEPS.length !== 32) {
    counters.IMPOSSIBLE_STATES = 1;
  }

  for (const scriptPath of FHV_T4A_BOOTSTRAP_SCRIPT_PATHS) {
    if (!existsSync(join(root, scriptPath))) {
      counters.MISSING_TEST_CASES = 1;
    }
  }

  counters.TARGETED_TEST_FAILURES = options.targetedTestFailures ?? 0;
  counters.INTEGRATION_TEST_FAILURES = options.integrationTestFailures ?? 0;
  counters.FULL_TEST_FAILURES = options.fullTestFailures ?? 0;
  counters.CLEAN_RUNNER_FAILURES = options.cleanRunnerFailures ?? 0;
  counters.BUILD_FAILURES = options.buildFailures ?? 0;
  counters.FRESH_CHECK_FAILURES = options.freshCheckFailures ?? 0;
  counters.FRESH_CHECKS_PENDING = options.freshChecksPending ?? 0;

  return counters;
}

export function formatFhvT4aClosureCounters(counters: FhvT4aClosureCounterMap): string {
  return FHV_T4A_CLOSURE_COUNTER_NAMES.map((name) => `${name}=${counters[name]}`).join("\n");
}

export function assertFhvT4aClosureCountersZero(counters: FhvT4aClosureCounterMap): void {
  const nonzero = FHV_T4A_CLOSURE_COUNTER_NAMES.filter((name) => counters[name] !== 0);
  if (nonzero.length > 0) {
    throw new Error(
      `Nonzero T4A closure counters: ${nonzero.map((n) => `${n}=${counters[n]}`).join(", ")}`,
    );
  }
}
