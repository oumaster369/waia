import { createHash } from "node:crypto";

/** HTR_SEMANTIC_CANONICAL_JSON_V1 — code-point key order, no localeCompare. */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortObjectKeys(value: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareCodePoints)) {
    sorted[key] = canonicalizeValue(value[key]);
  }
  return sorted;
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("HTR_SEMANTIC_CANONICAL_JSON_V1: non-finite number prohibited");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (isPlainObject(value)) {
    return sortObjectKeys(value);
  }
  throw new Error("HTR_SEMANTIC_CANONICAL_JSON_V1: unsupported value type");
}

export function canonicalizeSemanticObject<T extends Record<string, unknown>>(value: T): T {
  return sortObjectKeys(value) as T;
}

export function canonicalizeSemanticJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function diagnosticSafeValue(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (Number.isNaN(value)) return "NON_FINITE_NUMBER:NaN";
    return value > 0 ? "NON_FINITE_NUMBER:+Infinity" : "NON_FINITE_NUMBER:-Infinity";
  }
  if (Array.isArray(value)) return value.map((item) => diagnosticSafeValue(item));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, diagnosticSafeValue(item)]),
    );
  }
  return value;
}

/** Diagnostic-only canonicalization that preserves non-finite failures as explicit text. */
export function canonicalizeDiagnosticJsonString(value: unknown): string {
  return canonicalizeSemanticJsonString(diagnosticSafeValue(value));
}

export function computeSemanticSha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalizeSemanticJsonString(value), "utf8").digest("hex");
}

export function sortCodePointStrings(values: readonly string[]): string[] {
  return [...values].sort(compareCodePoints);
}

export function canonicalDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("canonicalDecimalString: non-finite number prohibited");
  }
  return value.toString();
}
