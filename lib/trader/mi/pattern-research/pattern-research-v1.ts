import { createHash } from "node:crypto";

export const PATTERN_RESEARCH_AUTHORITY = "RESEARCH_ONLY" as const;
export const PATTERN_DEFINITION_SCHEMA_VERSION = "pattern-definition/v1" as const;

/** Forbidden pattern signals per DEE-518 WP-PATTERN-RESEARCH. */
export const FORBIDDEN_PATTERN_SIGNALS = [
  "digital-root",
  "modulo-9",
  "124875-cycle",
  "369-signal",
] as const;

export type PatternAblationLevel =
  | "level"
  | "level+slope"
  | "level+curvature"
  | "level+curvature+tau"
  | "level+curvature+tau+hazard";

export type PatternDefinitionInput = {
  organizationId: string;
  patternKey: string;
  quantizerVersion: string;
  stateVectorVersion: string;
  ablationLevel: PatternAblationLevel;
  vTilde: readonly number[];
  aTilde?: readonly number[];
};

function canonicalizeDefinition(input: PatternDefinitionInput): string {
  return JSON.stringify({
    schema: PATTERN_DEFINITION_SCHEMA_VERSION,
    organizationId: input.organizationId,
    patternKey: input.patternKey,
    quantizerVersion: input.quantizerVersion,
    stateVectorVersion: input.stateVectorVersion,
    ablationLevel: input.ablationLevel,
    vTilde: input.vTilde,
    aTilde: input.aTilde ?? null,
    authority: PATTERN_RESEARCH_AUTHORITY,
  });
}

export function computePatternDefinitionDigest(input: PatternDefinitionInput): string {
  return createHash("sha256").update(canonicalizeDefinition(input), "utf8").digest("hex");
}

export function assertPatternResearchOnlyAuthority(authorityStatus: string): void {
  if (authorityStatus !== PATTERN_RESEARCH_AUTHORITY) {
    throw new Error(
      `[pattern-research] capital path forbidden for authority_status=${authorityStatus}`,
    );
  }
}

export function assertNoForbiddenPatternSignal(patternKey: string): void {
  const lower = patternKey.toLowerCase();
  for (const forbidden of FORBIDDEN_PATTERN_SIGNALS) {
    if (lower.includes(forbidden)) {
      throw new Error(`[pattern-research] forbidden signal in pattern_key: ${forbidden}`);
    }
  }
}

export type PatternOccurrenceInput = {
  patternDefinitionDigest: string;
  anchorClosedBarEpochMs: number;
  symbol: string;
  recurrenceCount: number;
  transitionRowSums: readonly number[];
};

export function computePatternOccurrenceDigest(input: PatternOccurrenceInput): string {
  const body = [
    input.patternDefinitionDigest,
    String(input.anchorClosedBarEpochMs),
    input.symbol,
    String(input.recurrenceCount),
    input.transitionRowSums.join(","),
  ].join("\n");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function assertTransitionMatrixRowSums(rows: readonly (readonly number[])[]): void {
  for (const row of rows) {
    const sum = row.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`[pattern-research] transition row must sum to 1, got ${sum}`);
    }
  }
}
