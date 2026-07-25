/**
 * DEE-436 — executable T4A packet ↔ canonical operator contract validator.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertFhvT4aClosureCountersZero,
  auditFhvT4aClosureCounters,
  formatFhvT4aClosureCounters,
} from "@/lib/trader/observability/fhv-t4a-closure-counter-audit";
import {
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
  FHV_T4A_OPERATOR_STEPS,
  fhvT4aOperatorReleaseCheckoutIdentityArgs,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";

const ROOT = process.cwd();
const PACKET = join(ROOT, "docs/ops/T4_OPERATOR_PACKET_V5.md");

function fail(message: string): never {
  console.error(`validate-fhv-t4a-packet: ${message}`);
  process.exit(1);
}

function main(): void {
  const body = readFileSync(PACKET, "utf8");
  const nonExecutableStart = body.indexOf("## NON_EXECUTABLE");
  const executableBody = nonExecutableStart === -1 ? body : body.slice(0, nonExecutableStart);

  if (!executableBody.includes("scripts/ops/fhv-t4a-operator.sh")) {
    fail("packet must invoke scripts/ops/fhv-t4a-operator.sh phases");
  }

  for (const phase of [
    "verify-local-release",
    "pre-auth",
    "post-auth-before-disconnect",
    "post-reconnect-finalize",
  ]) {
    if (!executableBody.includes("fhv-t4a-operator.sh") || !executableBody.includes(phase)) {
      fail(`packet missing fhv-t4a-operator.sh ${phase} invocation`);
    }
  }

  const duplicateSsh = executableBody.match(/ssh "\$\{SSH_USER\}@\$\{EXEC_HOST\}"/g);
  if (duplicateSsh && duplicateSsh.length > 0) {
    fail("packet contains duplicate low-level SSH blocks outside NON_EXECUTABLE section");
  }

  if (
    !executableBody.includes(FHV_T4A_LEGACY_CONTAINER_NAME) ||
    !executableBody.includes(FHV_T4A_LEGACY_CONTAINER_IMAGE)
  ) {
    fail("packet must bind canonical legacy container name/image");
  }

  if (
    !executableBody.includes("FHV_EXPECTED_LEGACY_CONTAINER_NAME") ||
    !executableBody.includes(`"${FHV_T4A_LEGACY_CONTAINER_NAME}"`)
  ) {
    fail("packet must export canonical legacy container name binding");
  }

  const step4Window = executableBody.includes("--git-bin") ? executableBody : body;
  if (!step4Window.includes("--git-bin") || !step4Window.includes("--python-bin")) {
    fail("Step 4 contract requires --git-bin and --python-bin");
  }

  const contractArgs = fhvT4aOperatorReleaseCheckoutIdentityArgs();
  if (!contractArgs.includes("--git-bin") || !contractArgs.includes("--python-bin")) {
    fail("contract Step 4 args missing git-bin/python-bin");
  }

  if (FHV_T4A_OPERATOR_STEPS.length !== 32) {
    fail(`contract must define exactly 32 steps, got ${FHV_T4A_OPERATOR_STEPS.length}`);
  }

  const stdinBootstrapScripts = [
    "scripts/ops/fhv-t4-host-preflight.sh",
    "scripts/ops/fhv-service-user-checkout.sh",
    "scripts/ops/fhv-service-user-install-deps.sh",
  ] as const;
  for (const scriptPath of stdinBootstrapScripts) {
    const abs = join(ROOT, scriptPath);
    if (!readFileSync(abs, "utf8").includes("fhv_t4_require_effective_root")) {
      fail(`bootstrap script must inline privilege helpers: ${scriptPath}`);
    }
    if (readFileSync(abs, "utf8").includes("_fhv-t4-privilege-common.sh")) {
      fail(`bootstrap script must not source sibling privilege file: ${scriptPath}`);
    }
  }

  const serviceExec = readFileSync(join(ROOT, "scripts/ops/fhv-t4-service-user-exec.sh"), "utf8");
  if (!serviceExec.includes("--node-bin") || !serviceExec.includes("--corepack-bin")) {
    fail("fhv-t4-service-user-exec.sh must require --node-bin and --corepack-bin");
  }
  if (serviceExec.includes('source "$ENVIRONMENT_FILE"')) {
    fail("fhv-t4-service-user-exec.sh must not shell-source EnvironmentFile");
  }

  const counters = auditFhvT4aClosureCounters({ root: ROOT, preauthRemoteWriteCount: 0 });
  console.log(formatFhvT4aClosureCounters(counters));
  try {
    assertFhvT4aClosureCountersZero(counters);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  console.log("validate-fhv-t4a-packet: OK");
}

main();
