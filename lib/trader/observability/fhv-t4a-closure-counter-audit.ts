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
import {
  FHV_T4A_REQUIRED_EXECUTABLE_GIT_MODE,
  fhvT4aDirectExecutionScriptPaths,
} from "@/lib/trader/observability/fhv-t4a-direct-execution-contract";
import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";
import {
  FHV_T4A_CEREMONY_REQUIRED_RESULTS,
  FHV_T4A_CEREMONY_FORBIDDEN_KEYS,
} from "@/lib/trader/observability/fhv-t4a-ceremony-results";

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
  "DIRECT_EXECUTION_NONEXECUTABLE_GIT_MODE",
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
  "QUALIFICATION_DOUBLE_SERIALIZATION",
  "QUALIFICATION_CONTENT_DIGEST_INVALID",
  "QUALIFICATION_OVERWRITE_ALLOWED",
  "EXCLUSIVE_WRITER_DELETES_EXISTING_TARGET",
  "PRE_QUALIFICATION_DIGEST_NOT_REVALIDATED",
  "OBSERVER_BASELINE_DIGEST_UNUSED",
  "QUALIFICATION_NOT_SEMANTICALLY_VERIFIED_BY_CEREMONY",
  "POST_RESTART_CAMPAIGN_IDENTITY_NOT_IN_PROOF",
  "CONTINUITY_BARE_SHELL_EXECUTION",
  "REMOTE_FS_BARE_PIPELINE_TOOL",
  "REMOTE_FS_PRIVILEGE_LOCUS_MISSING",
  "PREAUTH_LEDGER_BOOTSTRAP_BINDING_MISSING",
  "PREAUTH_LEDGER_EXIT_STATUS_MISSING",
  "PREAUTH_STDIN_BODY_UNAUDITED",
  "PREFLIGHT_FACTS_DROPPED",
  "FINAL_RECEIPT_SEAL_ROOT_MISSING",
  "HERMETIC_CANNED_CLOSURE_SUCCESS",
  "BINDING_PARITY_MANUAL_DUPLICATION",
  "ATOMIC_RENAME_CAN_OVERWRITE_TARGET",
  "ATOMIC_CONCURRENCY_TEST_NOT_CONCURRENT",
  "RECONNECT_CONTINUITY_NOT_STRICTLY_PARSED",
  "REMOTE_FS_PRIVILEGE_LOCUS_IGNORED",
  "REMOTE_FS_UNBOUNDED_READ",
  "REMOTE_FS_PARENT_SYMLINK_ESCAPE",
  "FINAL_RECEIPT_VERIFY_SEAL_CLASSIFICATION_EMPTY",
  "FINAL_RECEIPT_SEAL_MANIFEST_DIGEST_EMPTY",
  "PREFLIGHT_SYSTEMCTL_FACT_SYNTHETIC",
  "PREFLIGHT_SYSTEMD_ANALYZE_FACT_SYNTHETIC",
  "PREFLIGHT_HOST_BOOT_ID_DROPPED",
  "STEP_TRACE_SERVICE_UID_HARDCODED",
  "QUALIFICATION_SECOND_CAPTURE_NOT_ACTIVE",
  "QUALIFICATION_ACTIVE_ENTER_TIMESTAMP_DRIFT",
  "QUALIFICATION_IDENTITY_NOT_CANONICALLY_PARSED",
  "QUALIFICATION_BOOT_ID_INTERNAL_MISMATCH",
  "FINAL_RECEIPT_CONTINUITY_VERIFICATION_PROOF_MISSING",
  "FINAL_RECEIPT_CONTINUITY_VERIFICATION_DIGEST_MISSING",
  "CONTINUITY_VERIFICATION_PROOF_NOT_REVALIDATED",
  "QUALIFICATION_CAPTURE_BOOT_ID_NOT_PERSISTED",
  "QUALIFICATION_CAPTURE_UNIT_NAME_NOT_PERSISTED",
  "QUALIFICATION_CAPTURE_BOOT_ID_MISMATCH_ALLOWED",
  "QUALIFICATION_CAPTURE_UNIT_MISMATCH_ALLOWED",
  "CEREMONY_EXACT_VALUE_NOT_ENFORCED",
  "CEREMONY_REQUIRED_FIELD_MISSING",
  "PACKET_RELEASE_PREREQUISITES_MISSING",
  "PACKET_FRESH_RUN_NAMESPACE_MISSING",
  "PACKET_RETRY_PROHIBITION_MISSING",
  "PACKET_PREAUTH_AUTHORIZATION_NOT_UNSET",
  "PACKET_COMPLETE_CEREMONY_MATRIX_MISSING",
  "PACKET_RECONNECT_BINDING_RESTORE_MISSING",
  "PACKET_EVIDENCE_PRESERVATION_MISSING",
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
    "scripts/ops/fhv-t4-resume-campaign-root.sh": ["--systemctl-bin", "--node-bin", "--repo-root"],
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
    "scripts/ops/fhv-t4-host-probe.sh": [
      "--python-bin",
      "--systemctl-bin",
      "--docker-bin",
      "--installed-units-dir",
    ],
    "scripts/ops/fhv-supervisor/rollback-units.sh": ["--systemctl-bin", "--systemd-dir"],
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
      systemdAnalyzeBin: "/usr/bin/systemd-analyze",
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
  const bindingSpec = existsSync(join(root, "lib/trader/observability/fhv-t4a-binding-spec.ts"))
    ? read(root, "lib/trader/observability/fhv-t4a-binding-spec.ts")
    : "";
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
    !transportBody.includes("preauthMutatingCommandCount")
  ) {
    counters.LIVE_PREAUTH_FALSE_WRITE_ACCOUNTING = 1;
  }
  if (
    !operatorBody.includes("preauthMutatingCommandCount") ||
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
    (!bindingSpec.includes("FHV_T4A_LOCAL_STATE_DIR") &&
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
  if (
    !executorBody.includes("verify-ceremony") ||
    (!operatorBody.includes("ceremonyClassifications") && !operatorBody.includes("ceremonyLines"))
  ) {
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

  for (const scriptPath of fhvT4aDirectExecutionScriptPaths()) {
    try {
      const mode = execFileSync("git", ["ls-files", "-s", scriptPath], { encoding: "utf8" })
        .trim()
        .split(/\s+/)[0];
      if (mode !== FHV_T4A_REQUIRED_EXECUTABLE_GIT_MODE) {
        counters.DIRECT_EXECUTION_NONEXECUTABLE_GIT_MODE += 1;
      }
    } catch {
      counters.DIRECT_EXECUTION_NONEXECUTABLE_GIT_MODE += 1;
    }
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
    !transportBody.includes("buildRemoteFsExistsCommand") ||
    transportBody.includes("`cat ${shellQuote(remotePath)}`") ||
    transportBody.includes("`test -f ${shellQuote(remotePath)}`")
  ) {
    counters.BARE_CRITICAL_TOOL_INVOCATIONS += 1;
  }

  if (
    !existsSync(join(root, "lib/trader/observability/fhv-t4a-binding-spec.ts")) ||
    !bindingSpec.includes("FHV_SYSTEMD_ANALYZE_BIN") ||
    !bindingSpec.includes("resolveFhvT4aOperatorBindingsFromSpec") ||
    !bindingSpec.includes("FHV_ORGANIZATION_ID") ||
    !read(root, "lib/trader/observability/fhv-t4a-binding-parity.ts").includes(
      "assertPacketExportsMatchBindingSpec",
    )
  ) {
    counters.RUN_BINDING_VALIDATION_GAP = 1;
  }

  const closureCli = read(root, "scripts/trader/fhv-t4-closure-cli.ts");
  const verifyRollbackBlock =
    closureCli.match(/case "verify-rollback":[\s\S]*?case "verify-seal"/)?.[0] ?? "";
  if (
    !closureCli.includes("resolveRollbackHostProbe") ||
    verifyRollbackBlock.includes("defaultHostProbe")
  ) {
    counters.STEP32_CLOSURE_ARGV_INVALID = 1;
  }

  const phaseReceipts = read(root, "lib/trader/observability/fhv-t4a-phase-receipts.ts");
  if (
    !phaseReceipts.includes("preauthLedger") ||
    !phaseReceipts.includes("writeFileAtomicExclusive") ||
    !phaseReceipts.includes("observerQualificationPreDigest")
  ) {
    counters.PHASE_RECEIPT_FULL_BINDING_GAP = 1;
  }

  const rollbackScript = read(root, "scripts/ops/fhv-supervisor/rollback-units.sh");
  if (
    rollbackScript.includes('SYSTEMCTL="${SYSTEMCTL:-systemctl}"') ||
    !rollbackScript.includes("--systemctl-bin")
  ) {
    counters.INSTALL_UNITS_ARGV_INVALID += 1;
  }

  if (
    !executorBody.includes("postRollbackHostProbePath") ||
    !executorBody.includes("rollbackArgs")
  ) {
    counters.STEP32_CLOSURE_ARGV_INVALID = 1;
  }

  if (
    !existsSync(join(root, "tests/unit/fhv-t4-binding-parity.test.ts")) ||
    !existsSync(join(root, "tests/unit/fhv-t4-rollback-units-contract.test.ts"))
  ) {
    counters.MISSING_TEST_CASES += 1;
  }

  if (!operatorBody.includes("FHV_SYSTEMD_ANALYZE_BIN") || !operatorBody.includes("test -x")) {
    counters.PREAUTH_UNMEASURED_ZERO_CLAIM += 1;
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

  const qualificationProof = read(
    root,
    "lib/trader/observability/fhv-t4-observer-qualification-proof.ts",
  );
  const atomicWrite = read(root, "lib/trader/backtest/streaming-evidence/atomic-file-write.ts");
  const reconnectBaseline = existsSync(
    join(root, "lib/trader/observability/fhv-t4a-reconnect-baseline.ts"),
  )
    ? read(root, "lib/trader/observability/fhv-t4a-reconnect-baseline.ts")
    : "";
  const ceremonyQual = existsSync(
    join(root, "lib/trader/observability/fhv-t4a-ceremony-qualification.ts"),
  )
    ? read(root, "lib/trader/observability/fhv-t4a-ceremony-qualification.ts")
    : "";
  const preauthLedger = read(root, "lib/trader/observability/fhv-t4a-preauth-ledger.ts");
  const remoteFsOps = existsSync(join(root, "lib/trader/observability/fhv-t4a-remote-fs-ops.ts"))
    ? read(root, "lib/trader/observability/fhv-t4a-remote-fs-ops.ts")
    : "";
  const observerIdentity = read(
    root,
    "lib/trader/observability/fhv-t4-observer-systemd-identity.ts",
  );
  const hermeticSim = read(root, "lib/trader/observability/fhv-t4a-hermetic-simulation.ts");

  if (!qualificationProof.includes("QUALIFICATION_DOUBLE_SERIALIZATION")) {
    counters.QUALIFICATION_DOUBLE_SERIALIZATION = 1;
  }
  if (!qualificationProof.includes("writeFileAtomicExclusive")) {
    counters.QUALIFICATION_OVERWRITE_ALLOWED = 1;
  }
  if (atomicWrite.includes("unlinkSync(finalPath)")) {
    counters.EXCLUSIVE_WRITER_DELETES_EXISTING_TARGET = 1;
  }
  if (!reconnectBaseline.includes("PRE_QUALIFICATION_DIGEST_NOT_REVALIDATED")) {
    counters.PRE_QUALIFICATION_DIGEST_NOT_REVALIDATED = 1;
  }
  if (!reconnectBaseline.includes("OBSERVER_BASELINE_DIGEST_UNUSED")) {
    counters.OBSERVER_BASELINE_DIGEST_UNUSED = 1;
  }
  if (!ceremonyQual.includes("verifyFhvT4CeremonyQualificationProofs")) {
    counters.QUALIFICATION_NOT_SEMANTICALLY_VERIFIED_BY_CEREMONY = 1;
  }
  if (!qualificationProof.includes("POST_RESTART_CAMPAIGN_IDENTITY_NOT_IN_PROOF")) {
    counters.POST_RESTART_CAMPAIGN_IDENTITY_NOT_IN_PROOF = 1;
  }
  if (observerIdentity.includes('execFileSync("bash"')) {
    counters.CONTINUITY_BARE_SHELL_EXECUTION = 1;
  }
  if (transportBody.includes("| awk") || transportBody.includes("| head")) {
    counters.REMOTE_FS_BARE_PIPELINE_TOOL = 1;
  }
  if (!remoteFsOps.includes("locus:") || !remoteFsOps.includes("approvedRoots")) {
    counters.REMOTE_FS_PRIVILEGE_LOCUS_MISSING = 1;
  }
  if (!preauthLedger.includes("bootstrapRepositoryPath") || !preauthLedger.includes("exitStatus")) {
    counters.PREAUTH_LEDGER_BOOTSTRAP_BINDING_MISSING = 1;
  }
  if (!preauthLedger.includes("stdoutDigest") || !preauthLedger.includes("stderrDigest")) {
    counters.PREAUTH_LEDGER_EXIT_STATUS_MISSING = 1;
  }
  if (!preauthLedger.includes("auditPreauthBootstrapBody")) {
    counters.PREAUTH_STDIN_BODY_UNAUDITED = 1;
  }
  if (
    !operatorBody.includes("parseFhvT4HostPreflightV2") ||
    !phaseReceipts.includes("hostMonotonicSample")
  ) {
    counters.PREFLIGHT_FACTS_DROPPED = 1;
  }
  if (
    !operatorBody.includes("evidenceSealRootDigest") ||
    !phaseReceipts.includes("evidenceSealRootDigest")
  ) {
    counters.FINAL_RECEIPT_SEAL_ROOT_MISSING = 1;
  }
  if (
    hermeticSim.includes("T4A_RESULT=PASS") &&
    !hermeticSim.includes("HERMETIC_STRICT_CLOSURE_PACKAGE_SCRIPTS")
  ) {
    counters.HERMETIC_CANNED_CLOSURE_SUCCESS = 1;
  }
  if (
    !bindingSpec.includes("FHV_T4A_BINDING_SPEC") ||
    !operatorBody.includes("resolveFhvT4aOperatorBindingsFromSpec")
  ) {
    counters.BINDING_PARITY_MANUAL_DUPLICATION = 1;
  }

  if (
    atomicWrite.includes("renameSync(tempPath, finalPath)") &&
    !atomicWrite.includes("publishAtomicExclusiveTemp")
  ) {
    counters.ATOMIC_RENAME_CAN_OVERWRITE_TARGET = 1;
  }
  const raceTest = join(root, "tests/unit/fhv-t4-atomic-exclusive-race.test.ts");
  const raceWorker = join(root, "tests/helpers/fhv-t4-atomic-race-worker.ts");
  if (
    !existsSync(raceTest) ||
    !existsSync(raceWorker) ||
    !readFileSync(raceTest, "utf8").includes("fork(") ||
    !readFileSync(raceTest, "utf8").includes("publishAtomicExclusiveTemp")
  ) {
    counters.ATOMIC_CONCURRENCY_TEST_NOT_CONCURRENT = 1;
  }
  if (
    !reconnectBaseline.includes("parseFhvT4ContinuitySnapshot") ||
    !existsSync(join(root, "tests/unit/fhv-t4-reconnect-baseline.test.ts"))
  ) {
    counters.RECONNECT_CONTINUITY_NOT_STRICTLY_PARSED = 1;
  }
  if (
    !remoteFsOps.includes("applyRemoteFsPrivilegeLocus") ||
    !remoteFsOps.includes('case "SERVICE_USER"')
  ) {
    counters.REMOTE_FS_PRIVILEGE_LOCUS_IGNORED = 1;
  }
  if (!remoteFsOps.includes("cap + 1") || !remoteFsOps.includes("len(data) > cap")) {
    counters.REMOTE_FS_UNBOUNDED_READ = 1;
  }
  if (
    !remoteFsOps.includes("PARENT_SYMLINK_ESCAPE") ||
    !existsSync(join(root, "tests/unit/fhv-t4-remote-fs-ops.test.ts"))
  ) {
    counters.REMOTE_FS_PARENT_SYMLINK_ESCAPE = 1;
  }
  if (
    !phaseReceipts.includes("FINAL_RECEIPT_VERIFY_SEAL_CLASSIFICATION_EMPTY") ||
    !operatorBody.includes("verifySealClassification") ||
    !existsSync(join(root, "tests/unit/fhv-t4-seal-receipt-parsing.test.ts"))
  ) {
    counters.FINAL_RECEIPT_VERIFY_SEAL_CLASSIFICATION_EMPTY = 1;
  }
  if (
    !phaseReceipts.includes("FINAL_RECEIPT_SEAL_MANIFEST_DIGEST_EMPTY") ||
    !operatorBody.includes("evidenceSealManifestDigest")
  ) {
    counters.FINAL_RECEIPT_SEAL_MANIFEST_DIGEST_EMPTY = 1;
  }
  const hostPreflightTs = existsSync(
    join(root, "lib/trader/observability/fhv-t4-host-preflight.ts"),
  )
    ? read(root, "lib/trader/observability/fhv-t4-host-preflight.ts")
    : "";
  if (
    !hostPreflightTs.includes("systemctlBin: string") ||
    !preflight.includes("--systemctl-bin") ||
    !existsSync(join(root, "tests/unit/fhv-t4-host-preflight-v2.test.ts"))
  ) {
    counters.PREFLIGHT_SYSTEMCTL_FACT_SYNTHETIC = 1;
  }
  if (
    !hostPreflightTs.includes("systemdAnalyzeBin: string") ||
    !preflight.includes("--systemd-analyze-bin")
  ) {
    counters.PREFLIGHT_SYSTEMD_ANALYZE_FACT_SYNTHETIC = 1;
  }
  if (!hostPreflightTs.includes("hostBootId: string") || !preflight.includes("hostBootId")) {
    counters.PREFLIGHT_HOST_BOOT_ID_DROPPED = 1;
  }
  if (
    operatorBody.includes('expectedEffectiveUid: locus === "SERVICE_USER" ? 1000') ||
    !operatorBody.includes("resolveExpectedEffectiveUid")
  ) {
    counters.STEP_TRACE_SERVICE_UID_HARDCODED = 1;
  }
  const qualificationIdentity = existsSync(
    join(root, "lib/trader/observability/fhv-t4a-qualification-identity.ts"),
  )
    ? read(root, "lib/trader/observability/fhv-t4a-qualification-identity.ts")
    : "";
  if (
    !qualificationIdentity.includes("QUALIFICATION_SECOND_CAPTURE_NOT_ACTIVE") ||
    !existsSync(join(root, "tests/unit/fhv-t4-qualification-identity.test.ts"))
  ) {
    counters.QUALIFICATION_SECOND_CAPTURE_NOT_ACTIVE = 1;
  }
  if (!qualificationIdentity.includes("QUALIFICATION_ACTIVE_ENTER_TIMESTAMP_DRIFT")) {
    counters.QUALIFICATION_ACTIVE_ENTER_TIMESTAMP_DRIFT = 1;
  }
  if (
    !qualificationIdentity.includes("QUALIFICATION_IDENTITY_NOT_CANONICALLY_PARSED") ||
    !read(root, "lib/trader/observability/fhv-t4a-observer-qualification.ts").includes(
      "parseFhvT4aQualificationObserverIdentity",
    )
  ) {
    counters.QUALIFICATION_IDENTITY_NOT_CANONICALLY_PARSED = 1;
  }
  if (!qualificationIdentity.includes("QUALIFICATION_BOOT_ID_INTERNAL_MISMATCH")) {
    counters.QUALIFICATION_BOOT_ID_INTERNAL_MISMATCH = 1;
  }
  if (
    !phaseReceipts.includes("continuityVerificationProofPath") ||
    !operatorBody.includes("continuityVerificationProofDigest") ||
    !existsSync(join(root, "tests/unit/fhv-t4-continuity-final-receipt.test.ts"))
  ) {
    counters.FINAL_RECEIPT_CONTINUITY_VERIFICATION_PROOF_MISSING = 1;
  }
  if (
    !phaseReceipts.includes("continuityVerificationProofDigest") ||
    !executorBody.includes("continuityVerificationProofDigest")
  ) {
    counters.FINAL_RECEIPT_CONTINUITY_VERIFICATION_DIGEST_MISSING = 1;
  }
  if (
    !operatorBody.includes("CONTINUITY_VERIFICATION_PROOF_NOT_REVALIDATED") ||
    !executorBody.includes("CONTINUITY_VERIFICATION_PROOF_NOT_REVALIDATED")
  ) {
    counters.CONTINUITY_VERIFICATION_PROOF_NOT_REVALIDATED = 1;
  }

  if (
    !qualificationProof.includes("unitName: string") ||
    !qualificationProof.includes("bootId: string") ||
    !qualificationProof.includes("QUALIFICATION_CAPTURE_BOOT_ID_NOT_PERSISTED") ||
    !qualificationProof.includes("QUALIFICATION_CAPTURE_UNIT_NAME_NOT_PERSISTED")
  ) {
    counters.QUALIFICATION_CAPTURE_BOOT_ID_NOT_PERSISTED = 1;
    counters.QUALIFICATION_CAPTURE_UNIT_NAME_NOT_PERSISTED = 1;
  }
  if (
    !qualificationProof.includes("QUALIFICATION_CAPTURE_BOOT_ID_MISMATCH") ||
    !qualificationProof.includes("QUALIFICATION_CAPTURE_UNIT_MISMATCH") ||
    !qualificationIdentity.includes("QUALIFICATION_CAPTURE_BOOT_ID_MISMATCH") ||
    !qualificationIdentity.includes("QUALIFICATION_CAPTURE_UNIT_MISMATCH")
  ) {
    counters.QUALIFICATION_CAPTURE_BOOT_ID_MISMATCH_ALLOWED = 1;
    counters.QUALIFICATION_CAPTURE_UNIT_MISMATCH_ALLOWED = 1;
  }

  const ceremonyResults = existsSync(
    join(root, "lib/trader/observability/fhv-t4a-ceremony-results.ts"),
  )
    ? read(root, "lib/trader/observability/fhv-t4a-ceremony-results.ts")
    : "";
  if (
    !ceremonyResults.includes("CEREMONY_EXACT_VALUE_NOT_ENFORCED") ||
    !ceremonyResults.includes("CEREMONY_REQUIRED_FIELD_MISSING") ||
    !executorBody.includes("validateFhvT4aCeremonyStdout") ||
    !phaseReceipts.includes("extractFhvT4aCeremonyClassificationsFromReceipt") ||
    !existsSync(join(root, "tests/unit/fhv-t4-ceremony-results.test.ts"))
  ) {
    counters.CEREMONY_EXACT_VALUE_NOT_ENFORCED = 1;
    counters.CEREMONY_REQUIRED_FIELD_MISSING = 1;
  }

  if (
    !packet.includes("PR #431") ||
    !packet.includes("main → dev") ||
    !packet.includes("tag-peel") ||
    !packet.includes("PR head") ||
    !packet.includes("feature branch") ||
    !packet.includes("synthetic merge ref") ||
    !packet.includes("untagged `dev`")
  ) {
    counters.PACKET_RELEASE_PREREQUISITES_MISSING = 1;
  }
  if (
    !packet.includes("globally unique `FHV_RUN_ID`") ||
    !packet.includes("FHV_T4A_LOCAL_STATE_DIR") ||
    !packet.includes("no reuse of remote run directory")
  ) {
    counters.PACKET_FRESH_RUN_NAMESPACE_MISSING = 1;
  }
  if (
    !packet.includes("no rerunning a completed phase") ||
    !packet.includes("immediate STOP") ||
    !packet.includes("no improvised cleanup or retry")
  ) {
    counters.PACKET_RETRY_PROHIBITION_MISSING = 1;
  }
  if (
    !packet.includes("unset FHV_T4A_AUTHORIZATION") ||
    !executableBody.includes("unset FHV_T4A_AUTHORIZATION")
  ) {
    counters.PACKET_PREAUTH_AUTHORIZATION_NOT_UNSET = 1;
  }
  for (const [key, value] of Object.entries(FHV_T4A_CEREMONY_REQUIRED_RESULTS)) {
    if (!packet.includes(`${key}=${value}`)) {
      counters.PACKET_COMPLETE_CEREMONY_MATRIX_MISSING = 1;
      break;
    }
  }
  for (const forbidden of FHV_T4A_CEREMONY_FORBIDDEN_KEYS) {
    const activeLines = packet
      .split("\n")
      .filter((line) => !/do\s+\*\*not\*\* use/i.test(line))
      .filter((line) => !line.includes("aggregate PASS aliases"));
    if (activeLines.some((line) => line.includes(`${forbidden}=`))) {
      counters.PACKET_COMPLETE_CEREMONY_MATRIX_MISSING = 1;
      break;
    }
  }
  if (
    !packet.includes("AWAITING_HUMAN_DISCONNECT_RECONNECT") ||
    !packet.includes("FHV_T4A_POST_RECONNECT_FINALIZE_OK") ||
    !packet.includes("no rerunning") ||
    !packet.includes("verify-local-release") ||
    !packet.includes("pre-auth") ||
    !packet.includes("post-auth-before-disconnect")
  ) {
    counters.PACKET_RECONNECT_BINDING_RESTORE_MISSING = 1;
  }
  if (
    !packet.includes("workstation trace") ||
    !packet.includes("phase receipts") ||
    !packet.includes("observer qualification proofs") ||
    !packet.includes("seal manifest") ||
    !packet.includes("continuity snapshots")
  ) {
    counters.PACKET_EVIDENCE_PRESERVATION_MISSING = 1;
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
