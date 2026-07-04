import {
  PATTERN_CATALOG_SCHEMA_VERSION,
  type PatternCatalogExplanationPayload,
  type PatternCatalogMatchResult,
  type PatternCatalogSubject,
} from "@/lib/trader/mi/pattern-catalog.types";

export function buildPatternCatalogExplanationText(input: {
  subject: PatternCatalogSubject;
  match: PatternCatalogMatchResult;
}): string {
  const parts = [
    `subject=${input.subject.subjectRef}`,
    `pattern=${input.match.pattern.patternKey}`,
    `match=${input.match.scores.matchScore}`,
    `relevance=${input.match.scores.relevanceScore}`,
    `confidence=${input.match.scores.confidenceMean}`,
    `outcome=${input.subject.outcomeTag}`,
    `regime=${input.subject.regime}`,
  ];
  return parts.join("; ");
}

export function buildPatternCatalogExplanationPayload(input: {
  subject: PatternCatalogSubject;
  match: PatternCatalogMatchResult;
}): PatternCatalogExplanationPayload {
  return {
    schemaVersion: PATTERN_CATALOG_SCHEMA_VERSION,
    subjectRef: input.subject.subjectRef,
    subjectKind: input.subject.kind,
    symbol: input.subject.symbol,
    regime: input.subject.regime,
    priceMoveUsdt: input.subject.priceMoveUsdt,
    patternKey: input.match.pattern.patternKey,
    definitionDigest: input.match.pattern.definitionDigest,
    breakdown: input.match.breakdown,
    scores: input.match.scores,
    outcomeTag: input.subject.outcomeTag,
    explanation: buildPatternCatalogExplanationText(input),
  };
}
