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
/** Reference-only design for later repositories/engines; not validated runtime payloads. */
export type DynamicRelation = {
  ref: VersionedModelReference;
  kind: "sigma" | "delta" | "attractor" | "tension" | "temporal_transition";
  endpoints: VersionedModelReference[];
  purpose: string;
  context: string;
  uncertainty: string;
  validFrom: string;
  validUntil: string | null;
};
export type KnowledgeNeed = {
  ref: VersionedModelReference;
  purpose: string;
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
