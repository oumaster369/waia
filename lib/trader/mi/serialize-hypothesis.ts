import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MI_HYPOTHESIS_SCHEMA_VERSION,
  type ClaimShape,
  type HypothesisDefinition,
  type MiHypothesisKind,
  type MiHypothesisLifecycleState,
  type MiHypothesisNullKind,
  type MiHypothesisSchemaVersion,
} from "@/lib/trader/mi/hypothesis.types";

export type HypothesisKeyInput = {
  organizationId: string;
  hypothesisKind: MiHypothesisKind;
  name: string;
};

export type HypothesisDefinitionDigestInput = {
  schemaVersion: MiHypothesisSchemaVersion;
  organizationId: string;
  hypothesisKey: string;
  hypothesisKind: MiHypothesisKind;
  name: string;
  definitionCanonical: Record<string, unknown>;
};

export type HypothesisLifecycleContentDigestInput = {
  organizationId: string;
  hypothesisKey: string;
  lifecycleState: MiHypothesisLifecycleState;
  seq: number;
  rationale: string;
  recordedBy: string;
};

/** Fixed precision for normalizing numeric definition parameters before hashing. */
export const HYPOTHESIS_PARAM_PRECISION = 8;

/**
 * Definition keys that would turn a Hypothesis into a Forecast/Decision/Strategy
 * or smuggle evidence/trial/confidence semantics. Inverse of the LD-4 Pattern firewall:
 * prior/relationshipType/falsification/nulls ARE allowed here.
 */
export const HYPOTHESIS_FORBIDDEN_DEFINITION_KEYS: ReadonlySet<string> = new Set([
  "expectedmove",
  "holdingperiod",
  "resolution",
  "forecast",
  "expectancy",
  "edge",
  "pnl",
  "sharpe",
  "sizing",
  "size",
  "leverage",
  "decision",
  "strategy",
  "regimemodel",
  "regimetransition",
  "confidence",
  "evidence",
  "trial",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\s-]/g, "");
}

function normalizeNumbersDeep(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("[trader] hypothesis definition contains a non-finite numeric parameter");
    }
    return value.toFixed(HYPOTHESIS_PARAM_PRECISION);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeNumbersDeep(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, normalizeNumbersDeep(record[key])]),
    );
  }
  return value;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

/**
 * Recursively scans definition object KEYS for firewall-forbidden tokens.
 * Returns the first offending (original) key, or null if clean.
 */
export function findForbiddenDefinitionKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = findForbiddenDefinitionKey(entry);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (HYPOTHESIS_FORBIDDEN_DEFINITION_KEYS.has(normalizeKey(key))) {
        return key;
      }
      const hit = findForbiddenDefinitionKey(child);
      if (hit) return hit;
    }
  }
  return null;
}

/** Canonical, numeric-normalized form of a hypothesis definition. */
export function buildDefinitionCanonical(
  definition: HypothesisDefinition,
): Record<string, unknown> {
  return normalizeNumbersDeep(definition) as Record<string, unknown>;
}

export function serializeHypothesisDefinitionJson(definition: HypothesisDefinition): string {
  return JSON.stringify(definition);
}

export function parseHypothesisDefinitionJson(definitionJson: string): HypothesisDefinition {
  return JSON.parse(definitionJson) as HypothesisDefinition;
}

export function canonicalizeHypothesisKeyInput(input: HypothesisKeyInput): Record<string, unknown> {
  return sortKeysDeep({
    organizationId: input.organizationId,
    hypothesisKind: input.hypothesisKind,
    name: input.name,
  }) as Record<string, unknown>;
}

/** Deterministic logical family key, stable across versions. */
export function computeHypothesisKey(input: HypothesisKeyInput): string {
  const canonical = canonicalizeHypothesisKeyInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function canonicalizeHypothesisDefinitionDigestInput(
  input: HypothesisDefinitionDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: input.schemaVersion,
    organizationId: input.organizationId,
    hypothesisKey: input.hypothesisKey,
    hypothesisKind: input.hypothesisKind,
    name: input.name,
    definitionCanonical: input.definitionCanonical,
  }) as Record<string, unknown>;
}

/** Reproducible per-version content fingerprint; supersedes excluded by construction. */
export function computeHypothesisDefinitionDigest(input: HypothesisDefinitionDigestInput): string {
  const canonical = canonicalizeHypothesisDefinitionDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildHypothesisDefinitionDigest(input: {
  organizationId: string;
  hypothesisKey: string;
  hypothesisKind: MiHypothesisKind;
  name: string;
  definition: HypothesisDefinition;
}): string {
  return computeHypothesisDefinitionDigest({
    schemaVersion: MI_HYPOTHESIS_SCHEMA_VERSION,
    organizationId: input.organizationId,
    hypothesisKey: input.hypothesisKey,
    hypothesisKind: input.hypothesisKind,
    name: input.name,
    definitionCanonical: buildDefinitionCanonical(input.definition),
  });
}

/**
 * Mandatory required-null floor derived from sealed claim shape (LD-5a Required Null Contract).
 * Declared requiredNulls must equal or superset this set.
 */
export function deriveMandatoryNullFloor(claimShape: ClaimShape): MiHypothesisNullKind[] {
  const floor: MiHypothesisNullKind[] = ["always-flat-cash"];
  if (claimShape.isDirectional) {
    floor.push("buy-and-hold");
  }
  if (claimShape.isTrendEdge) {
    floor.push("simple-trend-baseline");
  }
  if (claimShape.isTimingEdge) {
    floor.push("random-entry-matched-exposure");
  }
  return floor;
}

/** Frozen transition matrix (LD-5a doctrine §7 / DEE-286). */
export const HYPOTHESIS_LIFECYCLE_TRANSITIONS: Readonly<
  Record<MiHypothesisLifecycleState, readonly MiHypothesisLifecycleState[]>
> = {
  PROPOSED: ["VALIDATING"],
  VALIDATING: ["VALIDATED", "QUARANTINED"],
  VALIDATED: ["DECAYING", "QUARANTINED"],
  DECAYING: ["VALIDATED", "RETIRED"],
  RETIRED: [],
  QUARANTINED: [],
};

export const HYPOTHESIS_LIFECYCLE_TERMINAL_STATES: ReadonlySet<MiHypothesisLifecycleState> =
  new Set(["RETIRED", "QUARANTINED"]);

/** Returns true when doctrine §7 permits from → to. */
export function isAllowedHypothesisTransition(
  from: MiHypothesisLifecycleState,
  to: MiHypothesisLifecycleState,
): boolean {
  return HYPOTHESIS_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Reproducible content fingerprint of a single lifecycle event. */
export function buildLifecycleContentDigest(input: HypothesisLifecycleContentDigestInput): string {
  const canonical = sortKeysDeep({
    schemaVersion: MI_HYPOTHESIS_SCHEMA_VERSION,
    organizationId: input.organizationId,
    hypothesisKey: input.hypothesisKey,
    lifecycleState: input.lifecycleState,
    seq: input.seq,
    rationale: input.rationale,
    recordedBy: input.recordedBy,
  });
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}
