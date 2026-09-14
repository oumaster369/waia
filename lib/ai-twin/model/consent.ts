import type { ModelConsentGrant, ObservationSource } from "./contracts";
import { assertModelJsonData } from "./persistence-contracts";

export type ConsentTemporalMode = "UNTIL_REVOKED" | "EXPIRES_AT";
export type ConsentProductiveUse = "productive_private_modelling";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConsentGrantIssuanceIntent = Readonly<{
  requestId: string;
  confirmed: true;
  purpose: string;
  sources: ObservationSource[];
  permittedUses: ConsentProductiveUse[];
  disclosureBoundary: "private_only";
  retentionPolicyId: string;
  temporal: { mode: "UNTIL_REVOKED"; expiresAt: null } | { mode: "EXPIRES_AT"; expiresAt: string };
}>;

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function canonicalInstant(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function invalid(): never {
  throw new Error("INVALID_CONSENT_INTENT");
}

/** Pure Human-intent shape only. Authentication, trusted time, grant identity,
 * persistence and current Core authority belong to the repository adapter. */
export function parseConsentGrantIssuanceIntent(input: unknown): ConsentGrantIssuanceIntent {
  let value: unknown;
  try {
    assertModelJsonData(input);
    value = structuredClone(input);
    assertModelJsonData(value);
  } catch {
    invalid();
  }
  if (
    !exactKeys(value, [
      "confirmed",
      "requestId",
      "purpose",
      "sources",
      "permittedUses",
      "disclosureBoundary",
      "retentionPolicyId",
      "temporal",
    ]) ||
    value.confirmed !== true ||
    !nonempty(value.requestId) ||
    !uuid.test(value.requestId) ||
    !nonempty(value.purpose) ||
    value.disclosureBoundary !== "private_only" ||
    !nonempty(value.retentionPolicyId) ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    new Set(value.sources).size !== value.sources.length ||
    value.sources.some((source) => source !== "dialogue" && source !== "diary") ||
    !Array.isArray(value.permittedUses) ||
    value.permittedUses.length !== 1 ||
    value.permittedUses[0] !== "productive_private_modelling" ||
    !exactKeys(value.temporal, ["mode", "expiresAt"])
  )
    invalid();

  if (
    (value.temporal.mode === "UNTIL_REVOKED" && value.temporal.expiresAt !== null) ||
    (value.temporal.mode === "EXPIRES_AT" && !canonicalInstant(value.temporal.expiresAt)) ||
    !["UNTIL_REVOKED", "EXPIRES_AT"].includes(String(value.temporal.mode))
  )
    invalid();

  return freeze(value as unknown as ConsentGrantIssuanceIntent);
}

/** Validates a persisted grant as data; it does not establish current authority. */
export function parseModelConsentGrant(input: unknown): ModelConsentGrant {
  let value: unknown;
  try {
    assertModelJsonData(input);
    value = structuredClone(input);
    assertModelJsonData(value);
  } catch {
    throw new Error("INVALID_CONSENT_GRANT");
  }
  if (
    !exactKeys(value, [
      "id",
      "version",
      "scope",
      "purpose",
      "sources",
      "mode",
      "permittedUses",
      "disclosureBoundary",
      "issuedAt",
      "temporalMode",
      "expiresAt",
      "revokedAt",
      "retentionPolicyId",
    ]) ||
    !nonempty(value.id) ||
    !uuid.test(value.id) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    !exactKeys(value.scope, ["organizationId", "subjectId"]) ||
    !nonempty(value.scope.organizationId) ||
    !nonempty(value.scope.subjectId) ||
    !nonempty(value.purpose) ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    new Set(value.sources).size !== value.sources.length ||
    value.sources.some((source) => source !== "dialogue" && source !== "diary") ||
    value.mode !== "private_modelling" ||
    !Array.isArray(value.permittedUses) ||
    value.permittedUses.length !== 1 ||
    value.permittedUses[0] !== "productive_private_modelling" ||
    value.disclosureBoundary !== "private_only" ||
    !canonicalInstant(value.issuedAt) ||
    !["UNTIL_REVOKED", "EXPIRES_AT"].includes(String(value.temporalMode)) ||
    (value.revokedAt !== null && !canonicalInstant(value.revokedAt)) ||
    !nonempty(value.retentionPolicyId)
  )
    throw new Error("INVALID_CONSENT_GRANT");
  const issuedAt = Date.parse(value.issuedAt as string);
  const revokedAt = value.revokedAt === null ? null : Date.parse(value.revokedAt as string);
  if (
    (value.temporalMode === "UNTIL_REVOKED" && value.expiresAt !== null) ||
    (value.temporalMode === "EXPIRES_AT" &&
      (!canonicalInstant(value.expiresAt) || Date.parse(value.expiresAt as string) <= issuedAt)) ||
    (revokedAt !== null && revokedAt < issuedAt)
  )
    throw new Error("INVALID_CONSENT_GRANT");
  return freeze(value as unknown as ModelConsentGrant);
}
