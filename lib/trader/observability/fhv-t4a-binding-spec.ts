/**
 * DEE-436 — single canonical T4A operator binding specification.
 */

import { join } from "node:path";

import { validateFhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4-binding-validation";

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
  systemdAnalyzeBin: string;
  authorization?: string;
  workstationTracePath: string;
}>;

export type FhvT4aBindingSpecEntry = Readonly<{
  env: string;
  required: boolean;
  packetExport: boolean;
}>;

/** Canonical required operator env bindings — sole source for parity and resolution. */
export const FHV_T4A_BINDING_SPEC: readonly FhvT4aBindingSpecEntry[] = [
  { env: "EXEC_HOST", required: true, packetExport: true },
  { env: "SSH_USER", required: true, packetExport: true },
  { env: "FHV_LOCAL_RELEASE_ROOT", required: true, packetExport: true },
  { env: "FHV_T4A_LOCAL_STATE_DIR", required: true, packetExport: true },
  { env: "FHV_LOCAL_NODE_BIN", required: true, packetExport: true },
  { env: "FHV_LOCAL_GIT_BIN", required: true, packetExport: true },
  { env: "FHV_LOCAL_SSH_BIN", required: true, packetExport: true },
  { env: "EXECUTION_SERVER_TARGET_SHA", required: true, packetExport: true },
  { env: "FHV_RELEASE_TAG", required: true, packetExport: true },
  { env: "FHV_RUN_ID", required: true, packetExport: true },
  { env: "FHV_ORGANIZATION_ID", required: true, packetExport: true },
  { env: "FHV_OPERATOR_ID", required: true, packetExport: true },
  { env: "FHV_SERVICE_USER", required: true, packetExport: true },
  { env: "FHV_ENVIRONMENT_FILE", required: true, packetExport: true },
  { env: "FHV_ARTIFACT_ROOT", required: true, packetExport: true },
  { env: "FHV_CHECKOUT_PARENT", required: true, packetExport: true },
  { env: "FHV_EXPECTED_HOSTNAME", required: true, packetExport: true },
  { env: "FHV_EXPECTED_MACHINE_ID_SHA256", required: true, packetExport: true },
  { env: "FHV_NODE_BIN", required: true, packetExport: true },
  { env: "FHV_COREPACK_BIN", required: true, packetExport: true },
  { env: "FHV_GIT_BIN", required: true, packetExport: true },
  { env: "FHV_PYTHON_BIN", required: true, packetExport: true },
  { env: "FHV_DOCKER_BIN", required: true, packetExport: true },
  { env: "FHV_SYSTEMCTL_BIN", required: true, packetExport: true },
  { env: "FHV_SYSTEMD_ANALYZE_BIN", required: true, packetExport: true },
  { env: "FHV_ORIGIN_URL", required: false, packetExport: true },
  { env: "FHV_T4A_AUTHORIZATION", required: false, packetExport: false },
  { env: "FHV_T4A_WORKSTATION_TRACE_PATH", required: false, packetExport: true },
] as const;

export const FHV_T4A_REQUIRED_BINDING_ENV_NAMES = FHV_T4A_BINDING_SPEC.filter(
  (entry) => entry.required,
).map((entry) => entry.env);

export const FHV_T4A_OPTIONAL_BINDING_ENV_NAMES = FHV_T4A_BINDING_SPEC.filter(
  (entry) => !entry.required,
).map((entry) => entry.env);

export class FhvT4aBindingSpecError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aBindingSpecError";
  }
}

function requireBindingEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new FhvT4aBindingSpecError("FHV_T4A_BINDING_MISSING", `Missing required env: ${name}`);
  }
  return value;
}

export function resolveFhvT4aOperatorBindingsFromSpec(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aOperatorBindings {
  const localStateDir = requireBindingEnv("FHV_T4A_LOCAL_STATE_DIR", env);
  const bindings: FhvT4aOperatorBindings = {
    execHost: requireBindingEnv("EXEC_HOST", env),
    sshUser: requireBindingEnv("SSH_USER", env),
    localReleaseRoot: requireBindingEnv("FHV_LOCAL_RELEASE_ROOT", env),
    localStateDir,
    localNodeBin: requireBindingEnv("FHV_LOCAL_NODE_BIN", env),
    localGitBin: requireBindingEnv("FHV_LOCAL_GIT_BIN", env),
    localSshBin: requireBindingEnv("FHV_LOCAL_SSH_BIN", env),
    targetSha: requireBindingEnv("EXECUTION_SERVER_TARGET_SHA", env).toLowerCase(),
    releaseTag: requireBindingEnv("FHV_RELEASE_TAG", env),
    originUrl: env.FHV_ORIGIN_URL?.trim() || "https://github.com/oumaster369/waia.git",
    runId: requireBindingEnv("FHV_RUN_ID", env),
    organizationId: requireBindingEnv("FHV_ORGANIZATION_ID", env),
    operatorId: requireBindingEnv("FHV_OPERATOR_ID", env),
    serviceUser: requireBindingEnv("FHV_SERVICE_USER", env),
    environmentFile: requireBindingEnv("FHV_ENVIRONMENT_FILE", env),
    artifactRoot: requireBindingEnv("FHV_ARTIFACT_ROOT", env),
    checkoutParent: requireBindingEnv("FHV_CHECKOUT_PARENT", env),
    expectedHostname: requireBindingEnv("FHV_EXPECTED_HOSTNAME", env),
    expectedMachineIdSha256: requireBindingEnv("FHV_EXPECTED_MACHINE_ID_SHA256", env),
    nodeBin: requireBindingEnv("FHV_NODE_BIN", env),
    corepackBin: requireBindingEnv("FHV_COREPACK_BIN", env),
    gitBin: requireBindingEnv("FHV_GIT_BIN", env),
    pythonBin: requireBindingEnv("FHV_PYTHON_BIN", env),
    dockerBin: requireBindingEnv("FHV_DOCKER_BIN", env),
    systemctlBin: requireBindingEnv("FHV_SYSTEMCTL_BIN", env),
    systemdAnalyzeBin: requireBindingEnv("FHV_SYSTEMD_ANALYZE_BIN", env),
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

/** Parse `export NAME=` declarations from packet body. */
export function parsePacketBindingExports(packetBody: string): Set<string> {
  const exports = new Set<string>();
  for (const match of packetBody.matchAll(/^export ([A-Z0-9_]+)=/gm)) {
    exports.add(match[1]!);
  }
  return exports;
}

export function assertPacketExportsMatchBindingSpec(packetBody: string): void {
  const exports = parsePacketBindingExports(packetBody);
  for (const entry of FHV_T4A_BINDING_SPEC) {
    if (entry.packetExport && !exports.has(entry.env)) {
      throw new FhvT4aBindingSpecError(
        "FHV_T4A_BINDING_PARITY_GAP",
        `Packet missing export for binding: ${entry.env}`,
      );
    }
  }
  if (!packetBody.includes("FHV_POST_ROLLBACK_HOST_PROBE_PATH")) {
    throw new FhvT4aBindingSpecError(
      "FHV_T4A_BINDING_PARITY_GAP",
      "Packet missing FHV_POST_ROLLBACK_HOST_PROBE_PATH export.",
    );
  }
}
