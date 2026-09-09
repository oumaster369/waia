import type { ModelScope } from "./contracts";

/** Inert storage vocabulary. A reference grants neither access nor an action. */
export type ModelObjectKind =
  | "observation"
  | "claim"
  | "correction"
  | "evidence_link"
  | "hypothesis"
  | "relation"
  | "knowledge_need"
  | "formation"
  | "health"
  | "reflection"
  | "prediction"
  | "outcome"
  | "experience"
  | "legacy_directive"
  | "disclosure"
  | "alignment_contract"
  | "action_capability"
  | "cost"
  | "price"
  | "subscription";
export type VersionedModelReference = ModelScope & {
  kind: ModelObjectKind;
  id: string;
  version: number;
};
export type EvidenceLink = {
  ref: VersionedModelReference;
  source: VersionedModelReference;
  target: VersionedModelReference;
  relationship: "supports" | "contradicts" | "contextualizes";
  reason: string;
};
export type WorkingHypothesis = {
  ref: VersionedModelReference;
  purpose: string;
  createdAt: string;
  retentionPolicyId: string;
  context: string;
  domains: string[];
  alternatives: {
    id: string;
    statement: string;
    support: VersionedModelReference[];
    contradiction: VersionedModelReference[];
    uncertainty: string;
    falsifier: string;
  }[];
  validFrom: string;
  validUntil: string | null;
  /** Trusted evidence-service anchor, not a model-provided TTL extension. */
  lastSubstantialEvidenceAt: string | null;
  status: "proposed" | "contested" | "withdrawn";
};
/** Validated candidate shapes below; state transitions remain downstream engine-owned. */
export type DynamicRelation = {
  ref: VersionedModelReference;
  kind: "sigma" | "delta" | "attractor" | "tension" | "temporal_transition";
  endpoints: VersionedModelReference[];
  purpose: string;
  createdAt: string;
  retentionPolicyId: string;
  context: string;
  uncertainty: string;
  validFrom: string;
  validUntil: string | null;
  status: "proposed" | "contested" | "withdrawn";
};
export type KnowledgeNeed = {
  ref: VersionedModelReference;
  purpose: string;
  createdAt: string;
  retentionPolicyId: string;
  reason: string;
  proposedObservation: string;
  evidence: VersionedModelReference[];
  state: "open" | "skipped" | "resolved" | "withdrawn";
};
export type PrivateExportManifest = {
  scope: ModelScope;
  requestId: string;
  requesterSubjectId: string;
  createdAt: string;
  expiresAt: string;
  records: VersionedModelReference[];
  excluded: { ref: VersionedModelReference; reason: string }[];
  deliveryAuthority: "none";
};

/** Trusted current adapter inputs; matching strings do not authenticate authority.
 * Eligibility includes purpose/retention/rights and must be read with the write.
 * These validators never choose or approve the policy supplied by that adapter. */
export type CandidateValidationContext = {
  scope: ModelScope;
  purpose: string;
  retentionPolicyId: string;
  eligibleSources: readonly VersionedModelReference[];
  now: string;
};

function requireValue(ok: unknown, code = "INVALID_INPUT"): asserts ok {
  if (!ok) throw new Error(code);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function time(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const result = Date.parse(value);
  return Number.isFinite(result) && new Date(result).toISOString() === value ? result : NaN;
}
/** Reject getters/hidden fields/sparse arrays before cloning, hashing or reading payloads. */
export function assertModelJsonData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    requireValue(Number.isFinite(value));
    return;
  }
  requireValue(value && typeof value === "object" && !ancestors.has(value));
  const array = Array.isArray(value);
  requireValue(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  const keys = Reflect.ownKeys(value);
  if (array) requireValue(keys.length === value.length + 1);
  ancestors.add(value);
  for (const key of keys) {
    requireValue(typeof key === "string");
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireValue(descriptor.enumerable && Object.hasOwn(descriptor, "value"));
    if (array) requireValue(/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length);
    assertModelJsonData(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}
function keys(value: unknown, expected: string[]): void {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  requireValue(
    Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
  );
}
function reference(value: VersionedModelReference, scope: ModelScope): void {
  keys(value, ["organizationId", "subjectId", "kind", "id", "version"]);
  requireValue(
    value.organizationId === scope.organizationId && value.subjectId === scope.subjectId,
    "SCOPE_MISMATCH",
  );
  requireValue(nonempty(value.id) && Number.isSafeInteger(value.version) && value.version > 0);
}
export function modelReferenceKey(ref: VersionedModelReference): string {
  return JSON.stringify([ref.organizationId, ref.subjectId, ref.kind, ref.id, ref.version]);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Pure shape/lineage check, not extraction, calibrated confidence or consent authentication.
 * `eligibleSources` MUST be read from current authorized storage in the write transaction.
 * Substantial-evidence time must be established independently by that trusted adapter. */
export function validateWorkingHypothesis(
  input: unknown,
  scope: ModelScope,
  eligibleSources: readonly VersionedModelReference[],
  now: string,
): WorkingHypothesis {
  assertModelJsonData(input);
  assertModelJsonData(scope);
  assertModelJsonData(eligibleSources);
  keys(scope, ["organizationId", "subjectId"]);
  requireValue(
    nonempty(scope.organizationId) && nonempty(scope.subjectId) && Number.isFinite(time(now)),
  );
  keys(input, [
    "ref",
    "purpose",
    "createdAt",
    "retentionPolicyId",
    "context",
    "domains",
    "alternatives",
    "validFrom",
    "validUntil",
    "lastSubstantialEvidenceAt",
    "status",
  ]);
  const value = input as WorkingHypothesis;
  reference(value.ref, scope);
  requireValue(value.ref.kind === "hypothesis");
  requireValue([value.purpose, value.retentionPolicyId, value.context].every(nonempty));
  requireValue(["proposed", "contested", "withdrawn"].includes(value.status));
  requireValue(Number.isFinite(time(value.createdAt)) && time(value.createdAt) <= time(now));
  requireValue(Number.isFinite(time(value.validFrom)) && time(value.validFrom) <= time(now));
  requireValue(
    value.validUntil === null ||
      (Number.isFinite(time(value.validUntil)) && time(value.validUntil) > time(value.validFrom)),
  );
  requireValue(
    value.lastSubstantialEvidenceAt === null ||
      (Number.isFinite(time(value.lastSubstantialEvidenceAt)) &&
        time(value.lastSubstantialEvidenceAt) >= time(value.createdAt) &&
        time(value.lastSubstantialEvidenceAt) <= time(now)),
  );
  requireValue(
    Array.isArray(value.domains) &&
      value.domains.length > 0 &&
      value.domains.every(nonempty) &&
      new Set(value.domains).size === value.domains.length,
  );
  requireValue(Array.isArray(value.alternatives) && value.alternatives.length >= 2);
  requireValue(Array.isArray(eligibleSources));
  eligibleSources.forEach((source) => reference(source, scope));
  const eligible = new Set(eligibleSources.map(modelReferenceKey));
  requireValue(eligible.size === eligibleSources.length);
  const ids = new Set<string>();
  const statements = new Set<string>();
  let evidenceCount = 0;
  for (const alternative of value.alternatives) {
    keys(alternative, ["id", "statement", "support", "contradiction", "uncertainty", "falsifier"]);
    requireValue(
      [alternative.id, alternative.statement, alternative.uncertainty, alternative.falsifier].every(
        nonempty,
      ) && !ids.has(alternative.id),
    );
    ids.add(alternative.id);
    const statement = alternative.statement.trim();
    requireValue(!statements.has(statement), "DUPLICATE_INTERPRETATION");
    statements.add(statement);
    for (const refs of [alternative.support, alternative.contradiction]) {
      requireValue(Array.isArray(refs));
      const unique = new Set<string>();
      for (const ref of refs) {
        reference(ref, scope);
        requireValue(["observation", "claim", "correction", "outcome"].includes(ref.kind));
        const key = modelReferenceKey(ref);
        requireValue(eligible.has(key), "EVIDENCE_UNAVAILABLE");
        requireValue(!unique.has(key));
        unique.add(key);
        evidenceCount++;
      }
    }
  }
  requireValue(evidenceCount > 0, "EVIDENCE_UNAVAILABLE");
  return freeze(structuredClone(value));
}

const candidateSourceKinds = [
  "observation",
  "claim",
  "correction",
  "hypothesis",
  "relation",
  "outcome",
];

function candidateBase(input: unknown, ctx: CandidateValidationContext, expected: string[]) {
  assertModelJsonData(input);
  assertModelJsonData(ctx);
  keys(ctx, ["scope", "purpose", "retentionPolicyId", "eligibleSources", "now"]);
  keys(ctx.scope, ["organizationId", "subjectId"]);
  requireValue(
    [ctx.scope.organizationId, ctx.scope.subjectId, ctx.purpose, ctx.retentionPolicyId].every(
      nonempty,
    ),
  );
  requireValue(Number.isFinite(time(ctx.now)) && Array.isArray(ctx.eligibleSources));
  keys(input, expected);
  const base = input as {
    ref: VersionedModelReference;
    purpose: string;
    createdAt: string;
    retentionPolicyId: string;
  };
  reference(base.ref, ctx.scope);
  requireValue(
    base.purpose === ctx.purpose && base.retentionPolicyId === ctx.retentionPolicyId,
    "PURPOSE_POLICY_MISMATCH",
  );
  requireValue(Number.isFinite(time(base.createdAt)) && time(base.createdAt) <= time(ctx.now));
  const eligible = new Set<string>();
  for (const ref of ctx.eligibleSources) {
    reference(ref, ctx.scope);
    requireValue(candidateSourceKinds.includes(ref.kind));
    const key = modelReferenceKey(ref);
    requireValue(!eligible.has(key));
    eligible.add(key);
  }
  return eligible;
}

function candidateEvidence(
  refs: VersionedModelReference[],
  own: VersionedModelReference,
  ctx: CandidateValidationContext,
  eligible: Set<string>,
) {
  requireValue(Array.isArray(refs));
  const seen = new Set<string>();
  for (const ref of refs) {
    reference(ref, ctx.scope);
    requireValue(candidateSourceKinds.includes(ref.kind));
    requireValue(!(ref.kind === own.kind && ref.id === own.id), "SELF_REFERENCE");
    const key = modelReferenceKey(ref);
    requireValue(eligible.has(key), "EVIDENCE_UNAVAILABLE");
    requireValue(!seen.has(key), "DUPLICATE_EVIDENCE");
    seen.add(key);
  }
}

/** Shape and current lineage only; does not discover or endorse a Human pattern. */
export function validateDynamicRelation(
  input: unknown,
  ctx: CandidateValidationContext,
): DynamicRelation {
  const eligible = candidateBase(input, ctx, [
    "ref",
    "kind",
    "endpoints",
    "purpose",
    "createdAt",
    "retentionPolicyId",
    "context",
    "uncertainty",
    "validFrom",
    "validUntil",
    "status",
  ]);
  const value = input as DynamicRelation;
  requireValue(value.ref.kind === "relation");
  requireValue(
    ["sigma", "delta", "attractor", "tension", "temporal_transition"].includes(value.kind),
  );
  requireValue(["proposed", "contested", "withdrawn"].includes(value.status));
  requireValue([value.context, value.uncertainty].every(nonempty));
  requireValue(Number.isFinite(time(value.validFrom)) && time(value.validFrom) <= time(ctx.now));
  requireValue(
    value.validUntil === null ||
      (Number.isFinite(time(value.validUntil)) && time(value.validUntil) > time(value.validFrom)),
  );
  candidateEvidence(value.endpoints, value.ref, ctx, eligible);
  requireValue(value.endpoints.length > 0, "EVIDENCE_UNAVAILABLE");
  return freeze(structuredClone(value));
}

/** An open knowledge gap may lack evidence. A resolved label needs a source,
 * but this check alone proves neither resolution nor permission to ask a question. */
export function validateKnowledgeNeed(
  input: unknown,
  ctx: CandidateValidationContext,
): KnowledgeNeed {
  const eligible = candidateBase(input, ctx, [
    "ref",
    "purpose",
    "createdAt",
    "retentionPolicyId",
    "reason",
    "proposedObservation",
    "evidence",
    "state",
  ]);
  const value = input as KnowledgeNeed;
  requireValue(value.ref.kind === "knowledge_need");
  requireValue(["open", "skipped", "resolved", "withdrawn"].includes(value.state));
  requireValue([value.reason, value.proposedObservation].every(nonempty));
  candidateEvidence(value.evidence, value.ref, ctx, eligible);
  requireValue(value.state !== "resolved" || value.evidence.length > 0, "EVIDENCE_UNAVAILABLE");
  return freeze(structuredClone(value));
}
