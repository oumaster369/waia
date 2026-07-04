export const patternKnowledgeRelationKinds = {
  patternAssociatedWithClose: "pattern_associated_with_close",
  patternAssociatedWithRejection: "pattern_associated_with_rejection",
} as const;

export type PatternKnowledgeRelationKind =
  (typeof patternKnowledgeRelationKinds)[keyof typeof patternKnowledgeRelationKinds];

export function buildPatternKnowledgeFromRef(input: {
  patternKey: string;
  definitionDigest: string;
}): string {
  return `pattern:${input.patternKey}@${input.definitionDigest}`;
}

export function buildCloseKnowledgeToRef(input: { orderId: string }): string {
  return `close:order:${input.orderId}`;
}

export function buildRejectionKnowledgeToRef(input: { strategySignalId: string }): string {
  return `signal:${input.strategySignalId}:rejected`;
}
