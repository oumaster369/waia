import { createHash } from "node:crypto";
import type { ModelScope } from "./contracts";

/** Inert reference policy, not storage, authentication, legal-basis determination or
 * a request/LLM parser. The future trusted adapter supplies current authorizations,
 * evidence eligibility and substantial-evidence anchors from authoritative records.
 * These functions neither collect data nor perform/verify removal or disclosure. */
export const TWIN_RETENTION_POLICY = "human-approved-2026-09-08/v1";
const DAY = 86400000;
type Purpose =
  | "dialogue"
  | "modelling"
  | "private_archive"
  | "diagnostics"
  | "security"
  | "export"
  | "processing"
  | "backup"
  | "rights_receipt";
export type RetentionAuthorization = Readonly<{
  scope: ModelScope;
  recordId: string;
  recordRevision: number;
  purpose: Purpose;
  approvedBy: "human" | "reviewed_policy";
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  basisReference: string;
}>;
export type RetentionRecord = Readonly<{
  scope: ModelScope;
  id: string;
  revision: number;
  kind:
    | "dialogue"
    | "hypothesis"
    | "diary"
    | "saved_episode"
    | "model"
    | "experience_archive"
    | "diagnostic_log"
    | "security_event"
    | "export"
    | "processing_copy"
    | "backup"
    | "receipt";
  createdAt: string;
  evidenceEligible: boolean;
  erasureRequestedAt: string | null;
  lastSubstantialEvidenceAt?: string;
  lastNecessityReviewAt?: string;
  processingCompletedAt?: string;
}>;
const purposes: Record<RetentionRecord["kind"], Purpose> = {
  dialogue: "dialogue",
  hypothesis: "modelling",
  model: "modelling",
  diary: "private_archive",
  saved_episode: "private_archive",
  experience_archive: "private_archive",
  diagnostic_log: "diagnostics",
  security_event: "security",
  export: "export",
  processing_copy: "processing",
  backup: "backup",
  receipt: "rights_receipt",
};
function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("Canonical UTC timestamp required");
  }
  return parsed;
}
function sameScope(a: ModelScope, b: ModelScope): boolean {
  return a.organizationId === b.organizationId && a.subjectId === b.subjectId;
}
function text(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error("Nonempty text required");
}
function identity(scope: ModelScope, id: string, revision: number): void {
  text(scope.organizationId);
  text(scope.subjectId);
  text(id);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid revision");
}
function anniversary(value: number): number {
  const date = new Date(value);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  // A February 29 review is due February 28 in a non-leap year.
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.getTime();
}

export function planRetention(
  record: RetentionRecord,
  authorization: RetentionAuthorization | null,
  now: string,
) {
  identity(record.scope, record.id, record.revision);
  const clock = instant(now);
  const created = instant(record.createdAt);
  if (created > clock) throw new Error("Record is in the future");
  const anchor = (value: string | undefined) => {
    const result = value === undefined ? created : instant(value);
    if (result < created || result > clock) throw new Error("Invalid lifecycle anchor");
    return result;
  };
  let expiry: number | null = null;
  let reviewAt: number | null = null;
  switch (record.kind) {
    case "dialogue":
    case "security_event":
      expiry = created + 90 * DAY;
      break;
    case "hypothesis":
      expiry = anchor(record.lastSubstantialEvidenceAt) + 90 * DAY;
      break;
    case "diagnostic_log":
      expiry = created + 14 * DAY;
      break;
    case "export":
      expiry = created + DAY;
      break;
    case "backup":
      expiry = created + 30 * DAY;
      break;
    case "processing_copy":
      if (record.processingCompletedAt === undefined)
        throw new Error("Completed-copy policy requires completion time");
      expiry = anchor(record.processingCompletedAt) + DAY;
      break;
    case "model":
      reviewAt = anniversary(anchor(record.lastNecessityReviewAt));
      break;
    case "receipt":
    case "diary":
    case "saved_episode":
    case "experience_archive":
      break;
    default:
      throw new Error("Unknown retention class");
  }
  let permitted = false;
  if (authorization !== null) {
    const from = instant(authorization.validFrom);
    const until = authorization.validUntil === null ? null : instant(authorization.validUntil);
    const revoked = authorization.revokedAt === null ? null : instant(authorization.revokedAt);
    if (until !== null && until <= from) throw new Error("Invalid authorization interval");
    permitted =
      sameScope(record.scope, authorization.scope) &&
      authorization.recordId === record.id &&
      authorization.recordRevision === record.revision &&
      authorization.purpose === purposes[record.kind] &&
      ["human", "reviewed_policy"].includes(authorization.approvedBy) &&
      from <= clock &&
      (until === null || clock < until) &&
      (revoked === null || clock < revoked);
    if (purposes[record.kind] === "private_archive")
      permitted &&= authorization.approvedBy === "human";
    if (record.kind === "receipt") {
      permitted &&=
        authorization.approvedBy === "reviewed_policy" &&
        until !== null &&
        typeof authorization.basisReference === "string" &&
        authorization.basisReference.trim().length > 0;
    }
    if (until !== null) expiry = expiry === null ? until : Math.min(expiry, until);
  }
  const requestAt = record.erasureRequestedAt === null ? null : anchor(record.erasureRequestedAt);
  const retain =
    permitted &&
    record.evidenceEligible === true &&
    requestAt === null &&
    (expiry === null || clock < expiry);
  const iso = (value: number | null) => (value === null ? null : new Date(value).toISOString());
  return {
    policyVersion: TWIN_RETENTION_POLICY,
    disposition: retain ? ("retain" as const) : ("remove" as const),
    /** Applies ONLY to the recorded purpose, never inferred modelling/sharing. */
    purposeUseAllowed: retain,
    expiresAt: iso(expiry),
    reviewDueAt: iso(reviewAt),
    reviewDue: reviewAt !== null && clock >= reviewAt,
    liveRemovalTargetAt: iso(requestAt === null ? null : requestAt + 7 * DAY),
    allCopiesRemovalTargetAt: iso(requestAt === null ? null : requestAt + 30 * DAY),
    removalVerified: false as const,
  };
}

export type ExperienceDraft = Readonly<{
  scope: ModelScope;
  id: string;
  revision: number;
  recordedAt: string;
  situation: string;
  eventTime: string;
  context: string;
  intention: string;
  consideredOptions: readonly string[];
  decision: string;
  reasons: readonly string[];
  expectedConsequences: readonly string[];
  observedOutcomes: readonly string[];
  humanLesson: string;
  reinterpretations: readonly string[];
  uncertainty: string;
  transferConditions: string;
  provenance: readonly Readonly<{
    scope: ModelScope;
    sourceId: string;
    sourceVersion: number;
    kind: "human_declaration" | "authorized_archival_source";
    authorizationReference: string;
    eligible: boolean;
  }>[];
}>;

/** Canonical JSON for a trusted JSON-data contract; reject clone/hash ambiguity.
 * No accessors, symbols, custom prototypes, hidden fields or sparse arrays. */
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || value === null) throw new Error("JSON data required");
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype))
    throw new Error("Plain JSON data required");
  const keys = Reflect.ownKeys(value);
  const expected = array
    ? Array.from({ length: value.length }, (_, i) => String(i)).concat("length")
    : keys;
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  )
    throw new Error("Invalid JSON keys");
  const dataKeys = keys.filter((key) => key !== "length" || !array) as string[];
  for (const key of dataKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor))
      throw new Error("Own enumerable data required");
  }
  if (array)
    return `[${dataKeys.map((key) => canonical(Object.getOwnPropertyDescriptor(value, key)!.value)).join(",")}]`;
  return `{${dataKeys
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical(Object.getOwnPropertyDescriptor(value, key)!.value)}`,
    )
    .join(",")}}`;
}
export function experienceFingerprint(draft: ExperienceDraft): string {
  return createHash("sha256").update(canonical(draft)).digest("hex");
}
function exactKeys(value: object, keys: string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    throw new Error("Unexpected experience fields");
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function composePrivateExperience(
  draft: ExperienceDraft,
  context: {
    scope: ModelScope;
    actor: { kind: "human" | "model"; subjectId: string };
    now: string;
    authorization: RetentionAuthorization;
    /** Current trusted state, not the historical approval/draft. Missing state denies. */
    currentRecord: RetentionRecord;
    currentSources: ExperienceDraft["provenance"];
    approvedFingerprint: string;
  },
) {
  const fingerprint = experienceFingerprint(draft);
  // Copy only canonical data; no mutable alias into the Human-approved input.
  const copy: ExperienceDraft = JSON.parse(canonical(draft));
  exactKeys(copy, [
    "scope",
    "id",
    "revision",
    "recordedAt",
    "situation",
    "eventTime",
    "context",
    "intention",
    "consideredOptions",
    "decision",
    "reasons",
    "expectedConsequences",
    "observedOutcomes",
    "humanLesson",
    "reinterpretations",
    "uncertainty",
    "transferConditions",
    "provenance",
  ]);
  exactKeys(copy.scope, ["organizationId", "subjectId"]);
  identity(copy.scope, copy.id, copy.revision);
  if (
    context.actor.kind !== "human" ||
    context.actor.subjectId !== copy.scope.subjectId ||
    !sameScope(context.scope, copy.scope) ||
    context.approvedFingerprint !== fingerprint
  )
    throw new Error("Exact Human approval required");
  if (instant(copy.eventTime) > instant(copy.recordedAt))
    throw new Error("Observed event cannot be in the future");
  for (const field of [
    copy.situation,
    copy.context,
    copy.intention,
    copy.decision,
    copy.humanLesson,
    copy.uncertainty,
    copy.transferConditions,
  ])
    text(field);
  for (const list of [
    copy.consideredOptions,
    copy.reasons,
    copy.expectedConsequences,
    copy.observedOutcomes,
    copy.reinterpretations,
  ]) {
    if (!Array.isArray(list)) throw new Error("List required");
    list.forEach(text);
  }
  if (!Array.isArray(copy.provenance) || copy.provenance.length === 0)
    throw new Error("Authorized provenance required");
  for (const source of copy.provenance) {
    exactKeys(source, [
      "scope",
      "sourceId",
      "sourceVersion",
      "kind",
      "authorizationReference",
      "eligible",
    ]);
    exactKeys(source.scope, ["organizationId", "subjectId"]);
    identity(source.scope, source.sourceId, source.sourceVersion);
    text(source.authorizationReference);
    if (
      !sameScope(source.scope, copy.scope) ||
      source.eligible !== true ||
      !["human_declaration", "authorized_archival_source"].includes(source.kind)
    )
      throw new Error("Ineligible archive source");
    const current = context.currentSources.filter(
      (item) =>
        sameScope(item.scope, source.scope) &&
        item.sourceId === source.sourceId &&
        item.sourceVersion === source.sourceVersion &&
        item.kind === source.kind &&
        item.authorizationReference === source.authorizationReference,
    );
    if (current.length !== 1 || current[0].eligible !== true)
      throw new Error("Source no longer authorized");
  }
  const currentRecord = context.currentRecord;
  if (
    !currentRecord ||
    !sameScope(currentRecord.scope, copy.scope) ||
    currentRecord.id !== copy.id ||
    currentRecord.revision !== copy.revision ||
    currentRecord.kind !== "experience_archive" ||
    currentRecord.createdAt !== copy.recordedAt
  )
    throw new Error("Current archive lifecycle required");
  const policy = planRetention(currentRecord, context.authorization, context.now);
  if (policy.disposition !== "retain")
    throw new Error("Current independent archive authorization required");
  return freeze({
    ...copy,
    fingerprint,
    policyVersion: TWIN_RETENTION_POLICY,
    transferAuthority: "none" as const,
  });
}
