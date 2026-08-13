import type { SourceAnchor } from "./source-anchor-v1";

export const SOURCE_CORPUS_DUPLICATE_ANCHOR = "SOURCE_CORPUS_DUPLICATE_ANCHOR" as const;

export function sourceAnchorId(anchor: SourceAnchor): string {
  return `${anchor.venue}|${anchor.market}|${anchor.symbol}|${anchor.closedBarEpochMs}`;
}

/** Canonical DEVELOPMENT SOURCE ordering (§2.4.2): epoch asc, tie bar_content_digest asc. */
export function canonicalizeSourceCorpusV1(sourceCorpus: readonly SourceAnchor[]): SourceAnchor[] {
  const sorted = [...sourceCorpus].sort((a, b) => {
    if (a.closedBarEpochMs !== b.closedBarEpochMs) {
      return a.closedBarEpochMs - b.closedBarEpochMs;
    }
    return a.barContentDigest.localeCompare(b.barContentDigest);
  });
  assertNoDuplicateSourceAnchors(sorted);
  return sorted;
}

export function assertNoDuplicateSourceAnchors(sourceCorpus: readonly SourceAnchor[]): void {
  const seen = new Set<string>();
  for (const anchor of sourceCorpus) {
    const id = sourceAnchorId(anchor);
    if (seen.has(id)) {
      throw new Error(SOURCE_CORPUS_DUPLICATE_ANCHOR);
    }
    seen.add(id);
  }
}
