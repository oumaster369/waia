import type { ModelScope } from "./contracts";
import { assertModelJsonData } from "./persistence-contracts";

/** Pure history qualification policy. This module authenticates nobody, performs
 * no rights effect, verifies no provider and grants no consent or disclosure. */
export const TWIN_RIGHTS_OPERATION_POLICY = "human-approved-2026-09-14/v1";

export type RightsOperationType =
  | "WITHDRAW_USE"
  | "DELETE"
  | "ERASE"
  | "EXPORT"
  | "CORRECT"
  | "RETAIN"
  | "ARCHIVE";

export type RightsOperationState =
  | "REQUESTED"
  | "ACCEPTED"
  | "USE_BLOCKED"
  | "LIVE_REMOVAL_IN_PROGRESS"
  | "LIVE_REMOVED"
  | "RESIDUAL_COPIES_PENDING"
  | "CLOSED"
  | "REFUSED"
  | "CANCELLED";

export type RightsOperationEffect = {
  kind:
    | "EXPORT_ARTIFACT_CREATED"
    | "CORRECTIVE_REVISION_COMMITTED"
    | "RETENTION_DECISION_COMMITTED"
    | "ARCHIVE_EFFECT_COMMITTED";
  committedAt: string;
  completionEvidenceDigest: string;
};

export type RightsOperationActor = {
  actorClass: "human";
  subjectId: string;
  actorReference: string;
};

export type RightsOperationStateEvent = {
  sequence: number;
  state: RightsOperationState;
  at: string;
  completionEvidenceDigest: string | null;
};

export type RightsOperationAttempt = {
  attemptId: string;
  sequence: number;
  startedAt: string;
  completedAt: string;
  outcome: "FAILED" | "SUCCEEDED";
  outcomeCode: string;
  completionEvidenceDigest: string | null;
};

export type RightsOperationHistory = {
  operationId: string;
  policyVersion: typeof TWIN_RIGHTS_OPERATION_POLICY;
  scope: ModelScope;
  type: RightsOperationType;
  target: {
    scopeKind: "record" | "source" | "purpose" | "subject";
    digest: string;
  };
  requestedAt: string;
  requestedBy: RightsOperationActor;
  acceptedBy: RightsOperationActor | null;
  history: RightsOperationStateEvent[];
  attempts: RightsOperationAttempt[];
  effect: RightsOperationEffect | null;
};

export type RightsOperationValidationContext = {
  scope: ModelScope;
  now: string;
  /** Trusted previously admitted snapshot; null is valid only for a new REQUESTED record. */
  previous: RightsOperationHistory | null;
  /** Structurally qualified elsewhere. Membership is reference admission, not evidence proof. */
  admittedCompletionEvidenceDigests: string[];
};

export type RightsOperationValidation = {
  operation: RightsOperationHistory;
  recordedState: RightsOperationState;
  productiveUseBlockRecorded: boolean;
  evidenceQualification: "trusted_context_reference_match_only";
  authority: "none";
  receiptRetention:
    | {
        mode: "while_unresolved";
        terminalAt: null;
        retainUntil: null;
        containsPersonalContent: false;
        subjectDeletionOverride: "remove_after_verified_full_cleanup_without_separate_human_approved_basis";
      }
    | {
        mode: "terminal_12_months";
        terminalAt: string;
        retainUntil: string;
        containsPersonalContent: false;
        subjectDeletionOverride: "remove_after_verified_full_cleanup_without_separate_human_approved_basis";
      };
};

const operationTypes = new Set<RightsOperationType>([
  "WITHDRAW_USE",
  "DELETE",
  "ERASE",
  "EXPORT",
  "CORRECT",
  "RETAIN",
  "ARCHIVE",
]);
const operationStates = new Set<RightsOperationState>([
  "REQUESTED",
  "ACCEPTED",
  "USE_BLOCKED",
  "LIVE_REMOVAL_IN_PROGRESS",
  "LIVE_REMOVED",
  "RESIDUAL_COPIES_PENDING",
  "CLOSED",
  "REFUSED",
  "CANCELLED",
]);
const removalPath: RightsOperationState[] = [
  "REQUESTED",
  "ACCEPTED",
  "USE_BLOCKED",
  "LIVE_REMOVAL_IN_PROGRESS",
  "LIVE_REMOVED",
  "RESIDUAL_COPIES_PENDING",
  "CLOSED",
];
const withdrawalPath: RightsOperationState[] = ["REQUESTED", "ACCEPTED", "USE_BLOCKED", "CLOSED"];
const nonRemovalPath: RightsOperationState[] = ["REQUESTED", "ACCEPTED", "CLOSED"];
const requiredStateEvidence = new Set<RightsOperationState>([
  "ACCEPTED",
  "USE_BLOCKED",
  "LIVE_REMOVED",
  "CLOSED",
  "REFUSED",
  "CANCELLED",
]);
const effects: Record<
  Exclude<RightsOperationType, "WITHDRAW_USE" | "DELETE" | "ERASE">,
  RightsOperationEffect["kind"]
> = {
  EXPORT: "EXPORT_ARTIFACT_CREATED",
  CORRECT: "CORRECTIVE_REVISION_COMMITTED",
  RETAIN: "RETENTION_DECISION_COMMITTED",
  ARCHIVE: "ARCHIVE_EFFECT_COMMITTED",
};
const terminalStates = new Set<RightsOperationState>(["CLOSED", "REFUSED", "CANCELLED"]);
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha256 = /^sha256:[0-9a-f]{64}$/;
const subjectDeletionOverride =
  "remove_after_verified_full_cleanup_without_separate_human_approved_basis" as const;

function fail(code = "INVALID_INPUT"): never {
  throw new Error(code);
}

function requireValue(condition: unknown, code = "INVALID_INPUT"): asserts condition {
  if (!condition) fail(code);
}

function keys(
  value: unknown,
  expected: readonly string[],
): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  requireValue(
    Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
  );
}

function canonicalInstant(value: unknown): number {
  requireValue(typeof value === "string");
  const parsed = Date.parse(value);
  requireValue(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, "INVALID_TIME");
  return parsed;
}

function requireIdentifier(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && identifier.test(value), "INVALID_IDENTIFIER");
}

function requireDigest(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && sha256.test(value), "INVALID_DIGEST");
}

function requireAdmittedDigest(value: unknown, admitted: Set<string>): asserts value is string {
  requireDigest(value);
  requireValue(admitted.has(value), "EVIDENCE_NOT_ADMITTED");
}

function sameScope(left: ModelScope, right: ModelScope): boolean {
  return left.organizationId === right.organizationId && left.subjectId === right.subjectId;
}

function validateScope(value: unknown): asserts value is ModelScope {
  keys(value, ["organizationId", "subjectId"]);
  requireValue(typeof value.organizationId === "string" && value.organizationId.trim().length > 0);
  requireValue(typeof value.subjectId === "string" && value.subjectId.trim().length > 0);
}

function validateActor(value: unknown, scope: ModelScope): asserts value is RightsOperationActor {
  keys(value, ["actorClass", "subjectId", "actorReference"]);
  requireValue(value.actorClass === "human");
  requireValue(value.subjectId === scope.subjectId, "SCOPE_MISMATCH");
  requireIdentifier(value.actorReference);
}

function isPrefix(history: RightsOperationState[], path: RightsOperationState[]): boolean {
  return history.length <= path.length && history.every((state, index) => state === path[index]);
}

function samePath(history: RightsOperationState[], path: RightsOperationState[]): boolean {
  return history.length === path.length && isPrefix(history, path);
}

function validateStatePath(type: RightsOperationType, history: RightsOperationState[]): void {
  const refused = samePath(history, ["REQUESTED", "REFUSED"]);
  if (type === "DELETE" || type === "ERASE") {
    requireValue(
      isPrefix(history, removalPath) || refused || samePath(history, ["REQUESTED", "CANCELLED"]),
      "INVALID_STATE_PATH",
    );
    return;
  }
  if (type === "WITHDRAW_USE") {
    requireValue(
      isPrefix(history, withdrawalPath) || refused || samePath(history, ["REQUESTED", "CANCELLED"]),
      "INVALID_STATE_PATH",
    );
    return;
  }
  requireValue(
    isPrefix(history, nonRemovalPath) ||
      refused ||
      samePath(history, ["REQUESTED", "CANCELLED"]) ||
      samePath(history, ["REQUESTED", "ACCEPTED", "CANCELLED"]),
    "INVALID_STATE_PATH",
  );
}

function validateEffect(
  value: RightsOperationEffect | null,
  type: RightsOperationType,
  states: RightsOperationState[],
  stateTimes: Map<RightsOperationState, number>,
  clock: number,
  terminalAt: number | null,
  admittedEvidence: Set<string>,
): void {
  const nonRemoval = type in effects;
  if (!nonRemoval) {
    requireValue(value === null, "EFFECT_MISMATCH");
    return;
  }
  if (states.at(-1) === "CANCELLED" && value !== null) fail("EFFECT_ALREADY_COMMITTED");
  if (value === null) {
    requireValue(states.at(-1) !== "CLOSED", "COMPLETION_EVIDENCE_REQUIRED");
    return;
  }
  keys(value, ["kind", "committedAt", "completionEvidenceDigest"]);
  requireValue(value.kind === effects[type as keyof typeof effects], "EFFECT_MISMATCH");
  const committedAt = canonicalInstant(value.committedAt);
  const acceptedAt = stateTimes.get("ACCEPTED");
  requireValue(
    acceptedAt !== undefined &&
      committedAt >= acceptedAt &&
      committedAt <= clock &&
      (terminalAt === null || committedAt <= terminalAt),
    "INVALID_EFFECT_TIME",
  );
  requireAdmittedDigest(value.completionEvidenceDigest, admittedEvidence);
}

function validateAttempts(
  attempts: RightsOperationAttempt[],
  states: RightsOperationState[],
  stateTimes: Map<RightsOperationState, number>,
  requestedAt: number,
  clock: number,
  requiresUseBlock: boolean,
  terminalAt: number | null,
  admittedEvidence: Set<string>,
): void {
  const acceptedAt = stateTimes.get("ACCEPTED");
  const useBlockedAt = stateTimes.get("USE_BLOCKED");
  let previousCompletion = -Infinity;
  const ids = new Set<string>();
  for (const [index, attempt] of attempts.entries()) {
    keys(attempt, [
      "attemptId",
      "sequence",
      "startedAt",
      "completedAt",
      "outcome",
      "outcomeCode",
      "completionEvidenceDigest",
    ]);
    requireIdentifier(attempt.attemptId);
    requireValue(!ids.has(attempt.attemptId), "DUPLICATE_ATTEMPT");
    ids.add(attempt.attemptId);
    requireValue(attempt.sequence === index + 1, "INVALID_ATTEMPT_SEQUENCE");
    const startedAt = canonicalInstant(attempt.startedAt);
    const completedAt = canonicalInstant(attempt.completedAt);
    requireValue(
      startedAt >= requestedAt &&
        startedAt >= previousCompletion &&
        completedAt >= startedAt &&
        completedAt <= clock &&
        (terminalAt === null || completedAt <= terminalAt),
      "INVALID_ATTEMPT_TIME",
    );
    requireValue(acceptedAt !== undefined && startedAt >= acceptedAt, "ATTEMPT_NOT_ACCEPTED");
    if (requiresUseBlock)
      requireValue(useBlockedAt !== undefined && startedAt >= useBlockedAt, "USE_BLOCK_REQUIRED");
    requireValue(attempt.outcome === "FAILED" || attempt.outcome === "SUCCEEDED");
    requireIdentifier(attempt.outcomeCode);
    if (attempt.outcome === "FAILED")
      requireValue(attempt.completionEvidenceDigest === null, "INVALID_FAILED_ATTEMPT");
    else requireAdmittedDigest(attempt.completionEvidenceDigest, admittedEvidence);
    previousCompletion = completedAt;
  }

  const liveRemovedAt = stateTimes.get("LIVE_REMOVED");
  if (liveRemovedAt !== undefined) {
    requireValue(
      attempts.some(
        (attempt) =>
          attempt.outcome === "SUCCEEDED" && canonicalInstant(attempt.completedAt) <= liveRemovedAt,
      ),
      "COMPLETION_EVIDENCE_REQUIRED",
    );
  }

  // A terminal attempt never substitutes for the operation's state/effect evidence.
  requireValue(states.length > 0);
}

function terminalRetentionBoundary(terminalAt: number): string {
  const boundary = new Date(terminalAt);
  const month = boundary.getUTCMonth();
  boundary.setUTCFullYear(boundary.getUTCFullYear() + 1);
  if (boundary.getUTCMonth() !== month) boundary.setUTCDate(0);
  return boundary.toISOString();
}

function cloneAndFreeze<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (part: unknown): void => {
    if (part && typeof part === "object") {
      Object.values(part).forEach(freeze);
      Object.freeze(part);
    }
  };
  freeze(clone);
  return clone;
}

function validateOne(
  input: unknown,
  trustedScope: ModelScope,
  clock: number,
  admittedEvidence: Set<string>,
): RightsOperationValidation {
  assertModelJsonData(input);
  keys(input, [
    "operationId",
    "policyVersion",
    "scope",
    "type",
    "target",
    "requestedAt",
    "requestedBy",
    "acceptedBy",
    "history",
    "attempts",
    "effect",
  ]);
  const value = input as unknown as RightsOperationHistory;
  requireIdentifier(value.operationId);
  requireValue(value.policyVersion === TWIN_RIGHTS_OPERATION_POLICY);
  validateScope(value.scope);
  requireValue(sameScope(value.scope, trustedScope), "SCOPE_MISMATCH");
  requireValue(operationTypes.has(value.type));
  keys(value.target, ["scopeKind", "digest"]);
  requireValue(["record", "source", "purpose", "subject"].includes(value.target.scopeKind));
  requireDigest(value.target.digest);
  const requestedAt = canonicalInstant(value.requestedAt);
  requireValue(requestedAt <= clock, "INVALID_TIME");
  validateActor(value.requestedBy, value.scope);
  requireValue(Array.isArray(value.history) && value.history.length > 0);
  requireValue(Array.isArray(value.attempts));

  const states: RightsOperationState[] = [];
  const stateTimes = new Map<RightsOperationState, number>();
  let previousStateTime = -Infinity;
  for (const [index, event] of value.history.entries()) {
    keys(event, ["sequence", "state", "at", "completionEvidenceDigest"]);
    requireValue(event.sequence === index + 1, "INVALID_STATE_SEQUENCE");
    requireValue(operationStates.has(event.state));
    const at = canonicalInstant(event.at);
    requireValue(at >= previousStateTime && at <= clock, "INVALID_STATE_TIME");
    if (index === 0)
      requireValue(event.state === "REQUESTED" && at === requestedAt, "REQUEST_CLOCK_MISMATCH");
    if (requiredStateEvidence.has(event.state)) {
      requireValue(event.completionEvidenceDigest !== null, "COMPLETION_EVIDENCE_REQUIRED");
      requireAdmittedDigest(event.completionEvidenceDigest, admittedEvidence);
    } else requireValue(event.completionEvidenceDigest === null);
    states.push(event.state);
    stateTimes.set(event.state, at);
    previousStateTime = at;
  }
  validateStatePath(value.type, states);

  const accepted = states.includes("ACCEPTED");
  if (accepted) {
    requireValue(value.acceptedBy !== null);
    validateActor(value.acceptedBy, value.scope);
  } else requireValue(value.acceptedBy === null);

  const recordedState = states.at(-1)!;
  const terminalAtMillis = terminalStates.has(recordedState)
    ? stateTimes.get(recordedState)!
    : null;
  validateEffect(
    value.effect,
    value.type,
    states,
    stateTimes,
    clock,
    terminalAtMillis,
    admittedEvidence,
  );
  validateAttempts(
    value.attempts,
    states,
    stateTimes,
    requestedAt,
    clock,
    value.type === "WITHDRAW_USE" || value.type === "DELETE" || value.type === "ERASE",
    terminalAtMillis,
    admittedEvidence,
  );

  const productiveUseBlockRecorded =
    (value.type === "WITHDRAW_USE" || value.type === "DELETE" || value.type === "ERASE") &&
    states.includes("USE_BLOCKED");
  const operation = cloneAndFreeze(value);
  const terminalAt = terminalAtMillis === null ? null : value.history.at(-1)!.at;
  const receiptRetention: RightsOperationValidation["receiptRetention"] =
    terminalAt === null
      ? {
          mode: "while_unresolved",
          terminalAt: null,
          retainUntil: null,
          containsPersonalContent: false,
          subjectDeletionOverride,
        }
      : {
          mode: "terminal_12_months",
          terminalAt,
          retainUntil: terminalRetentionBoundary(canonicalInstant(terminalAt)),
          containsPersonalContent: false,
          subjectDeletionOverride,
        };

  return cloneAndFreeze({
    operation,
    recordedState,
    productiveUseBlockRecorded,
    evidenceQualification: "trusted_context_reference_match_only",
    authority: "none",
    receiptRetention,
  });
}

function exact(left: unknown, right: unknown): boolean {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    return value;
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function requireAppendOnly(
  previous: RightsOperationValidation,
  current: RightsOperationValidation,
): void {
  const before = previous.operation;
  const after = current.operation;
  requireValue(
    exact(
      {
        operationId: before.operationId,
        policyVersion: before.policyVersion,
        scope: before.scope,
        type: before.type,
        target: before.target,
        requestedAt: before.requestedAt,
        requestedBy: before.requestedBy,
      },
      {
        operationId: after.operationId,
        policyVersion: after.policyVersion,
        scope: after.scope,
        type: after.type,
        target: after.target,
        requestedAt: after.requestedAt,
        requestedBy: after.requestedBy,
      },
    ),
    "IMMUTABLE_HEADER_MISMATCH",
  );
  if (before.acceptedBy !== null)
    requireValue(exact(before.acceptedBy, after.acceptedBy), "ACCEPTANCE_REWRITTEN");
  if (before.effect !== null) requireValue(exact(before.effect, after.effect), "EFFECT_REWRITTEN");
  requireValue(after.history.length >= before.history.length, "HISTORY_REWRITTEN");
  requireValue(
    before.history.every((event, index) => exact(event, after.history[index])),
    "HISTORY_REWRITTEN",
  );
  requireValue(after.attempts.length >= before.attempts.length, "ATTEMPT_REWRITTEN");
  requireValue(
    before.attempts.every((attempt, index) => exact(attempt, after.attempts[index])),
    "ATTEMPT_REWRITTEN",
  );
  if (terminalStates.has(previous.recordedState))
    requireValue(exact(before, after), "TERMINAL_HISTORY_EXTENDED");
}

export function validateRightsOperationHistory(
  input: unknown,
  context: RightsOperationValidationContext,
): RightsOperationValidation {
  assertModelJsonData(input);
  assertModelJsonData(context);
  keys(context, ["scope", "now", "previous", "admittedCompletionEvidenceDigests"]);
  validateScope(context.scope);
  const clock = canonicalInstant(context.now);
  requireValue(Array.isArray(context.admittedCompletionEvidenceDigests));
  const admittedEvidence = new Set<string>();
  for (const digest of context.admittedCompletionEvidenceDigests) {
    requireDigest(digest);
    requireValue(!admittedEvidence.has(digest), "DUPLICATE_EVIDENCE_REFERENCE");
    admittedEvidence.add(digest);
  }

  const current = validateOne(input, context.scope, clock, admittedEvidence);
  if (context.previous === null) {
    requireValue(
      current.recordedState === "REQUESTED" &&
        current.operation.history.length === 1 &&
        current.operation.attempts.length === 0 &&
        current.operation.effect === null &&
        current.operation.acceptedBy === null,
      "PREVIOUS_HISTORY_REQUIRED",
    );
    return current;
  }

  const previous = validateOne(context.previous, context.scope, clock, admittedEvidence);
  requireAppendOnly(previous, current);
  return current;
}
