export const MI_PATTERN_SCHEMA_VERSION = "mi-pattern-v1" as const;

export type MiPatternSchemaVersion = typeof MI_PATTERN_SCHEMA_VERSION;

export const miPatternKindValues = ["recurring_structure"] as const;

export type MiPatternKind = (typeof miPatternKindValues)[number];

export const miPatternLifecycleStateValues = ["ACTIVE", "ARCHIVED"] as const;

export type MiPatternLifecycleState = (typeof miPatternLifecycleStateValues)[number];

/**
 * Reproducibility pin to a specific measurement-definition version (DEE-283 / LD-4 / RC-2).
 * A value pair only — there is NO row-level FK to `trader_mi_measurement`.
 * This is the LD-4 reproducibility pin; it is NOT the LD-5 Evidence pin.
 */
export type PatternMeasurementRef = {
  measurementKey: string;
  measurementDefinitionDigest: string;
};

/**
 * Declarative structural descriptor (DEE-283 / LD-4).
 *
 * Inert metadata only — there is no evaluator and no runtime binding (P7).
 * It describes a recurring structure over pinned measurement references and
 * makes NO tradeability/profitability/edge claim (P5 firewall). It MUST NOT
 * encode profitability/expectancy/edge/direction/sizing/null/prior/
 * relationshipType/falsification claims (→ Hypothesis) nor validated
 * regime-model/regime-transition claims (→ Regime Knowledge).
 */
export type PatternDefinition = {
  /** Pinned measurement lineage (≥1) the structure is defined over (RC-2). */
  measurements: readonly PatternMeasurementRef[];
  /** Author-asserted description of the recurring structure (no claim that it pays). */
  recurrence: {
    description: string;
    params?: Record<string, number | string | boolean>;
  };
  /** Descriptive observation/measurement context only (no validated regime claims). */
  scope?: {
    asset?: string;
    timeframe?: string;
    observationWindow?: string;
    notes?: string;
  };
};

export type MiPattern = {
  id: string;
  organizationId: string;
  patternKind: MiPatternKind;
  patternKey: string;
  name: string;
  schemaVersion: MiPatternSchemaVersion;
  definitionJson: string;
  definitionDigest: string;
  structuralSignature: string;
  trialBudgetMax: number;
  versionSeq: number;
  revisionOf: string | null;
  authoredBy: string;
  createdAt: Date;
};

export type MiPatternLifecycleEvent = {
  id: string;
  organizationId: string;
  patternId: string;
  patternKey: string;
  lifecycleState: MiPatternLifecycleState;
  rationale: string;
  recordedBy: string;
  seq: number;
  contentDigest: string;
  createdAt: Date;
};

export type RegisterPatternInput = {
  patternKind: MiPatternKind;
  name: string;
  definition: PatternDefinition;
  /** Immutable advisory allocation (RC-1) — no consumption/enforcement in LD-4. */
  trialBudgetMax: number;
  authoredBy: string;
};

export type AppendPatternVersionInput = {
  patternKey: string;
  patternKind: MiPatternKind;
  name: string;
  definition: PatternDefinition;
  authoredBy: string;
};

export type PatternLifecycleTransitionInput = {
  patternKey: string;
  rationale: string;
  recordedBy: string;
};
