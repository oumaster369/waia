import type { MiHypothesisNullKind } from "@/lib/trader/mi/hypothesis.types";

export const MI_TRIAL_SCHEMA_VERSION = "mi-trial-v1" as const;

export type MiTrialSchemaVersion = typeof MI_TRIAL_SCHEMA_VERSION;

/**
 * Append-only Trial Registration (DEE-289 / LD-5a.2b).
 *
 * Immutable record that an evaluation attempt was pre-registered against a hypothesis
 * version. Pin-only: nulls/falsification are sealed transitively via the hypothesis
 * digest and resolved at read time (no snapshot columns). Records only that an attempt
 * occurred — no outcome/success/failure/budget/score.
 */
export type MiTrial = {
  id: string;
  organizationId: string;
  hypothesisId: string;
  hypothesisKey: string;
  hypothesisDefinitionDigest: string;
  researchProgram: string | null;
  eventTime: Date;
  ingestTime: Date;
  registeredBy: string;
  seq: number;
  contentDigest: string;
  createdAt: Date;
};

/** Closed typed input — version-exact hypothesis pin only; no outcome/score/budget fields. */
export type RegisterTrialInput = {
  hypothesisId: string;
  hypothesisDefinitionDigest: string;
  /** Inert free-text grouping hint; not enumerated, not indexed (LD-5a.2b / O1). */
  researchProgram?: string | null;
  eventTime: Date;
  ingestTime: Date;
  registeredBy: string;
};

/**
 * Read-model projection of the falsification contract a trial is pinned to.
 * Resolved from the pinned immutable hypothesis version (not stored on the trial).
 */
export type MiTrialPinnedClaim = {
  requiredNulls: readonly MiHypothesisNullKind[];
  falsificationConditions: readonly string[];
};

/** Per-hypothesis trial counts (LD-5a.2b / O5). */
export type MiTrialCounts = {
  byHypothesisKey: number;
  byHypothesisId: number;
  latestSeq: number | null;
};
