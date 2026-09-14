import type { GrantReference, ModelConsentGrant, ModelScope, ObservationSource } from "./contracts";
import { assertModelJsonData } from "./persistence-contracts";

/** Human-ratified private source-admission semantics; not consent creation. */
export const TWIN_SOURCE_ADMISSION_POLICY = "human-approved-2026-09-14/v1";

export type PrivateSourceAdmissionCandidate = Readonly<{
  scope: ModelScope;
  sourceEventId: string;
  createdAt: string;
}>;

/** Trusted adapter inputs. Matching identifiers do not authenticate a Human. */
export type SourceAdmissionContext = Readonly<{
  scope: ModelScope;
  now: string;
  sourceClass: ObservationSource;
  purpose: string;
  permittedUse: "productive_private_modelling";
  retentionPolicyId: string;
  resolvedGrant: GrantReference;
  currentGrants: readonly ModelConsentGrant[];
  withdrawnSourceEventIds: readonly string[];
}>;

/** Minimal admission receipt; it contains no source content or disclosure grant. */
export type PrivateSourceAdmission = Readonly<{
  policyVersion: typeof TWIN_SOURCE_ADMISSION_POLICY;
  scope: ModelScope;
  sourceEventId: string;
  sourceClass: ObservationSource;
  createdAt: string;
  purpose: string;
  permittedUse: "productive_private_modelling";
  grant: GrantReference;
  retentionPolicyId: string;
  disclosureBoundary: "private_only";
  productiveUseAllowed: true;
  disclosureAllowed: false;
  disclosureGrant: null;
}>;

function requireValue(ok: unknown, code = "INVALID_INPUT"): asserts ok {
  if (!ok) throw new Error(code);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function instant(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}

function keys(value: unknown, expected: readonly string[]): void {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  requireValue(
    Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
  );
}

function scope(value: ModelScope): void {
  keys(value, ["organizationId", "subjectId"]);
  requireValue(nonempty(value.organizationId) && nonempty(value.subjectId));
}

function sameScope(left: ModelScope, right: ModelScope): boolean {
  return left.organizationId === right.organizationId && left.subjectId === right.subjectId;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const admittedSourceClasses = new Set<ObservationSource>(["dialogue", "diary"]);

function validateGrant(grant: ModelConsentGrant, expectedScope: ModelScope): void {
  keys(grant, [
    "id",
    "version",
    "scope",
    "purpose",
    "sources",
    "mode",
    "disclosureBoundary",
    "issuedAt",
    "expiresAt",
    "revokedAt",
    "retentionPolicyId",
  ]);
  scope(grant.scope);
  requireValue(sameScope(grant.scope, expectedScope), "SCOPE_MISMATCH");
  requireValue(
    nonempty(grant.id) &&
      Number.isSafeInteger(grant.version) &&
      grant.version > 0 &&
      nonempty(grant.purpose) &&
      nonempty(grant.retentionPolicyId),
  );
  requireValue(Array.isArray(grant.sources) && grant.sources.length > 0);
  requireValue(new Set(grant.sources).size === grant.sources.length);
  for (const sourceClass of grant.sources)
    requireValue(admittedSourceClasses.has(sourceClass), "SOURCE_CLASS_NOT_ADMITTED");
  requireValue(["private_modelling", "raw_only"].includes(grant.mode));
  requireValue(grant.disclosureBoundary === "private_only");
  const issuedAt = instant(grant.issuedAt);
  const expiresAt = instant(grant.expiresAt);
  const revokedAt = grant.revokedAt === null ? null : instant(grant.revokedAt);
  requireValue(
    Number.isFinite(issuedAt) &&
      Number.isFinite(expiresAt) &&
      issuedAt < expiresAt &&
      (revokedAt === null || (Number.isFinite(revokedAt) && revokedAt >= issuedAt)),
  );
}

/** Qualifies one new private source event for productive modelling. It does not
 * create consent, persist content, authenticate identity or authorize disclosure. */
export function admitPrivateSourceEvent(
  input: unknown,
  context: SourceAdmissionContext,
): PrivateSourceAdmission {
  assertModelJsonData(input);
  assertModelJsonData(context);
  keys(context, [
    "scope",
    "now",
    "sourceClass",
    "purpose",
    "permittedUse",
    "retentionPolicyId",
    "resolvedGrant",
    "currentGrants",
    "withdrawnSourceEventIds",
  ]);
  scope(context.scope);
  const now = instant(context.now);
  requireValue(
    Number.isFinite(now) &&
      nonempty(context.purpose) &&
      context.permittedUse === "productive_private_modelling" &&
      nonempty(context.retentionPolicyId),
  );
  requireValue(admittedSourceClasses.has(context.sourceClass), "SOURCE_CLASS_NOT_ADMITTED");
  keys(context.resolvedGrant, ["id", "version"]);
  requireValue(
    nonempty(context.resolvedGrant.id) &&
      Number.isSafeInteger(context.resolvedGrant.version) &&
      context.resolvedGrant.version > 0,
  );
  requireValue(Array.isArray(context.currentGrants));
  requireValue(Array.isArray(context.withdrawnSourceEventIds));

  keys(input, ["scope", "sourceEventId", "createdAt"]);
  const candidate = input as PrivateSourceAdmissionCandidate;
  scope(candidate.scope);
  requireValue(sameScope(candidate.scope, context.scope), "SCOPE_MISMATCH");
  requireValue(nonempty(candidate.sourceEventId));
  const createdAt = instant(candidate.createdAt);
  requireValue(Number.isFinite(createdAt) && createdAt <= now);

  const withdrawn = new Set<string>();
  for (const sourceEventId of context.withdrawnSourceEventIds) {
    requireValue(nonempty(sourceEventId) && !withdrawn.has(sourceEventId));
    withdrawn.add(sourceEventId);
  }
  requireValue(!withdrawn.has(candidate.sourceEventId), "SOURCE_WITHDRAWN");

  for (const grant of context.currentGrants) validateGrant(grant, context.scope);
  const matchingId = context.currentGrants.filter((grant) => grant.id === context.resolvedGrant.id);
  const latestVersion = Math.max(...matchingId.map((grant) => grant.version));
  const latest = matchingId.filter((grant) => grant.version === latestVersion);
  const grant = latest.length === 1 ? latest[0] : undefined;
  requireValue(
    grant &&
      grant.version === context.resolvedGrant.version &&
      grant.purpose === context.purpose &&
      grant.sources.includes(context.sourceClass) &&
      grant.mode === "private_modelling" &&
      grant.disclosureBoundary === "private_only" &&
      grant.retentionPolicyId === context.retentionPolicyId &&
      instant(grant.issuedAt) <= createdAt &&
      now < instant(grant.expiresAt) &&
      grant.revokedAt === null,
    "CONSENT_UNAVAILABLE",
  );

  return freeze(
    structuredClone({
      policyVersion: TWIN_SOURCE_ADMISSION_POLICY,
      scope: candidate.scope,
      sourceEventId: candidate.sourceEventId,
      sourceClass: context.sourceClass,
      createdAt: candidate.createdAt,
      purpose: context.purpose,
      permittedUse: context.permittedUse,
      grant: context.resolvedGrant,
      retentionPolicyId: context.retentionPolicyId,
      disclosureBoundary: "private_only" as const,
      productiveUseAllowed: true as const,
      disclosureAllowed: false as const,
      disclosureGrant: null,
    }),
  );
}
