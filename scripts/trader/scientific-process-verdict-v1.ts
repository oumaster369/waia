/** Local diagnostics only. This module neither verifies receipts nor grants authority. */
export type ScientificProcessIdentityV1 = Readonly<{
  organizationId: string;
  runId: string;
  releaseSha: string;
  attemptId: string;
  containerId: string;
  /** Normalized UTC ISO timestamp; binds a particular invocation, not just a container. */
  containerStartedAt: string;
}>;

type Observation = Readonly<{
  identity: ScientificProcessIdentityV1;
  observedAt: string;
}>;

export type ScientificContainerSnapshotV1 = Observation & Readonly<{
  state: "running" | "exited" | "dead" | "created" | "paused" | "restarting";
  exitCode: number | null;
  finishedAt: string | null;
  oomKilled: boolean;
  signal: number | null;
}>;

export type ScientificWrapperSnapshotV1 = Observation & Readonly<{ exitCode: number }>;
export type ScientificPreparationSnapshotV1 = Observation & Readonly<{
  phase: "STARTED" | "PROGRESS" | "FAILED" | "PROPOSAL_AVAILABLE";
}>;

/** VERIFIED must come from independent, canonical receipt validation by the caller.
 * A CLI success line, journal event or zero exit code is not such validation.
 * identity binds that validation to this exact attempt; observedAt is its read time.
 */
export type ScientificEvidenceSnapshotV1 = Observation & (
  Readonly<{ status: "VERIFIED"; proposalContentDigestHex: string }> |
  Readonly<{ status: "ABSENT" | "INVALID" }>
);

export type ScientificProcessVerdictInputV1 = Readonly<{
  expectedIdentity: ScientificProcessIdentityV1;
  now: string;
  maxObservationAgeMs: number;
  container: ScientificContainerSnapshotV1 | null;
  evidence: ScientificEvidenceSnapshotV1 | null;
  wrapper?: ScientificWrapperSnapshotV1 | null;
  preparation?: ScientificPreparationSnapshotV1 | null;
}>;

type ProcessOutcome = "UNKNOWN" | "RUNNING" | "EXITED_ZERO" | "FAILED";
type EvidenceOutcome = "UNKNOWN" | "ABSENT" | "INVALID" | "VERIFIED";
type PreparationOutcome = ScientificPreparationSnapshotV1["phase"] | "UNKNOWN";
type Issue = "INVALID_EXPECTATION" | "CONTAINER_MISSING" | "CONTAINER_INVALID" |
  "CONTAINER_NOT_TERMINAL" | "WRAPPER_INVALID" | "WRAPPER_CONTAINER_CONFLICT" |
  "PREPARATION_INVALID" | "PREPARATION_FAILED" | "PREPARATION_EVIDENCE_CONFLICT" |
  "EVIDENCE_MISSING" | "EVIDENCE_INVALID" | "EVIDENCE_ABSENT" | "PROCESS_FAILED";

export type ScientificProcessVerdictV1 = Readonly<{
  schemaVersion: "waia.trader.scientific_process_verdict.v1";
  verdict: "UNKNOWN" | "IN_PROGRESS" | "FAILED" | "TECHNICAL_RESULT_OBSERVED";
  process: ProcessOutcome;
  wrapperExitCode: number | null;
  preparation: PreparationOutcome;
  evidence: EvidenceOutcome;
  proposalContentDigestHex: string | null;
  issues: readonly Issue[];
  authorityGranted: false;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const identityKeys = ["organizationId", "runId", "releaseSha", "attemptId",
  "containerId", "containerStartedAt"] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Require normalized timestamps so invalid calendar dates cannot silently roll over. */
function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function validIdentity(value: unknown): value is ScientificProcessIdentityV1 {
  return record(value) && typeof value.organizationId === "string" && UUID.test(value.organizationId) &&
    typeof value.runId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.runId) &&
    typeof value.releaseSha === "string" && /^[0-9a-f]{40}$/.test(value.releaseSha) &&
    typeof value.attemptId === "string" && UUID.test(value.attemptId) &&
    typeof value.containerId === "string" && SHA256.test(value.containerId) &&
    timestamp(value.containerStartedAt) !== null;
}

function exitCode(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 255;
}

export function reconcileScientificProcessVerdictV1(
  input: ScientificProcessVerdictInputV1,
): ScientificProcessVerdictV1 {
  const issues: Issue[] = [];
  let process: ProcessOutcome = "UNKNOWN";
  let preparation: PreparationOutcome = "UNKNOWN";
  let evidence: EvidenceOutcome = "UNKNOWN";
  let wrapperExitCode: number | null = null;
  let proposalContentDigestHex: string | null = null;
  const finish = (verdict: ScientificProcessVerdictV1["verdict"]): ScientificProcessVerdictV1 =>
    Object.freeze({ schemaVersion: "waia.trader.scientific_process_verdict.v1", verdict,
      process, wrapperExitCode, preparation, evidence, proposalContentDigestHex,
      issues: Object.freeze([...issues]), authorityGranted: false });

  const now = record(input) ? timestamp(input.now) : null;
  if (!record(input) || now === null || !validIdentity(input.expectedIdentity) ||
      !Number.isSafeInteger(input.maxObservationAgeMs) || input.maxObservationAgeMs < 0 ||
      timestamp(input.expectedIdentity.containerStartedAt)! > now) {
    issues.push("INVALID_EXPECTATION");
    return finish("UNKNOWN");
  }
  const started = timestamp(input.expectedIdentity.containerStartedAt)!;
  const scoped = (value: unknown): value is Observation => {
    if (!record(value) || !validIdentity(value.identity)) return false;
    const identity = value.identity;
    if (!identityKeys.every(key => identity[key] === input.expectedIdentity[key])) return false;
    const observed = timestamp(value.observedAt);
    return observed !== null && observed >= started && observed <= now &&
      now - observed <= input.maxObservationAgeMs;
  };

  const container = input.container;
  if (container == null) {
    issues.push("CONTAINER_MISSING");
  } else {
    const terminal = container.state === "exited" || container.state === "dead";
    const finished = timestamp(container.finishedAt);
    const valid = scoped(container) &&
      ["running", "exited", "dead", "created", "paused", "restarting"].includes(container.state) &&
      (container.exitCode === null || exitCode(container.exitCode)) &&
      typeof container.oomKilled === "boolean" &&
      (container.signal === null || (Number.isSafeInteger(container.signal) && container.signal >= 1 && container.signal <= 64)) &&
      (terminal ? exitCode(container.exitCode) && finished !== null && finished >= started &&
        finished <= timestamp(container.observedAt)! : container.finishedAt === null &&
        !container.oomKilled && container.signal === null && (container.exitCode === null || container.exitCode === 0));
    if (!valid) issues.push("CONTAINER_INVALID");
    else if (terminal) {
      process = container.exitCode !== 0 || container.oomKilled || container.signal !== null ||
        container.state === "dead" ? "FAILED" : "EXITED_ZERO";
      if (process === "FAILED") issues.push("PROCESS_FAILED");
    } else {
      process = container.state === "running" ? "RUNNING" : "UNKNOWN";
      issues.push("CONTAINER_NOT_TERMINAL");
    }
  }

  if (input.wrapper != null) {
    if (!scoped(input.wrapper) || !exitCode(input.wrapper.exitCode)) issues.push("WRAPPER_INVALID");
    else {
      wrapperExitCode = input.wrapper.exitCode;
      if (process === "RUNNING" || (process !== "UNKNOWN" &&
          (wrapperExitCode !== container!.exitCode ||
            timestamp(input.wrapper.observedAt)! < timestamp(container!.finishedAt)!))) {
        issues.push("WRAPPER_CONTAINER_CONFLICT");
      }
    }
  }

  if (input.preparation != null) {
    if (!scoped(input.preparation) ||
        !["STARTED", "PROGRESS", "FAILED", "PROPOSAL_AVAILABLE"].includes(input.preparation.phase)) {
      issues.push("PREPARATION_INVALID");
    } else {
      preparation = input.preparation.phase;
      if (preparation === "FAILED") issues.push("PREPARATION_FAILED");
    }
  }

  if (input.evidence == null) issues.push("EVIDENCE_MISSING");
  else if (!scoped(input.evidence) ||
      !["VERIFIED", "ABSENT", "INVALID"].includes(input.evidence.status) ||
      (input.evidence.status === "VERIFIED" && (typeof input.evidence.proposalContentDigestHex !== "string" ||
        !SHA256.test(input.evidence.proposalContentDigestHex)))) {
    evidence = "INVALID";
    issues.push("EVIDENCE_INVALID");
  } else {
    evidence = input.evidence.status;
    if (input.evidence.status === "VERIFIED") proposalContentDigestHex = input.evidence.proposalContentDigestHex;
    else issues.push(input.evidence.status === "ABSENT" ? "EVIDENCE_ABSENT" : "EVIDENCE_INVALID");
  }
  if ((preparation === "FAILED" && evidence === "VERIFIED") ||
      (preparation === "PROPOSAL_AVAILABLE" && evidence === "ABSENT") ||
      ((preparation === "STARTED" || preparation === "PROGRESS") && process === "EXITED_ZERO")) {
    issues.push("PREPARATION_EVIDENCE_CONFLICT");
  }

  if (process === "FAILED" || preparation === "FAILED") return finish("FAILED");
  if (issues.length === 0 && process === "EXITED_ZERO" && evidence === "VERIFIED") {
    return finish("TECHNICAL_RESULT_OBSERVED");
  }
  return finish(process === "RUNNING" ? "IN_PROGRESS" : "UNKNOWN");
}
