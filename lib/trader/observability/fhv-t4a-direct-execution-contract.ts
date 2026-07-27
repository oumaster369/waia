/**
 * DEE-436 — T4A shell scripts invoked directly as executable paths (not SSH stdin).
 *
 * Git mode 100755 is required for every entry here. SSH-stdin bootstrap scripts
 * are listed separately and must NOT be required executable.
 */

export type FhvT4aDirectExecutionInvocation = Readonly<{
  path: string;
  steps: readonly number[];
  invocation: "direct-path";
  requiresPythonBin?: boolean;
}>;

/** Scripts streamed via `bash -s` from `git show` — executable bit not required. */
export const FHV_T4A_SSH_STDIN_SCRIPT_PATHS = [
  "scripts/ops/fhv-validate-origin-url.sh",
  "scripts/ops/fhv-service-user-checkout.sh",
  "scripts/ops/fhv-service-user-install-deps.sh",
  "scripts/ops/fhv-t4-host-preflight.sh",
  "scripts/ops/fhv-t4-supervisor-residual-state-read.sh",
] as const;

export const FHV_T4A_DIRECT_EXECUTION_SCRIPTS: readonly FhvT4aDirectExecutionInvocation[] = [
  {
    path: "scripts/ops/fhv-release-checkout-identity.sh",
    steps: [4],
    invocation: "direct-path",
    requiresPythonBin: true,
  },
  {
    path: "scripts/ops/fhv-supervisor/render-units.sh",
    steps: [8],
    invocation: "direct-path",
  },
  {
    path: "scripts/ops/fhv-supervisor/install-units.sh",
    steps: [9, 10],
    invocation: "direct-path",
  },
  {
    path: "scripts/ops/fhv-t4-rendered-unit-digests.sh",
    steps: [11],
    invocation: "direct-path",
    requiresPythonBin: true,
  },
  {
    path: "scripts/ops/fhv-systemd-record-deploy.sh",
    steps: [11],
    invocation: "direct-path",
  },
  {
    path: "scripts/ops/fhv-t4-host-probe.sh",
    steps: [12, 32],
    invocation: "direct-path",
    requiresPythonBin: true,
  },
  {
    path: "scripts/ops/fhv-t4-service-user-exec.sh",
    steps: [6, 7, 12, 13, 16, 17, 19, 20, 21, 22, 23, 26, 30, 31, 32],
    invocation: "direct-path",
  },
  {
    path: "scripts/ops/fhv-t4-resume-campaign-root.sh",
    steps: [21],
    invocation: "direct-path",
  },
  {
    path: "scripts/ops/fhv-t4-campaign-wait-completed.sh",
    steps: [24],
    invocation: "direct-path",
    requiresPythonBin: true,
  },
  {
    path: "scripts/ops/fhv-t4-campaign-systemd-identity-read.sh",
    steps: [25, 29],
    invocation: "direct-path",
    requiresPythonBin: true,
  },
  {
    path: "scripts/ops/fhv-t4-observer-systemd-identity-read.sh",
    steps: [15, 29],
    invocation: "direct-path",
    requiresPythonBin: true,
  },
  {
    path: "scripts/ops/fhv-t4-observer-wait-active.sh",
    steps: [15, 29],
    invocation: "direct-path",
    requiresPythonBin: true,
  },
  {
    path: "scripts/ops/fhv-supervisor/rollback-units.sh",
    steps: [32],
    invocation: "direct-path",
  },
] as const;

export const FHV_T4A_REQUIRED_EXECUTABLE_GIT_MODE = "100755" as const;

export function fhvT4aDirectExecutionScriptPaths(): readonly string[] {
  return [...new Set(FHV_T4A_DIRECT_EXECUTION_SCRIPTS.map((entry) => entry.path))];
}
