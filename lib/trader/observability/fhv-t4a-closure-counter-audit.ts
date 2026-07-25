/**
 * DEE-436 — machine-derived T4A closure defect counters (static + hermetic probes).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFhvT4aHermeticTransport } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
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
  "TRACE_ONLY_POST_STEPS",
  "POST_STEP_EXECUTION_MISSING",
  "SYNTHETIC_CONTINUITY_PROOF_WRITES",
  "LIVE_PREAUTH_FALSE_WRITE_ACCOUNTING",
  "HERMETIC_SSH_BYPASS",
  "DOUBLE_SUDO_TRANSITIONS",
  "LOCAL_REMOTE_TRACE_PATH_ALIAS",
  "LOCAL_RELEASE_RECEIPT_MISSING",
  "PREAUTH_RECEIPT_MISSING",
  "PHASE_ORDER_BYPASS",
  "REAL_GIT_INDEX_MUTATION_IN_TESTS",
  "CI_PACKET_GATE_MISSING",
  "COUNTER_DEFAULT_ZERO_PATHS",
  "NONEXECUTABLE_COMMAND_COPY",
  "BARE_OPERATOR_NODE",
  "CEREMONY_OUTPUT_NOT_REACHED",
  "REMOTE_PATH_ACCESSED_BY_LOCAL_FS",
  "STEP6_TARGET_SHA_MISSING",
  "INSTALL_UNITS_ARGV_INVALID",
  "DEPLOY_RECORD_ARGV_INVALID",
  "HOST_PROBE_RAW_SOURCE_MISSING",
  "SYSTEMD_IDENTITY_TOOL_FLAGS_MISSING",
  "OBSERVER_QUALIFICATION_PROOF_OPTIONAL",
  "STEP32_CLOSURE_ARGV_INVALID",
  "HERMETIC_UNKNOWN_COMMAND_SUCCESS",
  "LOCAL_GIT_BINARY_IGNORED",
  "PHASE_RECEIPT_FULL_BINDING_GAP",
  "PHASE_RECEIPT_OVERWRITE_ALLOWED",
  "PREAUTH_UNMEASURED_ZERO_CLAIM",
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
    "scripts/ops/fhv-t4-resume-campaign-root.sh": ["--systemctl-bin", "--node-bin"],
    "scripts/ops/fhv-t4a-operator.sh": ["FHV_LOCAL_NODE_BIN"],
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

function probePreauthRemoteWrites(root: string): number {
  const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const work = mkdtempSync(join(tmpdir(), "fhv-t4a-audit-preauth-"));
  try {
    const envFile = join(work, "fhv.env");
    const artifactRoot = join(work, "artifacts");
    const checkoutParent = join(work, "checkouts");
    const transport = createFhvT4aHermeticTransport({
      localReleaseRoot: root,
      targetSha: sha,
      releaseTag: "local-dev",
      originUrl: "https://github.com/oumaster369/waia.git",
      serviceUser: "fhv",
      serviceUserHome: "/home/fhv",
      checkoutParent,
      artifactRoot,
      environmentFile: envFile,
      runId: "audit-preauth",
      organizationId: "00000000-0000-4000-8000-000000000001",
      nodeBin: process.execPath,
      corepackBin: process.execPath,
      gitBin: "/usr/bin/git",
      pythonBin: "/usr/bin/python3",
      dockerBin: "/usr/bin/docker",
      systemctlBin: "/usr/bin/systemctl",
    });
    transport.resetRemoteWrites();
    for (const scriptPath of [
      "scripts/ops/fhv-validate-origin-url.sh",
      "scripts/ops/fhv-t4-host-preflight.sh",
    ]) {
      const scriptBody = transport.gitShowBlob(sha, scriptPath);
      transport.ssh({
        remoteCommand: "bash -s --",
        stdin: scriptBody,
        asRoot: scriptPath.includes("host-preflight"),
      });
    }
    return transport.remoteWriteCount();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
  evidenceProvided?: boolean;
}>;

export function auditFhvT4aClosureCounters(
  options: FhvT4aClosureCounterAuditOptions = {},
): FhvT4aClosureCounterMap {
  const root = options.root ?? process.cwd();
  const counters = zeroCounters();
  const evidenceProvided = options.evidenceProvided === true;

  const packetPath = join(root, "docs/ops/T4_OPERATOR_PACKET_V5.md");
  const packet = readFileSync(packetPath, "utf8");
  const nonExecutableStart = packet.indexOf("## NON_EXECUTABLE");
  const executableBody = nonExecutableStart === -1 ? packet : packet.slice(0, nonExecutableStart);

  if (nonExecutableStart !== -1) {
    counters.NONEXECUTABLE_COMMAND_COPY = 1;
  }

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
  const executorBody = existsSync(
    join(root, "lib/trader/observability/fhv-t4a-operator-executor.ts"),
  )
    ? read(root, "lib/trader/observability/fhv-t4a-operator-executor.ts")
    : "";
  const transportBody = read(root, "lib/trader/observability/fhv-t4a-operator-transport.ts");

  if (
    /for \(let step = 1; step <= 26/.test(operatorBody) &&
    !operatorBody.includes("executeFhvT4aStep")
  ) {
    counters.TRACE_ONLY_POST_STEPS = 1;
  }
  if (
    !operatorBody.includes("executeFhvT4aStep") ||
    !existsSync(join(root, "lib/trader/observability/fhv-t4a-operator-executor.ts"))
  ) {
    counters.POST_STEP_EXECUTION_MISSING = 1;
  }
  if (
    operatorBody.includes('"bound":true,"step":26') ||
    operatorBody.includes('{"bound":true,"step":26}')
  ) {
    counters.SYNTHETIC_CONTINUITY_PROOF_WRITES = 1;
  }
  if (
    /remoteWrites\s*\+/.test(transportBody) &&
    /stdin/.test(transportBody) &&
    !transportBody.includes("preauthMeasuredRemoteWriteCount")
  ) {
    counters.LIVE_PREAUTH_FALSE_WRITE_ACCOUNTING = 1;
  }
  if (
    !operatorBody.includes("preauthMeasuredRemoteWriteCount") ||
    !transportBody.includes("preauthLedgerEntries")
  ) {
    counters.PREAUTH_UNMEASURED_ZERO_CLAIM = 1;
  }
  if (!transportBody.includes("FHV_LOCAL_GIT_BIN")) {
    counters.LOCAL_GIT_BINARY_IGNORED = 1;
  }
  if (
    !executorBody.includes("--systemctl-bin") ||
    !executorBody.includes("--python-bin") ||
    !read(root, "lib/trader/observability/fhv-t4a-observer-qualification.ts").includes(
      "--systemctl-bin",
    )
  ) {
    counters.SYSTEMD_IDENTITY_TOOL_FLAGS_MISSING = 1;
  }
  if (
    executorBody.includes("existsSync(") ||
    executorBody.includes("readFileSync(") ||
    executorBody.includes("digestFile(")
  ) {
    counters.REMOTE_PATH_ACCESSED_BY_LOCAL_FS = 1;
  }
  if (
    !executorBody.includes('"--target-sha"') ||
    executorBody.includes("identityArgs(ctx).slice(0, 6)")
  ) {
    counters.STEP6_TARGET_SHA_MISSING = 1;
  }
  if (
    !executorBody.includes("installUnitsArgs") ||
    !executorBody.includes("--systemctl-bin") ||
    !executorBody.includes("--systemd-analyze")
  ) {
    counters.INSTALL_UNITS_ARGV_INVALID = 1;
  }
  const step11Block = executorBody.match(/case 11:\s*\{[\s\S]*?case 12:/)?.[0] ?? "";
  if (
    !step11Block.includes("fhv-systemd-record-deploy.sh") ||
    !step11Block.includes("--rendered-unit-digests") ||
    step11Block.includes("--run-root")
  ) {
    counters.DEPLOY_RECORD_ARGV_INVALID = 1;
  }
  if (
    !executorBody.includes("fhv-t4-host-probe.sh") ||
    !executorBody.includes("--raw-host-probe-json-path")
  ) {
    counters.HOST_PROBE_RAW_SOURCE_MISSING = 1;
  }
  if (
    !executorBody.includes("captureFhvT4aObserverQualification") ||
    executorBody.includes("if (existsSync(qualPath))")
  ) {
    counters.OBSERVER_QUALIFICATION_PROOF_OPTIONAL = 1;
  }
  if (
    !executorBody.includes("trader:fhv:t4:verify-ceremony") ||
    !executorBody.includes("--host-probe-json-path")
  ) {
    counters.STEP32_CLOSURE_ARGV_INVALID = 1;
  }
  if (
    !existsSync(join(root, "lib/trader/observability/fhv-t4a-hermetic-simulation.ts")) ||
    !read(root, "lib/trader/observability/fhv-t4a-hermetic-simulation.ts").includes(
      "HERMETIC_UNKNOWN_COMMAND_SUCCESS",
    )
  ) {
    counters.HERMETIC_UNKNOWN_COMMAND_SUCCESS = 1;
  }
  if (
    !existsSync(join(root, "lib/trader/observability/fhv-t4a-phase-receipts.ts")) ||
    !read(root, "lib/trader/observability/fhv-t4a-phase-receipts.ts").includes(
      "fhvT4aFullBindingFields",
    ) ||
    !read(root, "lib/trader/observability/fhv-t4a-phase-receipts.ts").includes(
      "assertReceiptNotExists",
    )
  ) {
    counters.PHASE_RECEIPT_FULL_BINDING_GAP = 1;
    counters.PHASE_RECEIPT_OVERWRITE_ALLOWED = 1;
  }
  if (operatorBody.includes('transport.kind === "hermetic"') && operatorBody.includes("return")) {
    counters.HERMETIC_SSH_BYPASS = 1;
  }
  if (!transportBody.includes("assertExactlyOneSudoTransition")) {
    counters.DOUBLE_SUDO_TRANSITIONS = 1;
  }
  if (
    operatorBody.includes("FHV_T4A_OPERATOR_TRACE_PATH") ||
    (!operatorBody.includes("FHV_T4A_LOCAL_STATE_DIR") &&
      operatorBody.includes("workstationTracePath"))
  ) {
    counters.LOCAL_REMOTE_TRACE_PATH_ALIAS = 1;
  }
  if (!operatorBody.includes("writeFhvT4aLocalReleaseReceipt")) {
    counters.LOCAL_RELEASE_RECEIPT_MISSING = 1;
  }
  if (!operatorBody.includes("writeFhvT4aPreauthReceipt")) {
    counters.PREAUTH_RECEIPT_MISSING = 1;
  }
  if (
    !operatorBody.includes("readFhvT4aLocalReleaseReceipt") ||
    !operatorBody.includes("readFhvT4aPreauthReceipt") ||
    !operatorBody.includes("readFhvT4aPostBeforeReceipt")
  ) {
    counters.PHASE_ORDER_BYPASS = 1;
  }
  if (
    operatorBody.includes("classification: `FHV_T4A_STEP_${step}_OK`") ||
    operatorBody.includes("predetermined")
  ) {
    counters.TRACE_ONLY_POST_STEPS += 1;
  }
  if (!executorBody.includes("verify-ceremony") || !operatorBody.includes("ceremonyLines")) {
    counters.CEREMONY_OUTPUT_NOT_REACHED = 1;
  }

  const operatorShBody = existsSync(operatorSh)
    ? read(root, "scripts/ops/fhv-t4a-operator.sh")
    : "";
  if (operatorShBody.includes("exec node ") || /\bnode --import tsx/.test(operatorShBody)) {
    counters.BARE_OPERATOR_NODE = 1;
  }

  const ciWorkflow = join(root, ".github/workflows/ci.yml");
  if (
    !existsSync(ciWorkflow) ||
    !read(root, ".github/workflows/ci.yml").includes("validate:fhv-t4a-packet")
  ) {
    counters.CI_PACKET_GATE_MISSING = 1;
  }

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

  counters.PREAUTH_REMOTE_WRITE_COUNT =
    options.preauthRemoteWriteCount ?? probePreauthRemoteWrites(root);

  if (
    !operatorBody.includes("sudoNoninteractiveProbe") ||
    !transportBody.includes("BatchMode=yes")
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
      !smBody.includes("fhv-t4a-operator.sh")
    ) {
      counters.EXACT_32_STEP_SIMULATION_MISSING = 1;
    }
    if (
      !smBody.includes("FHV_T4A_HERMETIC_INTEGRATION") ||
      !smBody.includes("assertSourceCheckoutClean")
    ) {
      counters.STATIC_ONLY_REQUIRED_TEST_CASES = 1;
    }
    if (smBody.includes("git add") || smBody.includes('["add"')) {
      counters.REAL_GIT_INDEX_MUTATION_IN_TESTS = 1;
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

  const runtimeCounters: Array<keyof FhvT4aClosureCounterAuditOptions> = [
    "targetedTestFailures",
    "integrationTestFailures",
    "fullTestFailures",
    "cleanRunnerFailures",
    "buildFailures",
    "freshCheckFailures",
    "freshChecksPending",
  ];
  if (!evidenceProvided) {
    for (const key of runtimeCounters) {
      if (options[key] === undefined) {
        counters.COUNTER_DEFAULT_ZERO_PATHS += 1;
      }
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
