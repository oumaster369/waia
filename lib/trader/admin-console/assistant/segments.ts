const NUMBER = /-?\d+(?:[.,]\d+)?%?/g;
const STANDALONE_NUMBER = /(?<![\w.-])-?\d+(?:[.,]\d+)?%?(?![\w.-])/g;
const CITATION_ID = /"(?:id|invoiceId|orderId|entityId|fillId|accountId)"\s*:\s*"([^"]+)"/g;

export function numbersInText(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

/** Standalone numbers only. Digits inside identifiers, dates, and hashes are not facts. */
export function numbersInToolPayload(text: string): string[] {
  return [...text.matchAll(STANDALONE_NUMBER)].map((match) => match[0]);
}

export function citationIdsInToolPayload(text: string): string[] {
  return [...text.matchAll(CITATION_ID)].flatMap((match) => (match[1] ? [match[1]] : []));
}

export function factSegmentMatches(text: string, refs: readonly { value: string }[]): boolean {
  const claimed = numbersInText(text);
  if (claimed.length === 0 || refs.length === 0) return false;
  const values = new Set(refs.map((ref) => ref.value.replace("%", "").replace(",", ".")));
  return claimed.every((token) => values.has(token.replace("%", "").replace(",", ".")));
}

export const UNVERIFIED_SEGMENT = "утверждение удалено: не подтверждено данными";
