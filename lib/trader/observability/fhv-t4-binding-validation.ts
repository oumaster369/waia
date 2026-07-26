/**
 * DEE-436 — shared T4A operator binding format + systemd sandbox path validation.
 */

const TARGET_SHA_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ORG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FhvT4aBindingValidationInput = Readonly<{
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  checkoutParent: string;
  artifactRoot: string;
  repoRoot: string;
  runDir: string;
  sealDestination: string;
}>;

export class FhvT4aBindingValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FhvT4aBindingValidationError";
    this.code = code;
  }
}

function assertAbsoluteSafePath(label: string, value: string): void {
  if (!value.startsWith("/")) {
    throw new FhvT4aBindingValidationError(
      "FHV_T4A_BINDING_PATH_INVALID",
      `${label} must be absolute`,
    );
  }
  if (value.includes("..") || /[\0-\x1f\x7f]/.test(value)) {
    throw new FhvT4aBindingValidationError(
      "FHV_T4A_BINDING_PATH_INVALID",
      `${label} must not contain .. or control characters`,
    );
  }
}

function assertProtectHomeCompatible(label: string, value: string): void {
  if (value.startsWith("/home/")) {
    throw new FhvT4aBindingValidationError(
      "FHV_T4A_SYSTEMD_SANDBOX_PATH_INCOMPATIBLE",
      `${label} under /home is incompatible with ProtectHome=true rendered units`,
    );
  }
}

function assertNonOverlapping(a: string, b: string, labelA: string, labelB: string): void {
  const normA = a.endsWith("/") ? a : `${a}/`;
  const normB = b.endsWith("/") ? b : `${b}/`;
  if (normA.startsWith(normB) || normB.startsWith(normA)) {
    throw new FhvT4aBindingValidationError(
      "FHV_T4A_BINDING_PATH_OVERLAP",
      `${labelA} and ${labelB} must not overlap`,
    );
  }
}

export function validateFhvT4aOperatorBindings(input: FhvT4aBindingValidationInput): void {
  const targetSha = input.targetSha.trim().toLowerCase();
  if (!TARGET_SHA_RE.test(targetSha)) {
    throw new FhvT4aBindingValidationError(
      "FHV_T4A_BINDING_TARGET_SHA_INVALID",
      "target SHA must be lowercase 40-char hex",
    );
  }
  if (!input.releaseTag.trim()) {
    throw new FhvT4aBindingValidationError(
      "FHV_T4A_BINDING_RELEASE_TAG_INVALID",
      "release tag is required",
    );
  }
  if (!RUN_ID_RE.test(input.runId.trim())) {
    throw new FhvT4aBindingValidationError(
      "FHV_T4A_BINDING_RUN_ID_INVALID",
      "run ID format invalid",
    );
  }
  if (!ORG_ID_RE.test(input.organizationId.trim())) {
    throw new FhvT4aBindingValidationError(
      "FHV_T4A_BINDING_ORG_ID_INVALID",
      "organization ID must be UUID v4",
    );
  }

  for (const [label, value] of [
    ["checkout-parent", input.checkoutParent],
    ["artifact-root", input.artifactRoot],
    ["repo-root", input.repoRoot],
    ["run-dir", input.runDir],
    ["seal-destination", input.sealDestination],
  ] as const) {
    assertAbsoluteSafePath(label, value);
    assertProtectHomeCompatible(label, value);
  }

  assertNonOverlapping(input.repoRoot, input.runDir, "repo-root", "run-dir");
  assertNonOverlapping(input.repoRoot, input.sealDestination, "repo-root", "seal-destination");
  assertNonOverlapping(input.runDir, input.sealDestination, "run-dir", "seal-destination");
}

export function fhvT4aBindingValidationMarkers(): readonly string[] {
  return [
    "validateFhvT4aOperatorBindings",
    "FHV_T4A_SYSTEMD_SANDBOX_PATH_INCOMPATIBLE",
    "ProtectHome=true",
  ] as const;
}
