export const MI_HYPOTHESIS_SCHEMA_VERSION = "mi-hypothesis-v1" as const;

export type MiHypothesisSchemaVersion = typeof MI_HYPOTHESIS_SCHEMA_VERSION;

export const miHypothesisKindValues = ["market_claim"] as const;

export type MiHypothesisKind = (typeof miHypothesisKindValues)[number];

/** Ratified LD-5a doctrine §7 lifecycle states (DEE-286 / LD-5a.1b). */
export const miHypothesisLifecycleStateValues = [
  "PROPOSED",
  "VALIDATING",
  "VALIDATED",
  "DECAYING",
  "RETIRED",
  "QUARANTINED",
] as const;

export type MiHypothesisLifecycleState = (typeof miHypothesisLifecycleStateValues)[number];

export const miHypothesisRelationshipTypeValues = [
  "correlational",
  "predictive",
  "causal-conjecture",
] as const;

export type MiHypothesisRelationshipType = (typeof miHypothesisRelationshipTypeValues)[number];

export const miHypothesisNullKindValues = [
  "always-flat-cash",
  "buy-and-hold",
  "simple-trend-baseline",
  "random-entry-matched-exposure",
] as const;

export type MiHypothesisNullKind = (typeof miHypothesisNullKindValues)[number];

/**
 * Sealed claim-shape contract (LD-5a.1a). Included in definition_digest and
 * deterministically fixes the mandatory required-null floor.
 */
export type ClaimShape = {
  relationshipType: MiHypothesisRelationshipType;
  isDirectional: boolean;
  isTrendEdge: boolean;
  isTimingEdge: boolean;
};

/** Reproducibility pin to a specific pattern-definition version (LD-5a / RC-2). */
export type HypothesisPatternRef = {
  patternKey: string;
  patternDefinitionDigest: string;
};

/** Reproducibility pin to a specific measurement-definition version (LD-5a / RC-2). */
export type HypothesisMeasurementRef = {
  measurementKey: string;
  measurementDefinitionDigest: string;
};

/**
 * Declarative falsifiable market claim (DEE-285 / LD-5a.1a).
 *
 * Carries explicit prior, falsification conditions, and required-null declaration.
 * MUST NOT encode forecast/edge/decision/strategy/regime-model/confidence/evidence/trial
 * fields (→ hypothesis firewall). `supersedes` is stored outside the digest.
 */
export type HypothesisDefinition = {
  claimShape: ClaimShape;
  prior: {
    ordinal: string;
    band: string;
  };
  falsificationConditions: readonly string[];
  requiredNulls: readonly MiHypothesisNullKind[];
  patternRefs: readonly HypothesisPatternRef[];
  measurementRefs: readonly HypothesisMeasurementRef[];
  regimeScope: {
    description: string;
    notes?: string;
  };
};

export type MiHypothesis = {
  id: string;
  organizationId: string;
  hypothesisKind: MiHypothesisKind;
  hypothesisKey: string;
  name: string;
  schemaVersion: MiHypothesisSchemaVersion;
  definitionJson: string;
  definitionDigest: string;
  supersedesJson: string | null;
  versionSeq: number;
  revisionOf: string | null;
  authoredBy: string;
  createdAt: Date;
};

export type MiHypothesisLifecycleEvent = {
  id: string;
  organizationId: string;
  hypothesisId: string;
  hypothesisKey: string;
  lifecycleState: MiHypothesisLifecycleState;
  rationale: string;
  recordedBy: string;
  seq: number;
  contentDigest: string;
  createdAt: Date;
};

export type RegisterHypothesisInput = {
  hypothesisKind: MiHypothesisKind;
  name: string;
  definition: HypothesisDefinition;
  /** Backward-only factual lineage reference; excluded from definition_digest. */
  supersedes?: readonly string[];
  authoredBy: string;
};

export type AppendHypothesisVersionInput = {
  hypothesisKey: string;
  hypothesisKind: MiHypothesisKind;
  name: string;
  definition: HypothesisDefinition;
  authoredBy: string;
};

export type HypothesisLifecycleTransitionInput = {
  hypothesisKey: string;
  toState: MiHypothesisLifecycleState;
  rationale: string;
  recordedBy: string;
};

export type MiHypothesisWithCurrentState = {
  hypothesis: MiHypothesis;
  currentState: MiHypothesisLifecycleState;
};
