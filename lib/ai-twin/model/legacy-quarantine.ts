import type { ModelScope } from "./contracts";
import { assertModelJsonData } from "./persistence-contracts";

const reasons = {
  dialogue: "SOURCE_REVIEW_REQUIRED",
  diary: "SOURCE_REVIEW_REQUIRED",
  readiness: "LEGACY_PROGRESS_NOT_EVIDENCE",
  prediction: "LEGACY_REASONING_REVIEW_REQUIRED",
  verification: "LEGACY_REASONING_REVIEW_REQUIRED",
  embedding: "INDEX_NOT_EVIDENCE",
} as const;

type LegacySource = ModelScope & {
  kind: keyof typeof reasons;
  id: string;
  /** Exact adapter inventory revision; not a new Human-model revision. */
  revision: number;
  createdAt: string | null;
};

function requireValue(ok: unknown, code = "INVALID_INPUT"): asserts ok {
  if (!ok) throw new Error(code);
}
function exactKeys(
  value: unknown,
  expected: readonly string[],
): asserts value is Record<string, unknown> {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  requireValue(
    Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
  );
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function instant(value: unknown): number {
  requireValue(typeof value === "string");
  const milliseconds = Date.parse(value);
  requireValue(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value);
  return milliseconds;
}

/** Metadata-only dry-run, not an importer, authentication or applied storage quarantine.
 * Scope/clock/inventory must come from a future trusted server adapter, not an LLM
 * or request-body authority. Identifiers remain private data; no logging/storage is
 * performed. A plan creates no retention exception or permission to read content.
 * A later import must independently revalidate current consent, rights, provenance
 * and retention. No legacy value can grant any of the capabilities below. */
export function planLegacyModelQuarantine(input: unknown, scope: ModelScope, now: string) {
  assertModelJsonData(input);
  assertModelJsonData(scope);
  exactKeys(scope, ["organizationId", "subjectId"]);
  requireValue(nonempty(scope.organizationId) && nonempty(scope.subjectId));
  const at = instant(now);
  requireValue(Array.isArray(input));
  const seen = new Set<string>();
  const items = input.map((raw: unknown) => {
    exactKeys(raw, ["organizationId", "subjectId", "kind", "id", "revision", "createdAt"]);
    requireValue(
      raw.organizationId === scope.organizationId && raw.subjectId === scope.subjectId,
      "SCOPE_MISMATCH",
    );
    requireValue(typeof raw.kind === "string" && Object.hasOwn(reasons, raw.kind));
    requireValue(
      nonempty(raw.id) && Number.isSafeInteger(raw.revision) && (raw.revision as number) > 0,
    );
    requireValue(raw.createdAt === null || instant(raw.createdAt) <= at);
    const source = raw as LegacySource;
    const key = JSON.stringify([
      source.organizationId,
      source.subjectId,
      source.kind,
      source.id,
      source.revision,
    ]);
    requireValue(!seen.has(key), "DUPLICATE_SOURCE");
    seen.add(key);
    return Object.freeze({
      source: Object.freeze({ ...source }),
      disposition: "quarantined" as const,
      reason: reasons[source.kind],
    });
  });
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    plannedAt: now,
    status: "plan_only" as const,
    appliedToStorage: false as const,
    authority: Object.freeze({
      import: false,
      modelUse: false,
      formationCredit: false,
      archive: false,
      disclosure: false,
    } as const),
    items: Object.freeze(items),
  });
}
