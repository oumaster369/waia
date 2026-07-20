export const eventKnowledgeRelationKinds = {
  eventAttributedToPriceMove: "event_attributed_to_price_move",
  eventAssociatedWithPattern: "event_associated_with_pattern",
  eventAssociatedWithClose: "event_associated_with_close",
  eventAssociatedWithRejection: "event_associated_with_rejection",
} as const;

export type EventKnowledgeRelationKind =
  (typeof eventKnowledgeRelationKinds)[keyof typeof eventKnowledgeRelationKinds];

export function buildEventKnowledgeFromRef(input: {
  eventKey: string;
  eventDigest: string;
}): string {
  return `event:${input.eventKey}@${input.eventDigest}`;
}

export function buildCloseKnowledgeToRef(input: { orderId: string }): string {
  return `close:order:${input.orderId}`;
}

export function buildRejectionKnowledgeToRef(input: { strategySignalId: string }): string {
  return `signal:${input.strategySignalId}:rejected`;
}

export function buildPatternKnowledgeToRef(input: {
  patternKey: string;
  definitionDigest: string;
}): string {
  return `pattern:${input.patternKey}@${input.definitionDigest}`;
}

export function buildPriceWindowKnowledgeToRef(input: {
  symbol: string;
  windowStartMs: number;
  windowEndMs: number;
}): string {
  return `price_window:${input.symbol}:${input.windowStartMs}:${input.windowEndMs}`;
}
