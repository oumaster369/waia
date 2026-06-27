import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MI_PATTERN_SCHEMA_VERSION,
  type MiPatternKind,
  type MiPatternLifecycleState,
  type MiPatternSchemaVersion,
  type PatternDefinition,
} from "@/lib/trader/mi/pattern.types";

export type PatternKeyInput = {
  organizationId: string;
  patternKind: MiPatternKind;
  name: string;
};

export type PatternDefinitionDigestInput = {
  schemaVersion: MiPatternSchemaVersion;
  organizationId: string;
  patternKey: string;
  patternKind: MiPatternKind;
  name: string;
  definitionCanonical: Record<string, unknown>;
};

export type PatternStructuralSignatureInput = {
  schemaVersion: MiPatternSchemaVersion;
  patternKind: MiPatternKind;
  structuralCanonical: Record<string, unknown>;
};

export type PatternLifecycleContentDigestInput = {
  organizationId: string;
  patternKey: string;
  lifecycleState: MiPatternLifecycleState;
  seq: number;
  rationale: string;
  recordedBy: string;
};

/** Fixed precision for normalizing numeric definition parameters before hashing (P6). */
const PATTERN_PARAM_PRECISION = 8;

/**
 * Definition keys that would turn a Pattern into a Hypothesis (profitability/edge claim)
 * or a Regime Knowledge object (validated regime model/transition). The firewall (P5/RC-5)
 * scans definition KEYS (not free-text values) for these normalized tokens.
 */
export const PATTERN_FORBIDDEN_DEFINITION_KEYS: ReadonlySet<string> = new Set([
  // Hypothesis / edge / profitability
  "profitability",
  "profitable",
  "profit",
  "tradeability",
  "tradeable",
  "expectancy",
  "edge",
  "pnl",
  "winrate",
  "sharpe",
  "return",
  "returns",
  "alpha",
  // Directionality
  "direction",
  "directional",
  "side",
  "long",
  "short",
  // Sizing
  "sizing",
  "size",
  "position",
  "leverage",
  "weight",
  // Null comparators
  "null",
  "nulls",
  "nullcomparator",
  "nullcomparators",
  // Hypothesis structure
  "prior",
  "relationshiptype",
  "falsification",
  "falsify",
  "invalidation",
  "hypothesis",
  // Regime Knowledge
  "regime",
  "regimemodel",
  "regimetransition",
  "regimestate",
  "validatedregime",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\s-]/g, "");
}

function normalizeNumbersDeep(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("[trader] pattern definition contains a non-finite numeric parameter");
    }
    return value.toFixed(PATTERN_PARAM_PRECISION);
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
 * Recursively scans definition object KEYS for firewall-forbidden tokens (P5/RC-5).
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
      if (PATTERN_FORBIDDEN_DEFINITION_KEYS.has(normalizeKey(key))) {
        return key;
      }
      const hit = findForbiddenDefinitionKey(child);
      if (hit) return hit;
    }
  }
  return null;
}

/** Canonical, numeric-normalized form of a pattern definition (P6). */
export function buildDefinitionCanonical(definition: PatternDefinition): Record<string, unknown> {
  return normalizeNumbersDeep(definition) as Record<string, unknown>;
}

export function serializePatternDefinitionJson(definition: PatternDefinition): string {
  return JSON.stringify(definition);
}

export function parsePatternDefinitionJson(definitionJson: string): PatternDefinition {
  return JSON.parse(definitionJson) as PatternDefinition;
}

export function canonicalizePatternKeyInput(input: PatternKeyInput): Record<string, unknown> {
  return sortKeysDeep({
    organizationId: input.organizationId,
    patternKind: input.patternKind,
    name: input.name,
  }) as Record<string, unknown>;
}

/** Deterministic logical family key, stable across versions (P1). */
export function computePatternKey(input: PatternKeyInput): string {
  const canonical = canonicalizePatternKeyInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function canonicalizePatternDefinitionDigestInput(
  input: PatternDefinitionDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: input.schemaVersion,
    organizationId: input.organizationId,
    patternKey: input.patternKey,
    patternKind: input.patternKind,
    name: input.name,
    definitionCanonical: input.definitionCanonical,
  }) as Record<string, unknown>;
}

/** Reproducible per-version content fingerprint; the future LD-5 Evidence-pin target (P1/P6). */
export function computePatternDefinitionDigest(input: PatternDefinitionDigestInput): string {
  const canonical = canonicalizePatternDefinitionDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildPatternDefinitionDigest(input: {
  organizationId: string;
  patternKey: string;
  patternKind: MiPatternKind;
  name: string;
  definition: PatternDefinition;
}): string {
  return computePatternDefinitionDigest({
    schemaVersion: MI_PATTERN_SCHEMA_VERSION,
    organizationId: input.organizationId,
    patternKey: input.patternKey,
    patternKind: input.patternKind,
    name: input.name,
    definitionCanonical: buildDefinitionCanonical(input.definition),
  });
}

export function canonicalizePatternStructuralSignatureInput(
  input: PatternStructuralSignatureInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: input.schemaVersion,
    patternKind: input.patternKind,
    structuralCanonical: input.structuralCanonical,
  }) as Record<string, unknown>;
}

/**
 * Name-independent, key-independent, org-independent structural-duplicate detector (P1/RC-3).
 * Excludes `name`, `pattern_key`, and `organizationId` by construction.
 */
export function computePatternStructuralSignature(input: PatternStructuralSignatureInput): string {
  const canonical = canonicalizePatternStructuralSignatureInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildPatternStructuralSignature(input: {
  patternKind: MiPatternKind;
  definition: PatternDefinition;
}): string {
  return computePatternStructuralSignature({
    schemaVersion: MI_PATTERN_SCHEMA_VERSION,
    patternKind: input.patternKind,
    structuralCanonical: buildDefinitionCanonical(input.definition),
  });
}

/** Reproducible content fingerprint of a single lifecycle event (P6). */
export function buildLifecycleContentDigest(input: PatternLifecycleContentDigestInput): string {
  const canonical = sortKeysDeep({
    schemaVersion: MI_PATTERN_SCHEMA_VERSION,
    organizationId: input.organizationId,
    patternKey: input.patternKey,
    lifecycleState: input.lifecycleState,
    seq: input.seq,
    rationale: input.rationale,
    recordedBy: input.recordedBy,
  });
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}
