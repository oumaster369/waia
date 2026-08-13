import type { StrategySignal } from "@/lib/trader/intelligence/types";
import { compareDecimal, minDecimal } from "@/lib/trader/risk/numeric";

/** Frozen capital authority chain (§1.23). */
export const CAPITAL_AUTHORITY_CHAIN_VERSION = "capital-authority-chain/v1" as const;

export const AUTHORITY_CHAIN_STAGES = [
  "FORECAST",
  "DECISION",
  "DESIRED_SIZE",
  "PORTFOLIO",
  "RISK",
  "EXECUTION",
] as const;

export type AuthorityChainStage = (typeof AUTHORITY_CHAIN_STAGES)[number];

export type CapitalAuthorityPath = "v1" | "v2";

export const V2_CAPITAL_AUTHORITY_PATH: CapitalAuthorityPath = "v2";

export class AuthorityChainViolationError extends Error {
  readonly code = "AUTHORITY_CHAIN_VIOLATION" as const;

  constructor(message: string) {
    super(message);
    this.name = "AuthorityChainViolationError";
  }
}

export class RiskImprovementForbiddenError extends Error {
  readonly code = "RISK_IMPROVEMENT_FORBIDDEN" as const;

  constructor(message: string) {
    super(message);
    this.name = "RiskImprovementForbiddenError";
  }
}

const STAGE_ORDINAL: Record<AuthorityChainStage, number> = {
  FORECAST: 0,
  DECISION: 1,
  DESIRED_SIZE: 2,
  PORTFOLIO: 3,
  RISK: 4,
  EXECUTION: 5,
};

/** Ensures completed authority stages appear in causal order without skipping upstream stages. */
export function assertAuthorityChainStageOrdering(
  completedStages: readonly AuthorityChainStage[],
): void {
  let maxOrdinal = -1;
  for (const stage of completedStages) {
    const ordinal = STAGE_ORDINAL[stage];
    if (ordinal <= maxOrdinal) {
      throw new AuthorityChainViolationError(
        `authority stage ${stage} violates causal ordering (already passed ${AUTHORITY_CHAIN_STAGES[maxOrdinal]})`,
      );
    }
    maxOrdinal = ordinal;
  }
}

/**
 * V2 ceremony completeness: every mandatory stage must be present (membership),
 * not merely an ordered subsequence (§ Closure V / DEE-518 §1.23).
 */
export function assertAuthorityChainStageCompleteness(
  completedStages: readonly AuthorityChainStage[],
  requiredStages: readonly AuthorityChainStage[] = AUTHORITY_CHAIN_STAGES,
): void {
  assertAuthorityChainStageOrdering(completedStages);
  const present = new Set(completedStages);
  for (const stage of requiredStages) {
    if (!present.has(stage)) {
      throw new AuthorityChainViolationError(`mandatory authority stage missing: ${stage}`);
    }
  }
  if (completedStages.length !== requiredStages.length) {
    throw new AuthorityChainViolationError(
      `authority chain membership mismatch: completed=${completedStages.join(",")} required=${requiredStages.join(",")}`,
    );
  }
  for (let i = 0; i < requiredStages.length; i += 1) {
    if (completedStages[i] !== requiredStages[i]) {
      throw new AuthorityChainViolationError(
        `authority chain order mismatch at index ${i}: got ${completedStages[i]} expected ${requiredStages[i]}`,
      );
    }
  }
}

/** True when the V2 capital path quarantines legacy strategy sizing/EV fields (§1.20). */
export function isV2CapitalAuthorityPath(path: CapitalAuthorityPath | undefined): boolean {
  return path === V2_CAPITAL_AUTHORITY_PATH;
}

export type LegacyStrategyDiagnostics = Readonly<{
  legacyDiagnosticConfidence: string | null;
  legacyDiagnosticExpectedEdge: string | null;
  legacyDiagnosticMaxRisk: string | null;
}>;

/** Extract quarantined legacy strategy fields for diagnostic logging only (§1.20). */
export function extractLegacyStrategyDiagnostics(
  signal: StrategySignal,
): LegacyStrategyDiagnostics {
  return {
    legacyDiagnosticConfidence: signal.confidence ?? null,
    legacyDiagnosticExpectedEdge: signal.expectedEdge ?? null,
    legacyDiagnosticMaxRisk: signal.maxRisk ?? null,
  };
}

/**
 * Heuristic hypothesis confidence MUST NOT drive Forecast probability or Decision EV (§1.21).
 * Fail-closed when a caller attempts to bind conviction into probability/capital authority.
 * Presence as eligibility/diagnostic context alone is permitted.
 */
export function assertHypothesisConfidenceNonAuthoritative(input: {
  convictionValue?: number | string | null;
  /** True when caller attempted to use conviction as probability, EV, or sizing authority. */
  usedAsProbabilityOrCapitalAuthority?: boolean;
}): void {
  if (input.usedAsProbabilityOrCapitalAuthority === true) {
    throw new AuthorityChainViolationError(
      "hypothesis/MSV conviction must not drive Forecast probability or V2 capital sizing/EV",
    );
  }
}

/**
 * V2 capital path: StrategySignal confidence/expectedEdge/maxRisk have zero sizing/actionability
 * authority. Callers that attempt to size from those fields under V2 must fail closed.
 */
export function assertV2StrategySignalFieldsNonAuthoritative(input: {
  capitalAuthorityPath: CapitalAuthorityPath | undefined;
  attemptedLegacySizingOrEvAuthority: boolean;
}): void {
  if (
    isV2CapitalAuthorityPath(input.capitalAuthorityPath) &&
    input.attemptedLegacySizingOrEvAuthority
  ) {
    throw new AuthorityChainViolationError(
      "StrategySignal confidence/expectedEdge/maxRisk have zero V2 capital authority",
    );
  }
}

/** Live/paper mapSignal paths are legacy V1 only — cannot claim V2 capital authority. */
export function assertLegacySignalMappingNotV2CapitalAuthority(
  capitalAuthorityPath: CapitalAuthorityPath | undefined,
): void {
  if (isV2CapitalAuthorityPath(capitalAuthorityPath)) {
    throw new AuthorityChainViolationError(
      "legacy signal-to-order/live mapping cannot claim V2 capital authority",
    );
  }
}

/**
 * Risk MUST NOT improve/increase a proposal — only clamp or veto downward (§1.23).
 * Returns the approved quantity (min of proposed and risk ceiling).
 */
export function clampRiskProposalDownwardOnly(input: {
  proposedQuantity: string;
  riskApprovedQuantity: string;
}): string {
  if (compareDecimal(input.riskApprovedQuantity, input.proposedQuantity) > 0) {
    throw new RiskImprovementForbiddenError(
      "risk approved quantity exceeds proposal — upward improvement forbidden",
    );
  }
  return minDecimal(input.proposedQuantity, input.riskApprovedQuantity);
}

/** Validates that execution quantity does not exceed the risk-approved downward clamp. */
export function assertExecutionWithinRiskAuthority(input: {
  proposedQuantity: string;
  riskApprovedQuantity: string;
  executionQuantity: string;
}): void {
  const clamped = clampRiskProposalDownwardOnly({
    proposedQuantity: input.proposedQuantity,
    riskApprovedQuantity: input.riskApprovedQuantity,
  });
  if (compareDecimal(input.executionQuantity, clamped) > 0) {
    throw new AuthorityChainViolationError("execution quantity exceeds risk downward-only clamp");
  }
}
