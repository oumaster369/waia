import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { MarketReasoningGuardrailError } from "@/lib/trader/research/errors";
import {
  MARKET_REASONING_ALTERNATIVE_HYPOTHESIS_BOUNDS,
  MARKET_REASONING_FALSIFICATION_MIN,
  MARKET_REASONING_FIELD_LIMITS,
  type MarketReasoningInputArtifactDigests,
  type MarketReasoningProposalDraft,
} from "@/lib/trader/research/market-reasoning-proposal.types";

const FORBIDDEN_PATTERNS: { code: string; pattern: RegExp }[] = [
  { code: "FORBIDDEN_EXECUTABLE_COMMAND", pattern: /\bpnpm\b|\bnpm\b|\bbash\b|\bcurl\b|`/i },
  { code: "FORBIDDEN_TRADER_CLI", pattern: /trader:/i },
  { code: "FORBIDDEN_PROMOTION_LANGUAGE", pattern: /\bpromot(e|ion)\b|\blive[- ]?enable\b/i },
  { code: "FORBIDDEN_TRADING_INSTRUCTION", pattern: /\bplace order\b|\bexecute trade\b/i },
  {
    code: "FORBIDDEN_CAPITAL_RECOMMENDATION",
    pattern: /\ballocate capital\b|\bincrease exposure\b|\bdeploy capital\b|\bmax leverage\b/i,
  },
  { code: "FORBIDDEN_BLIND_REUSE", pattern: /\breuse blind\b|\brerun blind\b/i },
];

function assertMaxLength(field: string, value: string, max: number): void {
  if (value.length > max) {
    throw new MarketReasoningGuardrailError("FIELD_TOO_LONG", `${field} exceeds max length ${max}`);
  }
}

function scanForbiddenText(code: string, text: string): void {
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.pattern.test(text)) {
      throw new MarketReasoningGuardrailError(rule.code, `forbidden content in ${code}`);
    }
  }
}

function assertStringField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new MarketReasoningGuardrailError("MISSING_REQUIRED_FIELD", `missing or empty ${key}`);
  }
  return value.trim();
}

function assertStringArray(obj: Record<string, unknown>, key: string, minLength: number): string[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.length < minLength) {
    throw new MarketReasoningGuardrailError(
      "INVALID_ARRAY_FIELD",
      `${key} must be an array with at least ${minLength} items`,
    );
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new MarketReasoningGuardrailError(
        "INVALID_ARRAY_FIELD",
        `${key}[${index}] must be a non-empty string`,
      );
    }
    return entry.trim();
  });
}

function parseProposalDraft(raw: unknown): MarketReasoningProposalDraft {
  if (raw === null || typeof raw !== "object") {
    throw new MarketReasoningGuardrailError(
      "INVALID_PROVIDER_JSON",
      "provider output is not an object",
    );
  }
  const obj = raw as Record<string, unknown>;

  const reasoningSummary = assertStringField(obj, "reasoningSummary");
  assertMaxLength(
    "reasoningSummary",
    reasoningSummary,
    MARKET_REASONING_FIELD_LIMITS.reasoningSummary,
  );
  scanForbiddenText("reasoningSummary", reasoningSummary);

  const marketExplanation = assertStringField(obj, "marketExplanation");
  assertMaxLength(
    "marketExplanation",
    marketExplanation,
    MARKET_REASONING_FIELD_LIMITS.marketExplanation,
  );
  scanForbiddenText("marketExplanation", marketExplanation);

  const alternativeRaw = obj.alternativeHypotheses;
  if (!Array.isArray(alternativeRaw)) {
    throw new MarketReasoningGuardrailError(
      "INVALID_ARRAY_FIELD",
      "alternativeHypotheses must be an array",
    );
  }
  if (
    alternativeRaw.length < MARKET_REASONING_ALTERNATIVE_HYPOTHESIS_BOUNDS.min ||
    alternativeRaw.length > MARKET_REASONING_ALTERNATIVE_HYPOTHESIS_BOUNDS.max
  ) {
    throw new MarketReasoningGuardrailError(
      "INVALID_ALTERNATIVE_COUNT",
      `alternativeHypotheses count must be between ${MARKET_REASONING_ALTERNATIVE_HYPOTHESIS_BOUNDS.min} and ${MARKET_REASONING_ALTERNATIVE_HYPOTHESIS_BOUNDS.max}`,
    );
  }

  const alternativeHypotheses = alternativeRaw.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new MarketReasoningGuardrailError(
        "INVALID_ALTERNATIVE",
        `alternativeHypotheses[${index}] invalid`,
      );
    }
    const alt = entry as Record<string, unknown>;
    const claimText = assertStringField(alt, "claimText");
    const rationale = assertStringField(alt, "rationale");
    assertMaxLength(
      `alternativeHypotheses[${index}].claimText`,
      claimText,
      MARKET_REASONING_FIELD_LIMITS.claimText,
    );
    assertMaxLength(
      `alternativeHypotheses[${index}].rationale`,
      rationale,
      MARKET_REASONING_FIELD_LIMITS.rationale,
    );
    scanForbiddenText(`alternativeHypotheses[${index}]`, `${claimText} ${rationale}`);
    const scopeRaw = alt.intendedRegimeScope;
    if (!Array.isArray(scopeRaw) || scopeRaw.length === 0) {
      throw new MarketReasoningGuardrailError(
        "INVALID_REGIME_SCOPE",
        "intendedRegimeScope required",
      );
    }
    const intendedRegimeScope = scopeRaw.map(String);
    return { claimText, rationale, intendedRegimeScope };
  });

  const recommendedRaw = obj.recommendedNextHypothesis;
  if (recommendedRaw === null || typeof recommendedRaw !== "object") {
    throw new MarketReasoningGuardrailError(
      "MISSING_RECOMMENDED_HYPOTHESIS",
      "recommendedNextHypothesis required",
    );
  }
  const recommended = recommendedRaw as Record<string, unknown>;
  const recommendedClaim = assertStringField(recommended, "claimText");
  assertMaxLength(
    "recommendedNextHypothesis.claimText",
    recommendedClaim,
    MARKET_REASONING_FIELD_LIMITS.claimText,
  );
  scanForbiddenText("recommendedNextHypothesis.claimText", recommendedClaim);

  const falsificationConditions = assertStringArray(
    recommended,
    "falsificationConditions",
    MARKET_REASONING_FALSIFICATION_MIN,
  );
  for (const [index, condition] of falsificationConditions.entries()) {
    assertMaxLength(
      `falsificationConditions[${index}]`,
      condition,
      MARKET_REASONING_FIELD_LIMITS.falsificationCondition,
    );
    scanForbiddenText(`falsificationConditions[${index}]`, condition);
  }

  const recommendedScopeRaw = recommended.intendedRegimeScope;
  if (!Array.isArray(recommendedScopeRaw) || recommendedScopeRaw.length === 0) {
    throw new MarketReasoningGuardrailError(
      "INVALID_REGIME_SCOPE",
      "recommended intendedRegimeScope required",
    );
  }
  const intendedRegimeScope = recommendedScopeRaw.map(String);

  const draftRaw = recommended.mapsToMiRegisterHypothesisDraft;
  if (draftRaw === null || typeof draftRaw !== "object") {
    throw new MarketReasoningGuardrailError(
      "MISSING_MI_DRAFT",
      "mapsToMiRegisterHypothesisDraft required",
    );
  }
  const draft = draftRaw as Record<string, unknown>;
  if (draft.hypothesisKind !== "market_claim") {
    throw new MarketReasoningGuardrailError(
      "INVALID_HYPOTHESIS_KIND",
      "hypothesisKind must be market_claim",
    );
  }
  const name = assertStringField(draft, "name");
  const authoredBy = assertStringField(draft, "authoredBy");
  if (draft.definition === null || typeof draft.definition !== "object") {
    throw new MarketReasoningGuardrailError("MISSING_DEFINITION", "definition required");
  }
  const supersedes = Array.isArray(draft.supersedes) ? draft.supersedes.map(String) : [];

  const overfittingWarnings = assertStringArray(obj, "overfittingWarnings", 1);
  for (const [index, warning] of overfittingWarnings.entries()) {
    assertMaxLength(
      `overfittingWarnings[${index}]`,
      warning,
      MARKET_REASONING_FIELD_LIMITS.overfittingWarning,
    );
    scanForbiddenText(`overfittingWarnings[${index}]`, warning);
  }

  const confidenceRaw = obj.confidenceLevel;
  if (confidenceRaw !== "low" && confidenceRaw !== "medium" && confidenceRaw !== "high") {
    throw new MarketReasoningGuardrailError(
      "INVALID_CONFIDENCE",
      "confidenceLevel must be low|medium|high",
    );
  }

  const humanReviewRaw = obj.humanReview;
  if (humanReviewRaw === null || typeof humanReviewRaw !== "object") {
    throw new MarketReasoningGuardrailError("MISSING_HUMAN_REVIEW", "humanReview required");
  }
  const humanReviewObj = humanReviewRaw as Record<string, unknown>;
  if (humanReviewObj.disposition !== "pending") {
    throw new MarketReasoningGuardrailError(
      "INVALID_DISPOSITION",
      "humanReview.disposition must be pending",
    );
  }
  const reviewChecklist = assertStringArray(humanReviewObj, "reviewChecklist", 1);
  const nextSteps = assertStringArray(humanReviewObj, "nextSteps", 1);
  for (const item of [...reviewChecklist, ...nextSteps]) {
    scanForbiddenText("humanReview", item);
  }

  return {
    reasoningSummary,
    marketExplanation,
    alternativeHypotheses,
    recommendedNextHypothesis: {
      claimText: recommendedClaim,
      falsificationConditions,
      intendedRegimeScope,
      mapsToMiRegisterHypothesisDraft: {
        hypothesisKind: "market_claim",
        name,
        definition:
          draft.definition as MarketReasoningProposalDraft["recommendedNextHypothesis"]["mapsToMiRegisterHypothesisDraft"]["definition"],
        supersedes,
        authoredBy,
      },
    },
    overfittingWarnings,
    confidenceLevel: confidenceRaw,
    humanReview: {
      disposition: "pending",
      reviewChecklist,
      nextSteps,
    },
  };
}

export function validateMarketReasoningGuardrails(input: {
  rawProviderJson: unknown;
  expectedInputDigests: MarketReasoningInputArtifactDigests;
}): MarketReasoningProposalDraft {
  const draft = parseProposalDraft(input.rawProviderJson);

  for (const text of [
    draft.reasoningSummary,
    draft.marketExplanation,
    ...draft.alternativeHypotheses.flatMap((alt) => [alt.claimText, alt.rationale]),
    draft.recommendedNextHypothesis.claimText,
    ...draft.recommendedNextHypothesis.falsificationConditions,
    ...draft.overfittingWarnings,
  ]) {
    scanForbiddenText("proposalBody", text);
  }

  return draft;
}

export function parseProviderJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const fenceBody = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(fenceBody) as unknown;
  }
  return JSON.parse(trimmed) as unknown;
}
