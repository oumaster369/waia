/**
 * DEE-436 — canonical T4A operator semantic step contract (32 steps).
 */

import {
  FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE,
  FHV_SYSTEMD_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-systemd-deployed-revision";

export const FHV_T4A_OPERATOR_TRACE_SCHEMA_VERSION = "fhv-t4a-operator-trace/v1" as const;

export const FHV_T4A_LEGACY_CONTAINER_NAME = FHV_SYSTEMD_LEGACY_CONTAINER_NAME;
export const FHV_T4A_LEGACY_CONTAINER_IMAGE = FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE;

export const FHV_T4A_AUTHORIZATION_LITERAL = "AUTHORIZE-FHV-OPS-DEPLOY" as const;

export const FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL =
  "AUTHORIZE-FHV-T4A-RESIDUAL-UNIT-RECOVERY" as const;

export const FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT =
  "AWAITING_HUMAN_DISCONNECT_RECONNECT" as const;

export const FHV_T4A_BOOTSTRAP_SCRIPT_PATHS = [
  "scripts/ops/fhv-validate-origin-url.sh",
  "scripts/ops/fhv-t4-host-preflight.sh",
  "scripts/ops/fhv-service-user-checkout.sh",
  "scripts/ops/fhv-service-user-install-deps.sh",
] as const;

export type FhvT4aOperatorPhase =
  | "verify-local-release"
  | "pre-auth"
  | "residual-recovery-preview"
  | "residual-recovery"
  | "post-auth-before-disconnect"
  | "post-reconnect-finalize";

export type FhvT4aOperatorLocus =
  | "WORKSTATION"
  | "SSH_STDIN"
  | "REMOTE_ROOT"
  | "SERVICE_USER"
  | "NARRATIVE";

export type FhvT4aOperatorMutationClass =
  | "read-only"
  | "remote-read"
  | "remote-mutate"
  | "service-user-mutate";

export type FhvT4aOperatorCommandOwner =
  | { kind: "script"; path: string }
  | { kind: "package"; command: string }
  | { kind: "systemd"; action: string }
  | { kind: "narrative" };

export type FhvT4aOperatorStep = Readonly<{
  step: number;
  name: string;
  phase: FhvT4aOperatorPhase;
  locus: FhvT4aOperatorLocus;
  mutationClass: FhvT4aOperatorMutationClass;
  commandOwner: FhvT4aOperatorCommandOwner;
}>;

export const FHV_T4A_OPERATOR_STEPS: readonly FhvT4aOperatorStep[] = [
  {
    step: 1,
    name: "authorization-confirmed-effective-root",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-read",
    commandOwner: { kind: "script", path: "inline-root-check" },
  },
  {
    step: 2,
    name: "strict-origin-validation-bootstrap",
    phase: "post-auth-before-disconnect",
    locus: "SSH_STDIN",
    mutationClass: "remote-read",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-validate-origin-url.sh" },
  },
  {
    step: 3,
    name: "service-user-fresh-checkout-bootstrap",
    phase: "post-auth-before-disconnect",
    locus: "SSH_STDIN",
    mutationClass: "remote-mutate",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-service-user-checkout.sh" },
  },
  {
    step: 4,
    name: "exact-sha-tag-origin-verification",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-read",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-release-checkout-identity.sh" },
  },
  {
    step: 5,
    name: "frozen-dependency-installation-bootstrap",
    phase: "post-auth-before-disconnect",
    locus: "SSH_STDIN",
    mutationClass: "remote-mutate",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-service-user-install-deps.sh" },
  },
  {
    step: 6,
    name: "manifest-materialization",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:rehearsal" },
  },
  {
    step: 7,
    name: "immutable-checkout-identity-proof",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:record-checkout-identity" },
  },
  {
    step: 8,
    name: "unit-render",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-mutate",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-supervisor/render-units.sh" },
  },
  {
    step: 9,
    name: "install-preview",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-read",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-supervisor/install-units.sh" },
  },
  {
    step: 10,
    name: "install-units",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-mutate",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-supervisor/install-units.sh" },
  },
  {
    step: 11,
    name: "deployment-record",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-mutate",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-systemd-record-deploy.sh" },
  },
  {
    step: 12,
    name: "host-probe-ingest",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:ingest-host-probe" },
  },
  {
    step: 13,
    name: "deployment-proof",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:verify-deployment" },
  },
  {
    step: 14,
    name: "observer-start",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-mutate",
    commandOwner: { kind: "systemd", action: "start waia-fhv-observer.service" },
  },
  {
    step: 15,
    name: "observer-active-wait-qualification",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:status" },
  },
  {
    step: 16,
    name: "signed-pause-pre-arm",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:arm-pause" },
  },
  {
    step: 17,
    name: "pre-arm-verification",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:verify" },
  },
  {
    step: 18,
    name: "campaign-start",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-mutate",
    commandOwner: { kind: "systemd", action: "start waia-fhv-campaign.service" },
  },
  {
    step: 19,
    name: "bounded-wait-pause",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:wait-paused" },
  },
  {
    step: 20,
    name: "paused-proof",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:verify-paused" },
  },
  {
    step: 21,
    name: "signed-resume-and-root-enforcement",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:resume" },
  },
  {
    step: 22,
    name: "bounded-wait-final",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:wait-final" },
  },
  {
    step: 23,
    name: "final-proof",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:verify-final" },
  },
  {
    step: 24,
    name: "campaign-completed-wait",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-read",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-t4-campaign-wait-completed.sh" },
  },
  {
    step: 25,
    name: "completed-campaign-systemd-identity",
    phase: "post-auth-before-disconnect",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-read",
    commandOwner: {
      kind: "script",
      path: "scripts/ops/fhv-t4-campaign-systemd-identity-read.sh",
    },
  },
  {
    step: 26,
    name: "continuity-before",
    phase: "post-auth-before-disconnect",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:capture-continuity-before" },
  },
  {
    step: 27,
    name: "human-disconnect-reconnect-narrative",
    phase: "post-reconnect-finalize",
    locus: "NARRATIVE",
    mutationClass: "read-only",
    commandOwner: { kind: "narrative" },
  },
  {
    step: 28,
    name: "observer-only-restart",
    phase: "post-reconnect-finalize",
    locus: "REMOTE_ROOT",
    mutationClass: "remote-mutate",
    commandOwner: { kind: "systemd", action: "restart waia-fhv-observer.service" },
  },
  {
    step: 29,
    name: "observer-post-restart-qualification",
    phase: "post-reconnect-finalize",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:status" },
  },
  {
    step: 30,
    name: "continuity-after",
    phase: "post-reconnect-finalize",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:capture-continuity-after" },
  },
  {
    step: 31,
    name: "continuity-verification",
    phase: "post-reconnect-finalize",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:verify-continuity" },
  },
  {
    step: 32,
    name: "rollback-seal-ceremony",
    phase: "post-reconnect-finalize",
    locus: "SERVICE_USER",
    mutationClass: "service-user-mutate",
    commandOwner: { kind: "package", command: "trader:fhv:t4:verify-ceremony" },
  },
] as const;

/** Pre-auth steps not counted in the 32-step POST sequence. */
export const FHV_T4A_PRE_AUTH_STEPS: readonly FhvT4aOperatorStep[] = [
  {
    step: 0,
    name: "workstation-local-release-verify",
    phase: "verify-local-release",
    locus: "WORKSTATION",
    mutationClass: "read-only",
    commandOwner: { kind: "script", path: "fhv-t4a-operator:verify-local-release" },
  },
  {
    step: 0,
    name: "pre-auth-origin-validation",
    phase: "pre-auth",
    locus: "SSH_STDIN",
    mutationClass: "remote-read",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-validate-origin-url.sh" },
  },
  {
    step: 0,
    name: "pre-auth-host-preflight",
    phase: "pre-auth",
    locus: "SSH_STDIN",
    mutationClass: "remote-read",
    commandOwner: { kind: "script", path: "scripts/ops/fhv-t4-host-preflight.sh" },
  },
];

export function fhvT4aOperatorStepsForPhase(
  phase: FhvT4aOperatorPhase,
): readonly FhvT4aOperatorStep[] {
  if (phase === "verify-local-release" || phase === "pre-auth") {
    return FHV_T4A_PRE_AUTH_STEPS.filter((step) => step.phase === phase);
  }
  return FHV_T4A_OPERATOR_STEPS.filter((step) => step.phase === phase);
}

export function fhvT4aOperatorStepByNumber(stepNumber: number): FhvT4aOperatorStep | undefined {
  return FHV_T4A_OPERATOR_STEPS.find((step) => step.step === stepNumber);
}

export function fhvT4aOperatorReleaseCheckoutIdentityArgs(): readonly string[] {
  return [
    "--repo-path",
    "${FHV_REPO_ROOT}",
    "--target-sha",
    "${EXECUTION_SERVER_TARGET_SHA}",
    "--release-tag",
    "${FHV_RELEASE_TAG}",
    "--git-bin",
    "${FHV_GIT_BIN}",
    "--python-bin",
    "${FHV_PYTHON_BIN}",
  ];
}
