const NUMBER = /-?\d+(?:[.,]\d+)?%?/g;

export function numbersInText(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

export function factSegmentMatches(text: string, refs: readonly { value: string }[]): boolean {
  if (refs.length === 0) return false;
  const values = new Set(refs.map((ref) => ref.value.replace("%", "").replace(",", ".")));
  return numbersInText(text).every((token) => values.has(token.replace("%", "").replace(",", ".")));
}

export const UNVERIFIED_SEGMENT = "утверждение удалено: не подтверждено данными";
