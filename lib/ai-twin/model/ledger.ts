import { createHash } from "node:crypto";

import type {
  HumanClaimVersion,
  ModelCommand,
  ModelContext,
  ModelLedger,
  ModelObservation,
  ModelScope,
} from "./contracts";

// Pure, in-memory reference transitions only. No production callers or persistence.
// The future adapter owns authentication, RLS, atomic writes and rights propagation.
function fail(code: string): never {
  throw new Error(code);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function instant(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function sameScope(a: ModelScope, b: ModelScope): boolean {
  return a?.organizationId === b?.organizationId && a?.subjectId === b?.subjectId;
}
function exactKeys(value: unknown, fields: readonly string[]): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}
function validScope(scope: ModelScope): boolean {
  return (
    exactKeys(scope, ["organizationId", "subjectId"]) &&
    text(scope.organizationId) &&
    text(scope.subjectId)
  );
}
// Canonical hashing and storage must see exactly the same dense data elements.
function dataArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    Object.getPrototypeOf(value) === Array.prototype &&
    Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) =>
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index)) ?? {}, "value"),
    ).every(Boolean)
  );
}
function freeze<T>(value: T): T {
  const copy = structuredClone(value);
  function visit(node: unknown) {
    if (node && typeof node === "object") {
      Object.values(node).forEach(visit);
      Object.freeze(node);
    }
  }
  visit(copy);
  return copy;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return fail("INVALID_INPUT");
}
function requireContext(state: ModelLedger, ctx: ModelContext) {
  if (
    !validScope(ctx.scope) ||
    !text(ctx.purpose) ||
    !Number.isFinite(instant(ctx.now)) ||
    !["human", "model"].includes(ctx.actor.kind) ||
    !Array.isArray(ctx.grants)
  )
    fail("INVALID_INPUT");
  if (!sameScope(state.scope, ctx.scope) || ctx.actor.subjectId !== state.scope.subjectId)
    fail("SCOPE_MISMATCH");
  if (state.lastRecordedAt !== null && instant(ctx.now) < instant(state.lastRecordedAt))
    fail("INVALID_INPUT");
}
function requireCommand(command: ModelCommand) {
  if (!command || !["observe", "propose", "correct"].includes(command.kind)) fail("INVALID_INPUT");
  const fields = {
    observe: [
      "kind",
      "requestId",
      "scope",
      "id",
      "grant",
      "source",
      "eventTime",
      "context",
      "text",
      "projectionRisks",
    ],
    propose: [
      "kind",
      "requestId",
      "scope",
      "claimId",
      "statement",
      "domain",
      "context",
      "uncertainty",
      "observationIds",
    ],
    correct: [
      "kind",
      "requestId",
      "scope",
      "id",
      "claimId",
      "expectedRevision",
      "action",
      "reason",
      "statement",
      "context",
    ],
  };
  const expected = fields[command.kind];
  if (
    !expected ||
    !exactKeys(command, expected) ||
    !text(command.requestId) ||
    !validScope(command.scope)
  )
    fail("INVALID_INPUT");
  if (command.kind === "observe") {
    if (
      !text(command.id) ||
      !text(command.text) ||
      !text(command.context) ||
      !["dialogue", "diary"].includes(command.source) ||
      !Number.isFinite(instant(command.eventTime)) ||
      !exactKeys(command.grant, ["id", "version"]) ||
      !text(command.grant.id) ||
      !Number.isSafeInteger(command.grant.version) ||
      command.grant.version < 1 ||
      !dataArray(command.projectionRisks) ||
      Array.from(command.projectionRisks).some(
        (risk) =>
          ![
            "ambiguity",
            "leading_question",
            "missing_context",
            "selection_bias",
            "model_interpretation",
          ].includes(risk),
      )
    )
      fail("INVALID_INPUT");
  } else if (command.kind === "propose") {
    if (
      ![
        command.claimId,
        command.statement,
        command.domain,
        command.context,
        command.uncertainty,
      ].every(text) ||
      !dataArray(command.observationIds) ||
      command.observationIds.length === 0 ||
      !Array.from(command.observationIds).every(text) ||
      new Set(command.observationIds).size !== command.observationIds.length
    )
      fail("INVALID_INPUT");
  } else {
    if (
      ![command.id, command.claimId, command.reason].every(text) ||
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 1 ||
      !["ratify", "correct", "dispute", "contextualize"].includes(command.action)
    )
      fail("INVALID_INPUT");
    if (command.action === "ratify" || command.action === "dispute") {
      if (command.statement !== null || command.context !== null) fail("INVALID_INPUT");
    } else if (!text(command.statement) || !text(command.context)) fail("INVALID_INPUT");
  }
}
function consentFor(
  observation: Pick<ModelObservation, "grant" | "source" | "scope" | "recordedAt" | "purpose">,
  ctx: ModelContext,
) {
  const matches = ctx.grants.filter((grant) => grant.id === observation.grant.id);
  const latest = Math.max(...matches.map((grant) => grant.version));
  const candidates = matches.filter((grant) => grant.version === latest);
  const grant = candidates.length === 1 ? candidates[0] : undefined;
  if (
    !grant ||
    grant.version !== observation.grant.version ||
    !sameScope(grant.scope, ctx.scope) ||
    !sameScope(observation.scope, ctx.scope) ||
    grant.purpose !== ctx.purpose ||
    observation.purpose !== ctx.purpose ||
    grant.mode !== "private_modelling" ||
    grant.revokedAt !== null ||
    !text(grant.retentionPolicyId) ||
    !grant.sources.includes(observation.source) ||
    !Number.isFinite(instant(grant.issuedAt)) ||
    !Number.isFinite(instant(grant.expiresAt)) ||
    instant(grant.issuedAt) > instant(observation.recordedAt) ||
    instant(ctx.now) >= instant(grant.expiresAt)
  )
    return undefined;
  return grant;
}
function usable(observation: ModelObservation, ctx: ModelContext): boolean {
  const grant = consentFor(observation, ctx);
  return !!grant && grant.retentionPolicyId === observation.retentionPolicyId;
}
function latestClaim(state: ModelLedger, claimId: string): HumanClaimVersion | undefined {
  return state.claims.findLast((claim) => claim.claimId === claimId);
}
function requireEvidence(state: ModelLedger, ids: readonly string[], ctx: ModelContext) {
  if (
    !ids.length ||
    ids.some((id) => {
      const observation = state.observations.find((item) => item.id === id);
      return !observation || !usable(observation, ctx);
    })
  )
    fail("EVIDENCE_UNAVAILABLE");
}

export function createModelLedger(scope: ModelScope): ModelLedger {
  if (!validScope(scope)) fail("INVALID_INPUT");
  return freeze({
    scope,
    lastRecordedAt: null,
    observations: [],
    claims: [],
    corrections: [],
    receipts: [],
  });
}

/** Authenticated scope and current consent are checked BEFORE replay deduplication. */
export function applyModelCommand(
  state: ModelLedger,
  command: ModelCommand,
  ctx: ModelContext,
): ModelLedger {
  requireContext(state, ctx);
  requireCommand(command);
  if (!sameScope(command.scope, state.scope)) fail("SCOPE_MISMATCH");
  let prior: HumanClaimVersion | undefined;
  if (command.kind === "observe") {
    if (ctx.actor.kind !== "human") fail("HUMAN_REQUIRED");
    if (instant(command.eventTime) > instant(ctx.now)) fail("INVALID_INPUT");
    if (!consentFor({ ...command, recordedAt: ctx.now, purpose: ctx.purpose }, ctx))
      fail("CONSENT_UNAVAILABLE");
  } else if (command.kind === "propose") {
    if (ctx.actor.kind !== "model") fail("MODEL_REQUIRED");
    requireEvidence(state, command.observationIds, ctx);
  } else {
    if (ctx.actor.kind !== "human") fail("HUMAN_REQUIRED");
    prior = latestClaim(state, command.claimId);
    if (!prior || prior.purpose !== ctx.purpose) fail("EVIDENCE_UNAVAILABLE");
    requireEvidence(state, prior.observationIds, ctx);
  }
  const fingerprint = createHash("sha256")
    .update(canonical({ command, actor: ctx.actor, purpose: ctx.purpose }))
    .digest("hex");
  const receipt = state.receipts.find((item) => item.requestId === command.requestId);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) fail("REPLAY_CONFLICT");
    return state;
  }
  let observations = state.observations;
  let claims = state.claims;
  let corrections = state.corrections;
  if (command.kind === "observe") {
    if (observations.some((item) => item.id === command.id)) fail("DUPLICATE_ID");
    const grant = consentFor({ ...command, recordedAt: ctx.now, purpose: ctx.purpose }, ctx)!;
    observations = [
      ...observations,
      {
        id: command.id,
        scope: command.scope,
        grant: command.grant,
        source: command.source,
        eventTime: command.eventTime,
        context: command.context,
        text: command.text,
        projectionRisks: command.projectionRisks,
        epistemicKind: "self_report",
        purpose: ctx.purpose,
        recordedAt: ctx.now,
        retentionPolicyId: grant.retentionPolicyId,
      },
    ];
  } else if (command.kind === "propose") {
    if (latestClaim(state, command.claimId)) fail("DUPLICATE_ID");
    claims = [
      ...claims,
      {
        claimId: command.claimId,
        scope: command.scope,
        statement: command.statement,
        domain: command.domain,
        context: command.context,
        uncertainty: command.uncertainty,
        observationIds: command.observationIds,
        revision: 1,
        purpose: ctx.purpose,
        supersedesRevision: null,
        status: "proposed",
        basis: "model_interpretation",
        recordedAt: ctx.now,
        humanCorrectionId: null,
      },
    ];
  } else {
    if (corrections.some((item) => item.id === command.id)) fail("DUPLICATE_ID");
    if (!prior) fail("EVIDENCE_UNAVAILABLE");
    if (prior.revision !== command.expectedRevision) fail("STALE_REVISION");
    const { expectedRevision } = command;
    corrections = [
      ...corrections,
      {
        id: command.id,
        claimId: command.claimId,
        scope: command.scope,
        action: command.action,
        reason: command.reason,
        statement: command.statement,
        context: command.context,
        previousRevision: expectedRevision,
        purpose: ctx.purpose,
        actorSubjectId: ctx.actor.subjectId,
        recordedAt: ctx.now,
      },
    ];
    claims = [
      ...claims,
      {
        ...prior,
        revision: expectedRevision + 1,
        supersedesRevision: expectedRevision,
        statement: command.statement ?? prior.statement,
        context: command.context ?? prior.context,
        status: command.action === "dispute" ? "contested" : "active",
        basis: command.action === "dispute" ? prior.basis : "human_endorsed",
        recordedAt: ctx.now,
        humanCorrectionId: command.id,
      },
    ];
  }
  return freeze({
    scope: state.scope,
    lastRecordedAt: ctx.now,
    observations,
    claims,
    corrections,
    receipts: [...state.receipts, { requestId: command.requestId, fingerprint }],
  });
}

/** A use-filtered projection, NOT deletion, disclosure authority or factual truth. */
export function projectCurrentModel(
  state: ModelLedger,
  ctx: ModelContext,
): readonly HumanClaimVersion[] {
  requireContext(state, ctx);
  const latest = new Map(state.claims.map((claim) => [claim.claimId, claim]));
  return Object.freeze(
    [...latest.values()].filter(
      (claim) =>
        sameScope(claim.scope, ctx.scope) &&
        claim.purpose === ctx.purpose &&
        claim.status !== "withdrawn" &&
        claim.status !== "superseded" &&
        claim.observationIds.length > 0 &&
        claim.observationIds.every((id) => {
          const observation = state.observations.find((item) => item.id === id);
          return !!observation && usable(observation, ctx);
        }),
    ),
  );
}
